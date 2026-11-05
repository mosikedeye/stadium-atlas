// shoot-facade.mjs — 拍摄指定球场的外观机位截图（补充展示素材）
import puppeteer from 'puppeteer-core';

const EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'file:///C:/Users/32700/stadium-atlas/index.html';
const SHOTS = 'C:/Users/32700/stadium-atlas/shots/';
const targets = [
  { id: 'allianz-arena', out: 'facade-modern.png' },
  { id: 'westfalen', out: 'facade-heritage.png' },
];

const browser = await puppeteer.launch({
  executablePath: EXE,
  headless: 'new',
  args: ['--allow-file-access-from-files', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.setViewport({ width: 1600, height: 960 });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.marker', { timeout: 8000 });
await new Promise((r) => setTimeout(r, 1500));

for (const t of targets) {
  await page.evaluate((id) => {
    const chipAll = document.querySelector('.chip.all');
    if (chipAll) chipAll.click();
    document.querySelector(`.row[data-id="${id}"]`).click();
  }, t.id);
  await new Promise((r) => setTimeout(r, 2600));
  // 有全景的球场默认在实拍漫游页，切到 3D
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.d-tab')].find((x) => x.dataset.tab === '3d');
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 1400));
  await page.evaluate(() => document.querySelector('#v3d-full').click());
  await new Promise((r) => setTimeout(r, 900));
  await page.evaluate(() => {
    [...document.querySelectorAll('.v3d-ov-presets button')].find((b) => b.dataset.view === 'facade').click();
  });
  await new Promise((r) => setTimeout(r, 2200));
  await page.screenshot({ path: SHOTS + t.out });
  console.log('shot:', t.out);
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 600));
}
await browser.close();
