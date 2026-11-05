// pick-veltins.mjs — 手动指定 Commons 文件名重抓 veltins 照片并更新元数据
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const UA = { 'User-Agent': 'StadiumAtlas/1.0' };
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const dec = (s) => s
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&(\w+);/g, (m, n) => (n.toLowerCase() in NAMED ? NAMED[n.toLowerCase()] : m));
const strip = (s) => dec(String(s).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

const title = process.argv[2] || 'File:Arena Auf Schalke hosting Schalke 04 vs Dortmund in 2009.jpg';
const id = process.argv[3] || 'veltins';

const u = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
  format: 'json', formatversion: '2', action: 'query', titles: title,
  prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '1280',
});
const d = await (await fetch(u, { headers: UA })).json();
const ii = d?.query?.pages?.[0]?.imageinfo?.[0];
if (!ii || !ii.thumburl) { console.error('no imageinfo for', title); process.exit(1); }
const buf = Buffer.from(await (await fetch(ii.thumburl, { headers: UA })).arrayBuffer());
fs.writeFileSync(path.join(ROOT, 'assets', 'img', id + '.jpg'), buf);

const metaFile = path.join(ROOT, 'build', 'images-meta.json');
const m = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
const em = ii.extmetadata || {};
m[id] = {
  file: 'assets/img/' + id + '.jpg',
  credit: strip(em.Artist?.value || 'Wikimedia Commons').slice(0, 70),
  license: strip(em.LicenseShortName?.value || 'see source'),
  src: ii.descriptionurl,
};
fs.writeFileSync(metaFile, JSON.stringify(m, null, 1));
fs.writeFileSync(
  path.join(ROOT, 'assets', 'images.js'),
  '/* 由 build/fetch-images.mjs 自动生成 — 照片来自 Wikimedia Commons（自由版权，署名如下） */\nwindow.STADIUM_IMAGES = ' + JSON.stringify(m, null, 1) + ';\n'
);
console.log(`${id} fixed: ${Math.round(buf.length / 1024)}KB  ${m[id].license}  ${m[id].credit}`);
console.log('total images:', Object.keys(m).length);
