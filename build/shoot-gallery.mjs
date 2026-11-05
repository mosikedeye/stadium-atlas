// shoot-gallery.mjs — 拍摄详情面板「外观实拍」画廊区域展示图
import puppeteer from 'puppeteer-core';

const EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'file:///C:/Users/32700/stadium-atlas/index.html';
const SHOTS = 'C:/Users/32700/stadium-atlas/shots/';

const browser = await puppeteer.launch({
  executablePath: EXE,
  headless: 'new',
  args: ['--allow-file-access-from-files', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.setViewport({ width: 1600, height: 1000 });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.marker', { timeout: 8000 });
await new Promise((r) => setTimeout(r, 1500));

// 选老特拉福德（4 张外观图），把画廊滚动到可视区
await page.evaluate(() => {
  document.querySelector('.row[data-id="old-trafford"]').click();
});
await new Promise((r) => setTimeout(r, 2200));
await page.evaluate(() => {
  const g = document.querySelector('#d-gallery');
  if (g) g.scrollIntoView({ block: 'center' });
});
await new Promise((r) => setTimeout(r, 900));
const panel = await page.$('#detail');
if (panel) await panel.screenshot({ path: SHOTS + 'gallery-panel.png' });

// 打开灯箱截一张
await page.evaluate(() => {
  const im = document.querySelector('#d-gallery img');
  if (im) im.click();
});
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: SHOTS + 'gallery-lightbox.png' });
console.log('shots done');
await browser.close();
