// fetch-gallery.mjs — 为每座球场抓取 3~4 张「建筑外观」实拍照片（Wikimedia Commons）
// 输出: assets/img/gal/<id>-<n>.jpg + assets/gallery.js（window.STADIUM_GALLERY，含署名）
// 特性: 排除已用作 hero 的文件、外观关键词打分、断点续传、429 退避
// 用法: node build/fetch-gallery.mjs [FORCE=1]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'assets', 'img', 'gal');
const META = path.join(ROOT, 'build', 'gallery-meta.json');
fs.mkdirSync(DIR, { recursive: true });
const FORCE = process.argv.includes('FORCE=1');

// 与 fetch-images.mjs 相同的球场搜索核心词
const QUERIES = {
  'monumental': 'Estadio Monumental Buenos Aires River Plate',
  'camp-nou': 'Camp Nou stadium Barcelona',
  'westfalen': 'Signal Iduna Park Dortmund',
  'maracana': 'Maracanã stadium Rio',
  'bernabeu': 'Santiago Bernabéu stadium Madrid',
  'san-siro': 'San Siro stadium Milan',
  'allianz-arena': 'Allianz Arena Munich',
  'old-trafford': 'Old Trafford stadium Manchester',
  'olimpico': 'Stadio Olimpico Rome',
  'metropolitano': 'Wanda Metropolitano Madrid',
  'velodrome': 'Stade Vélodrome Marseille',
  'da-luz': 'Estádio da Luz Lisbon',
  'tottenham': 'Tottenham Hotspur Stadium London',
  'veltins': 'Veltins-Arena Gelsenkirchen',
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

const BAD = /logo|map\b|maps|siteplan|site plan|plan\b|schema|diagram|crest|coat|flag|emblem|badge|icon|kit\b|shirt|3d|render|drawing|sketch|carte|location|chart|seatmap|bahnhof|\bstation\b|gare\b|\bmetro\b|métro|railway|train\b|street\b|hotel|restaurant|mall\b|door\b|porta\b|puerta|entrance|poster|ticket|graffiti|mural|statue|model\b|store\b|shop\b|videowürfel|scoreboard|damage|beschaedigung|construction|baustelle|snow|schnee|elsapark|schwabe|thurn|taxis|matchday|crowd only/i;
const GOOD = /\b(exterior|exterieur|extérieur|facade|fassade|façade|facciata|fachada|outside|außen|aussen|外|vista|view|night|nacht|noche|aerial|panoram|building|stadium|stadion|estadio|estádio|stadio)\b/i;
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
    if ((res.status === 429 || res.status >= 500) && t < 4) { await sleep(12000 * (t + 1)); continue; }
    if (!res.ok) throw new Error('API ' + res.status);
    return res.json();
  }
}

async function download(url, dest) {
  for (let t = 0; ; t++) {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(40000) });
    if ((res.status === 429 || res.status >= 500) && t < 3) { await sleep(8000 * (t + 1)); continue; }
    if (!res.ok) throw new Error('download ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 15000) throw new Error('too small ' + buf.length);
    fs.writeFileSync(dest, buf);
    return buf.length;
  }
}

function scoreTitle(title, core, bonus) {
  const t = title.toLowerCase();
  if (BAD.test(t)) return -1;
  let sc = bonus || 0;
  let nameHit = 0;
  for (const w of core.toLowerCase().split(/[^a-z0-9\u00c0-\u024f']+/).filter((x) => x.length > 3)) {
    if (t.includes(w)) nameHit += 2;
  }
  if (nameHit < 2) return -1; // 必须命中球场名
  sc += nameHit;
  if (GOOD.test(t)) sc += 3;
  if (/\b(exterior|exterieur|extérieur|facade|fassade|façade|outside|außen|aussen|facciata|fachada)\b/.test(t)) sc += 3;
  if (/\b(night|nacht|noche|illuminated|floodlit)\b/.test(t)) sc += 1;
  if (/\b(aerial|helicop|drone|vista|panoram)\b/.test(t)) sc += 1;
  return sc;
}

// hero 已用的文件（避免重复）
const heroMetaFile = path.join(ROOT, 'build', 'images-meta.json');
const heroTitles = new Set();
if (fs.existsSync(heroMetaFile)) {
  const hm = JSON.parse(fs.readFileSync(heroMetaFile, 'utf8'));
  for (const v of Object.values(hm)) if (v?.title) heroTitles.add(v.title);
}

const meta = fs.existsSync(META) && !FORCE ? JSON.parse(fs.readFileSync(META, 'utf8')) : {};
function save() {
  fs.writeFileSync(META, JSON.stringify(meta, null, 1));
  fs.writeFileSync(
    path.join(ROOT, 'assets', 'gallery.js'),
    '/* 由 build/fetch-gallery.mjs 自动生成 — 外观实拍图集来自 Wikimedia Commons（自由版权，署名如下） */\n' +
    'window.STADIUM_GALLERY = ' + JSON.stringify(meta, null, 1) + ';\n'
  );
}

const report = [];
for (const [id, core] of Object.entries(QUERIES)) {
  if (!FORCE && meta[id]?.length >= 3 &&
      meta[id].every((g) => fs.existsSync(path.join(ROOT, g.file)))) {
    report.push(`SKIP ${id}`);
    continue;
  }
  try {
    const seen = new Set(heroTitles);
    const cands = [];
    function collect(pages, bonus) {
      for (const p of pages || []) {
        const ii = p.imageinfo?.[0];
        if (!ii?.thumburl || seen.has(p.title)) continue;
        if (ii.mime !== 'image/jpeg' && ii.mime !== 'image/png') continue;
        if (ii.width < 700) continue;
        const sc = scoreTitle(p.title, core, bonus);
        if (sc < 0) continue;
        seen.add(p.title);
        cands.push({ sc, title: p.title, ii });
      }
    }
    // 第一轮：外观定向搜索（高加权）
    for (const suffix of ['exterior facade', 'outside view']) {
      const data = await api({
        action: 'query', generator: 'search',
        gsrsearch: `${core} ${suffix} filetype:bitmap`,
        gsrnamespace: '6', gsrlimit: '16',
        prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: '1280',
      });
      await sleep(900);
      collect(data?.query?.pages, 5);
    }
    // 第二轮：通用实拍补位（外观不足时凑满）
    const dataB = await api({
      action: 'query', generator: 'search',
      gsrsearch: `${core} filetype:bitmap`,
      gsrnamespace: '6', gsrlimit: '24',
      prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: '1280',
    });
    await sleep(900);
    collect(dataB?.query?.pages, 0);
    cands.sort((a, b) => b.sc - a.sc);
    const picks = cands.slice(0, 4);
    const got = [];
    let n = 0;
    for (const p of picks) {
      n++;
      const file = `assets/img/gal/${id}-${n}.jpg`;
      try {
        await download(p.ii.thumburl, path.join(ROOT, file));
        const em = p.ii.extmetadata || {};
        got.push({
          file,
          title: p.title,
          credit: stripTags(em.Artist?.value || 'Wikimedia Commons').slice(0, 70),
          license: stripTags(em.LicenseShortName?.value || 'see source'),
          src: p.ii.descriptionurl,
        });
        await sleep(500);
      } catch (e) { report.push(`     dl fail ${p.title}: ${e.message}`); }
    }
    if (got.length) { meta[id] = got; save(); }
    report.push(`${got.length >= 3 ? 'OK  ' : 'PART'} ${id.padEnd(18)} ${got.length} 张`);
  } catch (e) {
    report.push(`MISS ${id.padEnd(18)} ${e.message}`);
  }
  await sleep(1200);
}
save();
console.log(report.join('\n'));
console.log('---');
const okCount = Object.values(meta).filter((v) => v?.length >= 3).length;
console.log(`gallery: ${okCount}/${Object.keys(QUERIES).length} 座球场（≥3张）, 共 ${Object.values(meta).reduce((a, v) => a + (v?.length || 0), 0)} 张`);
