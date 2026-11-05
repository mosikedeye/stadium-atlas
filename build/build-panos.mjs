// build-panos.mjs — 把 build/pano-raw/<id>.jpg 全景图编码成 dataURL JS 文件
// 原因：file:// 页面下 WebGL 纹理不能直接加载本地图片（画布污染），dataURL 无此限制。
// 输出: assets/pano/<id>.js（按需懒加载） + assets/panos.js（索引+署名）
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const META = path.join(ROOT, 'build', 'panos-meta.json');
const EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
if (!fs.existsSync(META)) { console.error('先运行 fetch-panos.mjs'); process.exit(1); }
const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
const ids = Object.keys(meta).filter((id) => fs.existsSync(path.join(ROOT, 'build', 'pano-raw', id + '.jpg')));
if (!ids.length) { console.error('没有原始全景图'); process.exit(1); }

const PANO_DIR = path.join(ROOT, 'assets', 'pano');
fs.mkdirSync(PANO_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EXE,
  headless: 'new',
  args: ['--allow-file-access-from-files'],
});
const page = await browser.newPage();
// 关键：about:blank 无法加载 file:// 图片，必须先导航到 file:// 页面（配合 --allow-file-access-from-files）
const blank = path.join(ROOT, 'build', 'blank.html');
fs.writeFileSync(blank, '<!doctype html><meta charset="utf-8"><title>pano encoder</title>');
await page.goto('file:///' + blank.replace(/\\/g, '/'));

const index = {};
for (const id of ids) {
  const raw = path.join(ROOT, 'build', 'pano-raw', id + '.jpg');
  // 魔数预检：必须是 JPEG 或 PNG
  const head = Buffer.alloc(8);
  const fd = fs.openSync(raw, 'r');
  fs.readSync(fd, head, 0, 8, 0);
  fs.closeSync(fd);
  const isJpeg = head[0] === 0xff && head[1] === 0xd8;
  const isPng = head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (!isJpeg && !isPng) {
    console.log(`SKIP ${id.padEnd(18)} 非图片内容（magic: ${head.subarray(0, 4).toString('hex')}），已删除待重抓`);
    fs.unlinkSync(raw);
    delete meta[id];
    continue;
  }
  try {
    const file = raw.replace(/\\/g, '/');
    const dataUrl = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const w = Math.min(2048, img.naturalWidth);
      const h = Math.round((w * img.naturalHeight) / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.72);
    }, 'file:///' + file);
    const out = path.join(PANO_DIR, id + '.js');
    fs.writeFileSync(out, `window.__PANOS__=window.__PANOS__||{};window.__PANOS__[${JSON.stringify(id)}]=${JSON.stringify(dataUrl)};`);
    index[id] = {
      file: 'assets/pano/' + id + '.js',
      credit: meta[id].credit,
      license: meta[id].license,
      src: meta[id].src,
    };
    console.log(`OK ${id.padEnd(18)} ${(fs.statSync(out).size / 1024).toFixed(0)}KB  (${meta[id].license})  ${meta[id].title}`);
  } catch (e) {
    // 解码失败不删除原文件——可能只是环境问题，保留以便重试
    console.log(`SKIP ${id.padEnd(18)} 解码失败: ${e.message.split('\n')[0]}`);
  }
}
fs.writeFileSync(META, JSON.stringify(meta, null, 1));
fs.writeFileSync(
  path.join(ROOT, 'assets', 'panos.js'),
  '/* 由 build/build-panos.mjs 生成 — 360° 实拍全景索引，全景照片来自 Wikimedia Commons（署名见各条目） */\n' +
  'window.STADIUM_PANOS = ' + JSON.stringify(index, null, 1) + ';\n'
);
console.log('---');
console.log('panos encoded:', Object.keys(index).length);
await browser.close();
