// fetch-panos.mjs — 从 Wikimedia Commons 抓取球场 360° 等距柱状全景图（实拍背景素材）
// 输出: build/pano-raw/<id>.jpg（原始下载，4096px 宽） + build/panos-meta.json
// 之后由 build-panos.mjs 转成 dataURL JS 文件供 file:// 页面使用
// 用法: node build/fetch-panos.mjs [FORCE=1]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'build', 'pano-raw');
const META = path.join(ROOT, 'build', 'panos-meta.json');
fs.mkdirSync(RAW, { recursive: true });
const FORCE = process.argv.includes('FORCE=1');

const PANO_QUERIES = {
  'monumental': ['Estadio Monumental Buenos Aires'],
  'camp-nou': ['Camp Nou'],
  'westfalen': ['Signal Iduna Park', 'Westfalenstadion'],
  'maracana': ['Maracanã'],
  'bernabeu': ['Santiago Bernabéu'],
  'san-siro': ['San Siro'],
  'allianz-arena': ['Allianz Arena'],
  'old-trafford': ['Old Trafford'],
  'olimpico': ['Stadio Olimpico Roma'],
  'metropolitano': ['Wanda Metropolitano', 'Estadio Metropolitano Madrid'],
  'velodrome': ['Stade Vélodrome'],
  'da-luz': ['Estádio da Luz'],
  'tottenham': ['Tottenham Hotspur Stadium'],
  'veltins': ['Veltins-Arena'],
  'anfield': ['Anfield'],
  'emirates': ['Emirates Stadium'],
  'celtic-park': ['Celtic Park'],
  'mhp-arena': ['MHPArena', 'Gottlieb-Daimler-Stadion'],
  'groupama': ['Groupama Stadium', 'Parc Olympique Lyonnais'],
  'johan-cruyff': ['Johan Cruijff ArenA', 'Amsterdam ArenA'],
  'maradona': ['Stadio San Paolo', 'Stadio Diego Armando Maradona'],
  'bombonera': ['Bombonera'],
  'etihad': ['Etihad Stadium'],
  'st-james': ["St James' Park"],
  'rams-park': ['Türk Telekom Arena', 'Ali Sami Yen'],
  'ibrox': ['Ibrox'],
  'sukru': ['Şükrü Saracoğlu'],
  'dragao': ['Estádio do Dragão'],
  'parc-des-princes': ['Parc des Princes'],
  'villa-park': ['Villa Park Birmingham football stadium'],
  'sanchez-pizjuan': ['Sánchez Pizjuán'],
  'allianz-stadium': ['Juventus Stadium', 'Allianz Stadium Turin'],
  'stamford-bridge': ['Stamford Bridge'],
};

const BAD = /logo|map\b|schema|diagram|crest|coat|flag|emblem|badge|icon|kit\b|shirt|render|drawing|sketch|carte|chart|seatmap|bahnhof|metro|street|hotel|poster|statue|model\b|damage|construction|baustelle|snow|schnee|elsapark|schwabe|thurn|taxis/i;
const UA = { 'User-Agent': 'StadiumAtlas/1.0 (static educational website; contact: local)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeEnt = (s) => s
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&(\w+);/g, (m, n) => (n.toLowerCase() in NAMED ? NAMED[n.toLowerCase()] : m));
const stripTags = (s) => decodeEnt(String(s).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

async function api(params) {
  const url = 'https://commons.wikimedia.org/w/api.php?' +
    new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  for (let t = 0; ; t++) {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25000) });
    if ((res.status === 429 || res.status >= 500) && t < 3) { await sleep(15000 * (t + 1)); continue; }
    if (!res.ok) throw new Error('API ' + res.status);
    return res.json();
  }
}

function scorePano(title, core) {
  const t = title.toLowerCase();
  if (BAD.test(t)) return -1;
  let sc = 0;
  for (const w of core.toLowerCase().split(/\s+/).filter((x) => x.length > 3)) if (t.includes(w)) sc += 2;
  if (/360/.test(t)) sc += 4;
  if (/pano|rundum| çevre|全景/.test(t)) sc += 2;
  if (/\b(innen|interior|inside|stands?|pitch|feld|campo|pelouse)\b/.test(t)) sc += 2;
  if (/\b(aerial|exterior|outside|city|skyline)\b/.test(t)) sc += 1;
  return sc >= 2 ? sc : -1;
}

async function searchPano(core) {
  let best = null;
  for (const suffix of ['360', 'panorama', 'photosphere']) {
    const data = await api({
      action: 'query', generator: 'search',
      gsrsearch: `${core} ${suffix} filetype:bitmap`,
      gsrnamespace: '6', gsrlimit: '14',
      prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: '4096',
    });
    await sleep(900);
    for (const p of data?.query?.pages || []) {
      const ii = p.imageinfo?.[0];
      if (!ii || !ii.thumburl) continue;
      if (ii.mime !== 'image/jpeg' && ii.mime !== 'image/png') continue;
      const ratio = ii.width / ii.height;
      if (ratio < 1.8 || ratio > 2.4) continue;      // 必须是 2:1 等距柱状全景
      if (ii.width < 2000) continue;
      const sc = scorePano(p.title, core);
      if (sc < 0) continue;
      if (!best || sc > best.sc) best = { sc, title: p.title, ii };
    }
  }
  return best;
}

async function download(url, dest) {
  for (let t = 0; ; t++) {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
    if ((res.status === 429 || res.status >= 500) && t < 3) { await sleep(12000 * (t + 1)); continue; }
    if (!res.ok) throw new Error('download ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100000) throw new Error('too small ' + buf.length);
    fs.writeFileSync(dest, buf);
    return buf.length;
  }
}

const meta = fs.existsSync(META) && !FORCE ? JSON.parse(fs.readFileSync(META, 'utf8')) : {};
const save = () => fs.writeFileSync(META, JSON.stringify(meta, null, 1));

const report = [];
for (const [id, cores] of Object.entries(PANO_QUERIES)) {
  const dest = path.join(RAW, id + '.jpg');
  if (!FORCE && meta[id] && fs.existsSync(dest)) { report.push(`SKIP ${id}`); continue; }
  let got = null, lastErr = 'no 2:1 panorama candidate';
  for (const core of cores) {
    try {
      const pick = await searchPano(core);
      if (!pick) continue;
      const size = await download(pick.ii.thumburl, dest);
      const em = pick.ii.extmetadata || {};
      meta[id] = {
        title: pick.title,
        credit: stripTags(em.Artist?.value || 'Wikimedia Commons').slice(0, 70),
        license: stripTags(em.LicenseShortName?.value || 'see source'),
        src: pick.ii.descriptionurl,
        w: Math.min(4096, pick.ii.width),
        kb: Math.round(size / 1024),
      };
      save();
      got = meta[id];
      break;
    } catch (e) { lastErr = e.message; await sleep(2000); }
  }
  if (got) report.push(`OK   ${id.padEnd(18)} ${String(got.kb).padStart(5)}KB  ${got.title}`);
  else report.push(`MISS ${id.padEnd(18)} ${lastErr}`);
  await sleep(1500);
}
save();
console.log(report.join('\n'));
console.log('---');
console.log('panos:', Object.keys(meta).length + '/' + Object.keys(PANO_QUERIES).length);
