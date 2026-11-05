// fetch-images.mjs — 为每座球场从 Wikimedia Commons 抓取自由版权照片（1280px 缩略图）
// 输出: assets/img/<id>.jpg + assets/images.js（含署名信息，满足 CC-BY-SA 要求）
// 特性: 断点续传（build/images-meta.json）、429/5xx 指数退避、关键词过滤与打分
// 用法: node build/fetch-images.mjs [FORCE=1 强制重抓]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const IMG_DIR = path.join(ROOT, 'assets', 'img');
const META_FILE = path.join(ROOT, 'build', 'images-meta.json');
fs.mkdirSync(IMG_DIR, { recursive: true });
const FORCE = process.argv.includes('FORCE=1');

// 复用 data.js 里的球场定义（无需浏览器环境）
const dataSrc = fs.readFileSync(path.join(ROOT, 'assets', 'data.js'), 'utf8');
const win = {};
new Function('window', dataSrc)(win);
const STADIUMS = win.STADIUMS;

// 针对命名复杂/易混淆球场的搜索词覆盖
const QUERIES = {
  'monumental': 'Estadio Monumental Buenos Aires River Plate',
  'camp-nou': 'Camp Nou Barcelona aerial interior',
  'westfalen': 'Westfalenstadion Dortmund',
  'maracana': 'Maracanã stadium Rio',
  'bernabeu': 'Santiago Bernabéu stadium Madrid',
  'san-siro': 'San Siro stadium Milan',
  'allianz-arena': 'Allianz Arena Munich',
  'old-trafford': 'Old Trafford stadium Manchester',
  'olimpico': 'Stadio Olimpico Rome aerial',
  'metropolitano': 'Estadio Metropolitano Madrid',
  'velodrome': 'Stade Vélodrome Marseille',
  'da-luz': 'Estádio da Luz Lisbon',
  'tottenham': 'Tottenham Hotspur Stadium London',
  'veltins': 'Veltins-Arena Schalke panorama',
  'anfield': 'Anfield stadium Liverpool',
  'emirates': 'Emirates Stadium Arsenal London',
  'celtic-park': 'Celtic Park Glasgow',
  'mhp-arena': 'MHPArena Stuttgart',
  'groupama': 'Groupama Stadium Lyon',
  'johan-cruyff': 'Johan Cruijff ArenA Amsterdam',
  'maradona': 'Stadio Diego Armando Maradona Naples',
  'bombonera': 'La Bombonera Buenos Aires',
  'etihad': 'Etihad Stadium Manchester',
  'st-james': "St James' Park Newcastle",
  'rams-park': 'Türk Telekom Arena Istanbul stadium',
  'ibrox': 'Ibrox Stadium Glasgow',
  'sukru': 'Şükrü Saracoğlu Stadium Istanbul',
  'dragao': 'Estádio do Dragão Porto',
  'parc-des-princes': 'Parc des Princes Paris',
  'villa-park': 'Villa Park Birmingham stadium',
  'sanchez-pizjuan': 'Ramón Sánchez-Pizjuán stadium Seville',
  'allianz-stadium': 'Allianz Stadium Turin Juventus',
  'stamford-bridge': 'Stamford Bridge stadium London',
};

// 排除：标志/地图/示意图/车站/门/街景等非球场全景照片
const BAD = /logo|map\b|maps|siteplan|site plan|plan\b|schema|diagram|crest|coat|flag|emblem|badge|icon|kit\b|shirt|3d|render|drawing|sketch|carte|location|chart|seatmap|bahnhof|station\b|gare\b|metro|railway|train\b|street|hotel|restaurant|mall\b|door\b|porta\b|puerta|entrance|poster|ticket|graffiti|mural|statue|model\b|store\b|shop\b|videowürfel|videowurfel|scoreboard|damage|beschaedigung|beschädigung/i;
const GOOD = /\b(aerial|panoram|interior|innen|night|exterior|vista|view|above|helicop|drone|match|floodlit|stadium|stadion|estadio|estádio|stadio)\b/i;
const UA = 'StadiumAtlas/1.0 (static educational website; contact: local)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params, tries = 3) {
  const url = 'https://commons.wikimedia.org/w/api.php?' +
    new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  for (let t = 0; ; t++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
      if (res.status === 429 || res.status >= 500) {
        if (t >= tries) throw new Error('API ' + res.status);
        await sleep(6000 * (t + 1));
        continue;
      }
      if (!res.ok) throw new Error('API ' + res.status);
      return await res.json();
    } catch (e) {
      if (t >= tries || !/timeout|fetch failed/i.test(e.message)) throw e;
      await sleep(4000 * (t + 1));
    }
  }
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEnt(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&(\w+);/g, (m, n) => (n.toLowerCase() in NAMED ? NAMED[n.toLowerCase()] : m));
}
function stripTags(s) { return decodeEnt(String(s).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim(); }

function scoreTitle(title, q) {
  const t = title.toLowerCase();
  if (BAD.test(t)) return -1;
  const words = q.toLowerCase().split(/[^a-z0-9\u00c0-\u024f']+/).filter((w) => w.length > 3);
  let sc = 0;
  for (const w of words) if (t.includes(w)) sc += 2;
  if (GOOD.test(t)) sc += 3;
  return sc >= 1 ? sc : -1;
}

async function pickImage(q) {
  const data = await api({
    action: 'query',
    generator: 'search',
    gsrsearch: q + ' filetype:bitmap',
    gsrnamespace: '6',
    gsrlimit: '14',
    prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata',
    iiurlwidth: '1280',
  });
  const pages = data?.query?.pages || [];
  let best = null;
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii || !ii.thumburl) continue;
    if (ii.mime !== 'image/jpeg' && ii.mime !== 'image/png') continue;
    const sc = scoreTitle(p.title, q);
    if (sc < 0) continue;
    if (!best || sc > best.sc) best = { sc, title: p.title, ii };
  }
  return best;
}

async function download(url, dest, tries = 3) {
  for (let t = 0; ; t++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if ((res.status === 429 || res.status >= 500) && t < tries) { await sleep(5000 * (t + 1)); continue; }
      if (!res.ok) throw new Error('download ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 8000) throw new Error('too small: ' + buf.length);
      fs.writeFileSync(dest, buf);
      return buf.length;
    } catch (e) {
      if (t >= tries || !/timeout|fetch failed/i.test(e.message)) throw e;
      await sleep(4000 * (t + 1));
    }
  }
}

const meta = fs.existsSync(META_FILE) && !FORCE
  ? JSON.parse(fs.readFileSync(META_FILE, 'utf8'))
  : {};

function saveMeta() {
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 1));
  const js = '/* 由 build/fetch-images.mjs 自动生成 — 照片来自 Wikimedia Commons（自由版权，署名如下） */\n' +
    'window.STADIUM_IMAGES = ' + JSON.stringify(meta, null, 1) + ';\n';
  fs.writeFileSync(path.join(ROOT, 'assets', 'images.js'), js);
}

const report = [];
for (const s of STADIUMS) {
  const dest = path.join(IMG_DIR, s.id + '.jpg');
  if (!FORCE && meta[s.id] && fs.existsSync(dest)) {
    report.push(`SKIP ${s.id.padEnd(18)} (already have)`);
    continue;
  }
  const queries = [QUERIES[s.id] || s.stadiumEn, `${s.clubEn} football stadium`];
  let got = null, lastErr = '';
  for (const q of queries) {
    try {
      const pick = await pickImage(q);
      await sleep(800);
      if (!pick) { lastErr = 'no candidate for "' + q + '"'; continue; }
      const size = await download(pick.ii.thumburl, dest);
      const em = pick.ii.extmetadata || {};
      meta[s.id] = {
        file: 'assets/img/' + s.id + '.jpg',
        credit: stripTags(em.Artist?.value || 'Wikimedia Commons').slice(0, 70),
        license: stripTags(em.LicenseShortName?.value || 'see source'),
        src: pick.ii.descriptionurl || ('https://commons.wikimedia.org/wiki/' + encodeURIComponent(pick.title).replace(/%3A/g, ':')),
      };
      saveMeta();
      got = { title: pick.title, size };
      break;
    } catch (e) { lastErr = e.message; await sleep(1500); }
  }
  if (got) report.push(`OK   ${s.id.padEnd(18)} ${String(Math.round(got.size / 1024)).padStart(4)}KB  ${got.title}`);
  else report.push(`MISS ${s.id.padEnd(18)} ${lastErr}`);
  await sleep(900);
}
saveMeta();

console.log(report.join('\n'));
console.log(`---\nsuccess ${Object.keys(meta).length}/${STADIUMS.length}`);
