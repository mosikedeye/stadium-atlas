// fetch-crests.mjs — 从 Wikipedia 抓取俱乐部队徽（真实官方徽章图片）
// 输出: assets/img/crest/*.png + assets/crests.js（window.CLUB_CRESTS 按球场 id 索引）
// 用法: node build/fetch-crests.mjs [FORCE=1]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'assets', 'img', 'crest');
const META = path.join(ROOT, 'build', 'crests-meta.json');
fs.mkdirSync(DIR, { recursive: true });
const FORCE = process.argv.includes('FORCE=1');

// 球场 id → 英文维基百科俱乐部条目（共用球场两枚队徽）
const WIKI = {
  'monumental': ['Club Atlético River Plate'],
  'camp-nou': ['FC Barcelona'],
  'westfalen': ['Borussia Dortmund'],
  'maracana': ['CR Flamengo'],
  'bernabeu': ['Real Madrid CF'],
  'san-siro': ['AC Milan', 'Inter Milan'],
  'allianz-arena': ['FC Bayern Munich'],
  'old-trafford': ['Manchester United F.C.'],
  'olimpico': ['AS Roma', 'SS Lazio'],
  'metropolitano': ['Atlético Madrid'],
  'velodrome': ['Olympique de Marseille'],
  'da-luz': ['SL Benfica'],
  'tottenham': ['Tottenham Hotspur F.C.'],
  'veltins': ['FC Schalke 04'],
  'anfield': ['Liverpool F.C.'],
  'emirates': ['Arsenal F.C.'],
  'celtic-park': ['Celtic F.C.'],
  'mhp-arena': ['VfB Stuttgart'],
  'groupama': ['Olympique Lyonnais'],
  'johan-cruyff': ['AFC Ajax'],
  'maradona': ['SSC Napoli'],
  'bombonera': ['Boca Juniors'],
  'etihad': ['Manchester City F.C.'],
  'st-james': ['Newcastle United F.C.'],
  'rams-park': ['Galatasaray S.K. (football)'],
  'ibrox': ['Rangers F.C.'],
  'sukru': ['Fenerbahçe S.K. (football)'],
  'dragao': ['FC Porto'],
  'parc-des-princes': ['Paris Saint-Germain F.C.'],
  'villa-park': ['Aston Villa F.C.'],
  'sanchez-pizjuan': ['Sevilla FC'],
  'allianz-stadium': ['Juventus FC'],
  'stamford-bridge': ['Chelsea F.C.'],
};

const UA = { 'User-Agent': 'StadiumAtlas/1.0 (static educational website; contact: local)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (t) => t.replace(/[^a-z0-9]+/gi, '_').toLowerCase().replace(/^_|_$/g, '');

async function getJSON(url) {
  for (let t = 0; ; t++) {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
    if (res.status === 429 && t < 4) { await sleep(15000 * (t + 1)); continue; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }
}

async function download(url) {
  for (let t = 0; ; t++) {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25000) });
    if (res.status === 429 && t < 4) { await sleep(15000 * (t + 1)); continue; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const ct = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    return { buf, ct };
  }
}

// 途径1: Wikipedia REST summary（infobox 首图 = 队徽）
async function fromREST(title) {
  const j = await getJSON('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title));
  const cand = j.originalimage?.width <= 900 ? j.originalimage : j.thumbnail;
  if (!cand?.source) throw new Error('no image in summary');
  return cand.source;
}
// 途径2: action API pageimages
async function fromPageImages(title) {
  const u = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', titles: title,
    prop: 'pageimages', piprop: 'thumbnail|original', pithumbsize: '400',
  });
  const j = await getJSON(u);
  const p = j?.query?.pages?.[0];
  const src = p?.original?.source || p?.thumbnail?.source;
  if (!src) throw new Error('no pageimage');
  return src;
}

const meta = fs.existsSync(META) && !FORCE ? JSON.parse(fs.readFileSync(META, 'utf8')) : {};
function save() {
  fs.writeFileSync(META, JSON.stringify(meta, null, 1));
  fs.writeFileSync(
    path.join(ROOT, 'assets', 'crests.js'),
    '/* 由 build/fetch-crests.mjs 生成 — 俱乐部队徽来自 Wikipedia，版权归各俱乐部所有 */\n' +
    'window.CLUB_CRESTS = ' + JSON.stringify(meta, null, 1) + ';\n'
  );
}

const report = [];
for (const [id, titles] of Object.entries(WIKI)) {
  if (!FORCE && meta[id] && meta[id].length === titles.length &&
      meta[id].every((c) => fs.existsSync(path.join(ROOT, c.file)))) {
    report.push(`SKIP ${id.padEnd(18)}`);
    continue;
  }
  const got = [];
  for (const title of titles) {
    let ok = false;
    for (const fn of [fromREST, fromPageImages]) {
      try {
        const url = await fn(title);
        await sleep(1000);
        const { buf, ct } = await download(url);
        if (buf.length < 2500) throw new Error('too small ' + buf.length);
        const ext = /svg/i.test(ct) ? '.svg' : /png/i.test(ct) ? '.png' : '.jpg';
        const file = 'assets/img/crest/' + slug(title) + ext;
        fs.writeFileSync(path.join(ROOT, file), buf);
        got.push({ file, title, page: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title).replace(/%20/g, '_') });
        ok = true;
        break;
      } catch (e) {
        report.push(`     retry ${title}: ${e.message}`);
        await sleep(800);
      }
    }
    if (!ok) report.push(`MISS crest ${title}`);
    await sleep(1500);
  }
  if (got.length) { meta[id] = got; save(); }
  report.push(`${got.length === titles.length ? 'OK  ' : 'PART'} ${id.padEnd(18)} ${got.map((g) => g.file.split('/').pop()).join(' + ')}`);
  await sleep(2000);
}
save();
console.log(report.join('\n'));
console.log('---');
console.log('stadiums with crests:', Object.keys(meta).filter((k) => meta[k]?.length).length + '/' + Object.keys(WIKI).length);
