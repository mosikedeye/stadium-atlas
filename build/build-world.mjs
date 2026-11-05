// build-world.mjs — TopoJSON (world-atlas countries-110m) -> projected SVG paths for a static site.
// Usage: node build-world.mjs <input.json> <output.js>
import fs from 'node:fs';
import path from 'node:path';

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) {
  console.error('usage: node build-world.mjs <input.json> <output.js>');
  process.exit(1);
}

const topo = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const [sx, sy] = topo.transform.scale;
const [tx, ty] = topo.transform.translate;

// --- decode quantized, delta-encoded arcs into lon/lat ---
const arcs = topo.arcs.map((arc) => {
  let qx = 0, qy = 0;
  const out = new Array(arc.length);
  for (let i = 0; i < arc.length; i++) {
    qx += arc[i][0];
    qy += arc[i][1];
    out[i] = [qx * sx + tx, qy * sy + ty];
  }
  return out;
});

function ring(idxList) {
  const pts = [];
  for (const idx of idxList) {
    const a = idx < 0 ? arcs[~idx].slice().reverse() : arcs[idx];
    for (let i = pts.length ? 1 : 0; i < a.length; i++) pts.push(a[i]);
  }
  return pts;
}

// --- projection: Miller cylindrical, tuned for inhabited latitudes ---
const R = 1;
const miller = (latRad) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * latRad));

// collect polygons first so we can fit the projection to the actual data
const geo = [];
const typeCounts = {};
for (const f of topo.objects.countries.geometries) {
  typeCounts[f.type] = (typeCounts[f.type] || 0) + 1;
  if (f.id === '010' || f.id === 'ATA' || /antarctica/i.test(f.properties?.name || '')) continue;
  // TopoJSON geometries carry arc indices in `arcs` (not GeoJSON `coordinates`)
  const polys = f.type === 'Polygon' ? [f.arcs] : f.type === 'MultiPolygon' ? f.arcs : null;
  if (!Array.isArray(polys)) continue;
  const rings = [];
  for (const poly of polys) {
    const r = [];
    for (const rIdx of poly) {
      const pts = ring(rIdx);
      if (pts.length > 3) r.push(pts);
    }
    if (r.length) rings.push(r);
  }
  if (rings.length) geo.push({ name: f.properties?.name || '', id: String(f.id ?? ''), rings });
}

let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
const project = (lon, lat) => {
  const x = R * (lon * Math.PI) / 180;
  const y = -R * miller((lat * Math.PI) / 180);
  if (x < minX) minX = x;
  if (x > maxX) maxX = x;
  if (y < minY) minY = y;
  if (y > maxY) maxY = y;
  return [x, y];
};

// first pass: find bounds
for (const c of geo) for (const poly of c.rings) for (const r of poly) for (const [lon, lat] of r) project(lon, lat);

const WIDTH = 1000;
const scale = WIDTH / (maxX - minX);
const HEIGHT = Math.round((maxY - minY) * scale);
const ox = -minX * scale;
const oy = -minY * scale;

const fx = (lon, lat) => {
  const x = (R * (lon * Math.PI)) / 180;
  const y = -R * miller((lat * Math.PI) / 180);
  return [x * scale + ox, y * scale + oy];
};
const n = (v) => Math.round(v * 10) / 10;

const countries = [];
for (const c of geo) {
  let d = '';
  for (const poly of c.rings) {
    for (const r of poly) {
      if (r.length < 4) continue;
      const pts = r.map(([lon, lat]) => fx(lon, lat));
      // drop degenerate slivers
      let w = 0, h = 0;
      for (const p of pts) { w = Math.max(w, p[0]); h = Math.max(h, p[1]); }
      d += 'M' + pts.map((p) => n(p[0]) + ' ' + n(p[1])).join('L') + 'Z';
    }
  }
  if (d.length > 12) countries.push({ n: c.name, d });
}

// projection parameters so the browser can place lat/lon markers identically
const proj = { w: WIDTH, h: HEIGHT, scale, ox, oy };

const payload = 'window.WORLD_MAP=' + JSON.stringify({ ...proj, countries }) + ';\n';
fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
fs.writeFileSync(outFile, payload);
console.log(`countries=${countries.length} kept=${geo.length} types=${JSON.stringify(typeCounts)} size=${(payload.length / 1024).toFixed(1)}KB w=${WIDTH} h=${HEIGHT}`);
