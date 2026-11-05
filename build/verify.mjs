// verify.mjs — headless checks for STADIUM ATLAS (puppeteer-core + installed Chrome)
import puppeteer from 'puppeteer-core';

const EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'file:///C:/Users/32700/stadium-atlas/index.html';
const SHOTS = 'C:/Users/32700/stadium-atlas/shots/';

const results = [];
const errors = [];
function check(name, pass, info = '') {
  results.push(`${pass ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
}
async function pixelDiversity(page, sel) {
  return page.evaluate((cssSel) => {
    const c = document.querySelector(cssSel);
    if (!c) return 0;
    const t = document.createElement('canvas'); t.width = 80; t.height = 60;
    const ctx = t.getContext('2d');
    ctx.drawImage(c, 0, 0, 80, 60);
    const d = ctx.getImageData(0, 0, 80, 60).data;
    const set = new Set();
    for (let i = 0; i < d.length; i += 4) set.add((d[i] << 16) + (d[i + 1] << 8) + d[i + 2]);
    return set.size;
  }, sel);
}

const browser = await puppeteer.launch({
  executablePath: EXE,
  headless: 'new',
  args: ['--allow-file-access-from-files', '--force-device-scale-factor=1', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.setViewport({ width: 1600, height: 960 });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.marker', { timeout: 8000 });

// 1. structure
const counts = await page.evaluate(() => ({
  land: document.querySelectorAll('#land path').length,
  grat: document.querySelectorAll('#graticule line').length,
  markers: document.querySelectorAll('.marker').length,
  rows: document.querySelectorAll('#club-list .row').length,
  chips: document.querySelectorAll('.chip').length,
}));
check('land paths=176', counts.land === 176, counts.land);
check('graticule lines', counts.grat >= 18, counts.grat);
check('markers=33', counts.markers === 33, counts.markers);
check('list rows=33', counts.rows === 33, counts.rows);
check('chips=8', counts.chips === 8, counts.chips);

// 2. marker geometry: core circles have positive rendered radius
const rInfo = await page.evaluate(() => {
  const cores = [...document.querySelectorAll('.marker .core')];
  const rs = cores.map((c) => parseFloat(getComputedStyle(c).r) || c.r.baseVal.value || 0);
  return { min: Math.min(...rs), max: Math.max(...rs), zero: rs.filter((r) => !(r > 0)).length };
});
check('core radii positive', rInfo.zero === 0 && rInfo.min > 2, `min=${rInfo.min.toFixed(1)} max=${rInfo.max.toFixed(1)}`);

// 3. header stats (wait for count-up tweens to finish)
await new Promise((r) => setTimeout(r, 1000));
const stats = await page.evaluate(() => ({
  count: document.querySelector('#stat-count').textContent,
  total: document.querySelector('#stat-total').textContent,
  big: document.querySelector('#stat-big').textContent,
  expect: window.STADIUMS.reduce((a, s) => a + s.cap, 0),
}));
check('stat-count=33', stats.count === '33', stats.count);
check('stat-total=sum(caps)', parseFloat(stats.total.replace(/,/g, '')) === stats.expect, `${stats.total} vs ${stats.expect}`);
check('stat-big=诺坎普', stats.big === '诺坎普', stats.big);

// 4. auto-selection opens detail with biggest stadium (Camp Nou, 99,354)
await new Promise((r) => setTimeout(r, 3200));
const det = await page.evaluate(() => {
  const d = document.querySelector('#detail');
  const img = d.querySelector('.d-hero-img');
  const cr = d.querySelector('.crest-real img');
  return {
    hidden: d.hidden,
    club: d.querySelector('.d-club')?.textContent,
    cap: d.querySelector('#d-cap-num')?.textContent,
    bowl: !!d.querySelector('.d-bowl svg'),
    crestReal: d.querySelectorAll('.crest-real img').length,
    crestLoaded: cr ? cr.complete && cr.naturalWidth > 10 : null,
    cmp: d.querySelectorAll('.cmp').length,
    three: !!window.THREE,
    imgs: Object.keys(window.STADIUM_IMAGES || {}).length,
    crests: Object.keys(window.CLUB_CRESTS || {}).length,
    rowCrests: document.querySelectorAll('#club-list img.row-crest').length,
    photo: !!img,
    photoOk: img ? img.complete && img.naturalWidth > 200 : null,
    credit: d.querySelector('.d-hero-credit')?.textContent?.trim()?.slice(0, 40) || '',
    canvas: !!d.querySelector('#d-view3d canvas'),
    fallback: !!d.querySelector('.v3d-fallback'),
    fullBtn: !d.querySelector('#v3d-full')?.hidden,
  };
});
check('detail auto-open', !det.hidden);
check('detail club=巴塞罗那', det.club === '巴塞罗那', det.club);
check('detail cap=99,354', det.cap === '99,354', det.cap);
check('bowl svg rendered', det.bowl);
check('real crest shown', det.crestReal >= 1, det.crestReal);
check('crest image loaded', det.crestLoaded === true, String(det.crestLoaded));
check('crests map=33', det.crests === 33, det.crests);
check('list row crests>=30', det.rowCrests >= 30, det.rowCrests);
check('compare rows>=4', det.cmp >= 4, det.cmp);
check('three.js loaded', det.three);
check('images map >=28', det.imgs >= 28, det.imgs);
check('photo loaded', det.photoOk === true, `photo=${det.photo} ok=${det.photoOk}`);
check('photo credit shown', det.credit.length > 3, det.credit);
check('3d canvas created', det.canvas || det.fallback, det.canvas ? 'canvas' : 'fallback: ' + det.fallback);
check('fullscreen button visible', det.fullBtn);

// 4b. 3D actually renders pixels
if (det.canvas) {
  await new Promise((r) => setTimeout(r, 1200));
  const px = await pixelDiversity(page, '#d-view3d canvas');
  check('3d renders pixels', px > 20, 'distinct colors: ' + px);
}

// 4c. tabs: 3D <-> 平面示意
await page.evaluate(() => { [...document.querySelectorAll('.d-tab')].find((b) => b.dataset.tab === 'svg').click(); });
const t1 = await page.evaluate(() => ({
  bowlShown: !document.querySelector('#d-bowl').hidden,
  v3dHidden: document.querySelector('#d-view3d').hidden,
}));
check('tab → 平面示意', t1.bowlShown && t1.v3dHidden, JSON.stringify(t1));
await page.evaluate(() => { [...document.querySelectorAll('.d-tab')].find((b) => b.dataset.tab === '3d').click(); });
const t2 = await page.evaluate(() => ({
  bowlHidden: document.querySelector('#d-bowl').hidden,
  v3dShown: !document.querySelector('#d-view3d').hidden,
  canvas: !!document.querySelector('#d-view3d canvas'),
}));
check('tab → 3D 模型', t2.v3dShown && t2.bowlHidden && t2.canvas, JSON.stringify(t2));

// 4d. 全屏查看 + 自由相机预设机位
await page.evaluate(() => document.querySelector('#v3d-full').click());
await new Promise((r) => setTimeout(r, 900));
const f = await page.evaluate(() => {
  const c = document.querySelector('#v3d-ov-stage canvas');
  return {
    ov: !!document.getElementById('v3d-overlay'),
    canvas: !!c,
    w: c ? c.width : 0,
    inlineCanvas: !!document.querySelector('#d-view3d canvas'),
  };
});
check('fullscreen overlay opens', f.ov && f.canvas && !f.inlineCanvas && f.w > 800, JSON.stringify(f));
const px2 = await pixelDiversity(page, '#v3d-ov-stage canvas');
check('fullscreen renders pixels', px2 > 20, 'distinct colors: ' + px2);

await page.evaluate(() => { [...document.querySelectorAll('.v3d-ov-presets button')].find((b) => b.dataset.view === 'pitch').click(); });
await new Promise((r) => setTimeout(r, 1500));
const px3 = await pixelDiversity(page, '#v3d-ov-stage canvas');
check('pitch preset renders', px3 > 20, 'distinct colors: ' + px3);
await page.screenshot({ path: SHOTS + 'fullscreen-pitch.png' });
await page.evaluate(() => { [...document.querySelectorAll('.v3d-ov-presets button')].find((b) => b.dataset.view === 'stand').click(); });
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: SHOTS + 'fullscreen-stand.png' });
await page.evaluate(() => { [...document.querySelectorAll('.v3d-ov-presets button')].find((b) => b.dataset.view === 'facade').click(); });
await new Promise((r) => setTimeout(r, 1600));
const pxF = await pixelDiversity(page, '#v3d-ov-stage canvas');
check('facade preset renders', pxF > 20, 'distinct colors: ' + pxF);
await page.screenshot({ path: SHOTS + 'fullscreen-facade.png' });
await page.evaluate(() => { [...document.querySelectorAll('.v3d-ov-presets button')].find((b) => b.dataset.view === 'aerial').click(); });
await new Promise((r) => setTimeout(r, 1800));
await page.screenshot({ path: SHOTS + 'fullscreen-aerial.png' });

await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 700));
const f2 = await page.evaluate(() => ({
  ov: !!document.getElementById('v3d-overlay'),
  inline: !!document.querySelector('#d-view3d canvas'),
}));
check('Esc closes fullscreen, canvas back inline', !f2.ov && f2.inline, JSON.stringify(f2));

// 4e. 实拍 360° 全景漫游（有全景数据的球场才检查）
const pano = await page.evaluate(() => {
  const idx = window.STADIUM_PANOS || {};
  const ids = Object.keys(idx);
  return { count: ids.length, first: ids[0] || null };
});
check('pano index defined', typeof pano.count === 'number', 'panos available: ' + pano.count);
if (pano.first) {
  await page.evaluate((id) => {
    const chipAll = document.querySelector('.chip.all');
    if (chipAll) chipAll.click();
    const row = document.querySelector(`.row[data-id="${id}"]`);
    row.scrollIntoView();
    row.click();
  }, pano.first);
  await new Promise((r) => setTimeout(r, 3200));
  const st = await page.evaluate(() => {
    const vp = document.querySelector('#d-viewpano');
    return {
      tabOn: document.querySelector('.d-tab.on')?.dataset.tab,
      canvas: !!document.querySelector('#d-viewpano canvas'),
      loaded: vp?.dataset.loaded,
      cruise: vp?.dataset.cruise,
      fullBtn: !document.querySelector('#vpano-full')?.hidden,
      credit: !!document.querySelector('.d-pano-credit'),
      hero: !!document.querySelector('.d-hero-img'),
    };
  });
  check('pano tab is default', st.tabOn === 'pano', JSON.stringify(st));
  check('pano loaded + canvas', st.canvas && st.loaded === '1', JSON.stringify(st));
  check('pano cruise on', st.cruise === 'on', String(st.cruise));
  check('pano fullscreen btn', st.fullBtn);
  check('pano credit line', st.credit);
  const pxP = await pixelDiversity(page, '#d-viewpano canvas');
  check('pano shows photo pixels', pxP > 300, 'distinct colors: ' + pxP);
  await page.screenshot({ path: SHOTS + 'detail-hero.png' });

  await page.evaluate(() => document.querySelector('#vpano-full').click());
  await new Promise((r) => setTimeout(r, 1400));
  const fov = await page.evaluate(() => ({
    ov: !!document.getElementById('v3d-overlay'),
    canvas: !!document.querySelector('#v3d-ov-stage canvas'),
    cruiseBtn: !!document.querySelector('[data-act="cruise"]'),
  }));
  check('pano fullscreen opens', fov.ov && fov.canvas && fov.cruiseBtn, JSON.stringify(fov));
  const pxO = await pixelDiversity(page, '#v3d-ov-stage canvas');
  check('pano fullscreen renders', pxO > 300, 'distinct colors: ' + pxO);
  await page.screenshot({ path: SHOTS + 'fullscreen-pano.png' });
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 700));
  const back = await page.evaluate(() => ({
    ov: !!document.getElementById('v3d-overlay'),
    inline: !!document.querySelector('#d-viewpano canvas'),
  }));
  check('Esc returns pano inline', !back.ov && back.inline, JSON.stringify(back));

  await page.evaluate(() => { [...document.querySelectorAll('.d-tab')].find((b) => b.dataset.tab === '3d').click(); });
  await new Promise((r) => setTimeout(r, 1200));
  const m3 = await page.evaluate(() => ({
    shown: !document.querySelector('#d-view3d').hidden,
    panoHidden: document.querySelector('#d-viewpano').hidden,
    canvas: !!document.querySelector('#d-view3d canvas'),
  }));
  check('pano→3d tab switch', m3.shown && m3.panoHidden && m3.canvas, JSON.stringify(m3));
}

// 4f. 外观实拍画廊 + 灯箱
const gal = await page.evaluate(() => {
  const g = window.STADIUM_GALLERY || {};
  const ids = Object.keys(g).filter((k) => Array.isArray(g[k]) && g[k].length >= 3);
  return { stadiums: ids.length, first: ids[0] || null };
});
check('gallery index defined', typeof gal.stadiums === 'number', 'stadiums with gallery: ' + gal.stadiums);
if (gal.stadiums >= 5 && gal.first) {
  await page.evaluate((id) => {
    const chipAll = document.querySelector('.chip.all');
    if (chipAll) chipAll.click();
    document.querySelector(`.row[data-id="${id}"]`).click();
  }, gal.first);
  await new Promise((r) => setTimeout(r, 1600));
  const g1 = await page.evaluate(() => ({
    sec: [...document.querySelectorAll('.d-section-title')].some((t) => t.textContent.includes('外观实拍')),
    imgs: document.querySelectorAll('#d-gallery img').length,
  }));
  check('gallery section shown', g1.sec && g1.imgs >= 3, JSON.stringify(g1));
  await page.evaluate(() => document.querySelector('#d-gallery img').click());
  await new Promise((r) => setTimeout(r, 900));
  const l1 = await page.evaluate(() => {
    const lb = document.querySelector('.lightbox');
    const im = lb ? lb.querySelector('img') : null;
    return { open: !!lb, loaded: im ? im.complete && im.naturalWidth > 200 : false, cap: !!lb?.querySelector('.lb-cap a') };
  });
  check('lightbox opens with image', l1.open && l1.loaded && l1.cap, JSON.stringify(l1));
  await page.keyboard.press('ArrowRight');
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: SHOTS + 'lightbox.png' });
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 400));
  const l2 = await page.evaluate(() => !!document.querySelector('.lightbox'));
  check('Esc closes lightbox', !l2);
}

// 5. select 河床 (SA), then filter 西甲 → selection filtered out → detail closes
await page.evaluate(() => {
  const row = [...document.querySelectorAll('#club-list .row')].find((r) => r.textContent.includes('河床'));
  row.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  [...document.querySelectorAll('.chip')].find((c) => c.textContent.includes('西甲')).click();
});
await new Promise((r) => setTimeout(r, 350));
const f1 = await page.evaluate(() => ({
  rows: document.querySelectorAll('#club-list .row').length,
  dim: document.querySelectorAll('.marker.dim').length,
  count: document.querySelector('#stat-count').textContent,
  detailHidden: document.querySelector('#detail').hidden, // selection (河床/SA) filtered out → closed
}));
check('西甲 rows=4', f1.rows === 4, f1.rows);
check('dim markers=29', f1.dim === 29, f1.dim);
check('stat-count=4', f1.count === '4', f1.count);
check('detail closed on filter-out', f1.detailHidden === true);

// 6. click first row (Camp Nou) → detail shows
await page.evaluate(() => document.querySelector('#club-list .row').click());
await new Promise((r) => setTimeout(r, 900));
const d2 = await page.evaluate(() => ({
  club: document.querySelector('.d-club').textContent,
  sel: document.querySelectorAll('.marker.sel').length,
}));
check('row click → 巴塞罗那', d2.club === '巴塞罗那', d2.club);
check('marker selected', d2.sel === 1, d2.sel);
await page.screenshot({ path: SHOTS + 'check-laliga.png' });

// 7. back to all, europe preset, search
await page.evaluate(() => {
  document.querySelector('.chip.all').click();
  [...document.querySelectorAll('#preset-row button')].find((b) => b.dataset.view === 'europe').click();
});
await new Promise((r) => setTimeout(r, 900));
const v = await page.evaluate(() => ({
  title: document.querySelector('#map-title-text').textContent,
  zoom: document.querySelector('#zoom-level').textContent,
  tf: document.querySelector('#viewport').getAttribute('transform'),
}));
check('preset title=欧洲视图', v.title === '欧洲视图', v.title);
check('zoom ~3.4x', v.zoom.startsWith('3.'), v.zoom);
await page.screenshot({ path: SHOTS + 'check-europe.png' });

await page.evaluate(() => {
  const i = document.querySelector('#search');
  i.value = '安菲尔德';
  i.dispatchEvent(new Event('input', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 300));
const s1 = await page.evaluate(() => ({
  rows: document.querySelectorAll('#club-list .row').length,
  first: document.querySelector('#club-list .row b')?.textContent,
}));
check('search 安菲尔德 → 1 row (利物浦)', s1.rows === 1 && s1.first === '利物浦', JSON.stringify(s1));

// 8. capacity slider
await page.evaluate(() => {
  document.querySelector('#clear-search').click();
  const sl = document.querySelector('#cap-slider');
  sl.value = 70000;
  sl.dispatchEvent(new Event('input', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 300));
const s2 = await page.evaluate(() => ({
  rows: document.querySelectorAll('#club-list .row').length,
  label: document.querySelector('#cap-value').textContent,
}));
check('slider ≥70,000 → 10 rows', s2.rows === 10 && s2.label.includes('70,000'), JSON.stringify(s2));

// 9. final hero shots (world view, no filters)
await page.evaluate(() => {
  const sl = document.querySelector('#cap-slider');
  sl.value = 40000; sl.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#detail-close').click();
  [...document.querySelectorAll('#preset-row button')].find((b) => b.dataset.view === 'world').click();
});
await new Promise((r) => setTimeout(r, 1000));
await page.screenshot({ path: SHOTS + 'desktop.png' });

// 10. select Old Trafford for a detail-panel shot (photo + 3D)
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.row')].find((r) => r.textContent.includes('曼联'));
  row.click();
});
await new Promise((r) => setTimeout(r, 1800));
await page.screenshot({ path: SHOTS + 'desktop-detail.png' });
const panel = await page.$('#detail');
if (panel) await panel.screenshot({ path: SHOTS + 'detail-panel.png' });

// 11. mobile viewport
await page.setViewport({ width: 420, height: 880 });
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: SHOTS + 'mobile.png' });

console.log(results.join('\n'));
console.log('---');
console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'no js errors');
const fails = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`SUMMARY: ${results.length - fails}/${results.length} passed`);
await browser.close();
process.exit(fails || errors.length ? 1 : 0);
