/* STADIUM ATLAS — 交互与渲染 */
(function () {
  'use strict';

  const W = window.WORLD_MAP;
  const STADIUMS = window.STADIUMS;
  const LEAGUES = window.LEAGUES;
  const LEAGUE_ORDER = ['EPL', 'LALIGA', 'SERIEA', 'BUNDES', 'LIGUE1', 'EUOTHER', 'SA'];
  const NS = 'http://www.w3.org/2000/svg';
  const DEG = Math.PI / 180;

  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');

  /* ---------- color helpers ---------- */
  function hex2rgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function hexA(h, a) { const [r, g, b] = hex2rgb(h); return `rgba(${r},${g},${b},${a})`; }
  function shade(h, p) {
    const [r, g, b] = hex2rgb(h);
    const f = p < 0 ? 0 : 255, t = Math.abs(p);
    const m = (v) => Math.round(v + (f - v) * t);
    return `rgb(${m(r)},${m(g)},${m(b)})`;
  }
  function lum(h) { const [r, g, b] = hex2rgb(h).map((v) => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

  /* ---------- projection (must match build-world.mjs) ---------- */
  function project(lat, lon) {
    const x = (lon * DEG) * W.scale + W.ox;
    const y = -(1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * lat * DEG))) * W.scale + W.oy;
    return [x, y];
  }

  /* ---------- prepare data ---------- */
  STADIUMS.forEach((s) => {
    const [x, y] = project(s.lat, s.lon);
    s.x = x; s.y = y;
    s.color = LEAGUES[s.league].color;
    s.r = 3 + Math.max(0, s.cap - 40000) / 8500;
  });
  const maxCap = Math.max(...STADIUMS.map((s) => s.cap));
  const byCap = [...STADIUMS].sort((a, b) => b.cap - a.cap);
  byCap.forEach((s, i) => (s.rank = i + 1));
  const byId = (id) => STADIUMS.find((s) => s.id === id);

  const state = { leagues: new Set(), minCap: 40000, q: '', sel: null };
  let visibleIds = new Set(STADIUMS.map((s) => s.id));

  /* ---------- dom refs ---------- */
  const svg = $('#map');
  const viewport = $('#viewport');
  const gGrat = $('#graticule');
  const gLand = $('#land');
  const gMarkers = $('#markers');
  const mapWrap = $('#map-wrap');
  const tooltip = $('#tooltip');
  const listEl = $('#club-list');
  const chipsEl = $('#league-chips');
  const detailEl = $('#detail');
  const detailBody = $('#detail-body');
  const detailPos = $('#detail-pos');

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  /* ---------- build map ---------- */
  svg.setAttribute('viewBox', `0 0 ${W.w} ${W.h}`);

  for (let lon = -180; lon <= 180; lon += 30) {
    const [x] = project(0, lon);
    el('line', { x1: x, y1: 0, x2: x, y2: W.h }, gGrat);
  }
  for (let lat = -60; lat <= 80; lat += 20) {
    const [, y] = project(lat, 0);
    el('line', { x1: 0, y1: y, x2: W.w, y2: y, class: lat === 0 ? 'equator' : '' }, gGrat);
  }
  for (const c of W.countries) {
    el('path', { d: c.d, class: 'land' }, gLand);
  }

  const markerEls = new Map();
  const markerBodies = [];
  STADIUMS.forEach((s, i) => {
    const g = el('g', {
      class: 'marker', 'data-id': s.id,
      transform: `translate(${s.x.toFixed(1)} ${s.y.toFixed(1)})`,
    }, gMarkers);
    g.style.setProperty('--c', s.color);
    g.style.setProperty('--r', s.r.toFixed(2));
    g.style.setProperty('--i', i);
    const body = el('g', { class: 'm-body' }, g);
    el('circle', { class: 'pulse', r: s.r * 1.4, cx: 0, cy: 0 }, body);
    el('circle', { class: 'halo', r: s.r * 2.5, cx: 0, cy: 0 }, body);
    el('circle', { class: 'core', r: s.r.toFixed(1), cx: 0, cy: 0 }, body);
    const label = el('text', { class: 'mlabel', y: -(s.r + 8).toFixed(1) }, body);
    label.textContent = s.code;
    markerBodies.push(body);

    g.addEventListener('pointerenter', () => showTip(s));
    g.addEventListener('pointerleave', hideTip);
    g.addEventListener('click', (e) => { e.stopPropagation(); select(s.id, { fly: true }); });
    markerEls.set(s.id, g);
  });

  /* ---------- view / zoom / pan ---------- */
  const view = { x: 0, y: 0, k: 1 };
  let animId = null;

  function clampView() {
    view.k = Math.min(14, Math.max(1, view.k));
    if (view.k <= 1.0001) { view.x = 0; view.y = 0; return; }
    view.x = Math.min(0, Math.max(W.w - W.w * view.k, view.x));
    view.y = Math.min(0, Math.max(W.h - W.h * view.k, view.y));
  }
  function applyView() {
    viewport.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
    const ik = (1 / view.k).toFixed(4);
    for (const b of markerBodies) b.setAttribute('transform', `scale(${ik})`);
    $('#zoom-level').textContent = view.k.toFixed(1) + '×';
  }
  function clampTarget(x, y, k) {
    k = Math.min(14, Math.max(1, k));
    if (k <= 1.0001) return { x: 0, y: 0, k: 1 };
    return {
      x: Math.min(0, Math.max(W.w - W.w * k, x)),
      y: Math.min(0, Math.max(W.h - W.h * k, y)),
      k,
    };
  }
  function animateTo(tx, ty, tk, dur = 700) {
    const t = clampTarget(tx, ty, tk);
    cancelAnimationFrame(animId);
    const sx = view.x, sy = view.y, sk = view.k, t0 = performance.now();
    function step(now) {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      view.x = sx + (t.x - sx) * e;
      view.y = sy + (t.y - sy) * e;
      view.k = sk + (t.k - sk) * e;
      applyView();
      if (p < 1) animId = requestAnimationFrame(step);
    }
    animId = requestAnimationFrame(step);
  }
  function flyTo(lat, lon, k, dur) {
    const [px, py] = project(lat, lon);
    animateTo(W.w / 2 - k * px, W.h / 2 - k * py, k, dur);
  }
  function toSvg(cx, cy) {
    const pt = svg.createSVGPoint();
    pt.x = cx; pt.y = cy;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }
  function zoomAt(p, factor) {
    const k2 = Math.min(14, Math.max(1, view.k * factor));
    const ratio = k2 / view.k;
    view.x = p.x - (p.x - view.x) * ratio;
    view.y = p.y - (p.y - view.y) * ratio;
    view.k = k2;
    clampView(); applyView();
    setPreset(null);
  }

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(toSvg(e.clientX, e.clientY), Math.exp(-e.deltaY * 0.0016));
  }, { passive: false });

  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y, moved: false };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('dragging');
    cancelAnimationFrame(animId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    view.x = drag.vx + (e.clientX - drag.px) / ctm.a;
    view.y = drag.vy + (e.clientY - drag.py) / ctm.d;
    if (Math.abs(e.clientX - drag.px) + Math.abs(e.clientY - drag.py) > 4) drag.moved = true;
    clampView(); applyView();
    if (drag.moved) setPreset(null);
  });
  svg.addEventListener('pointerup', (e) => {
    svg.classList.remove('dragging');
    if (drag && !drag.moved && !(e.target.closest && e.target.closest('.marker'))) deselect();
    drag = null;
  });
  svg.addEventListener('pointercancel', () => { drag = null; svg.classList.remove('dragging'); });

  $('#zoom-in').addEventListener('click', () => zoomAt({ x: W.w / 2, y: W.h / 2 }, 1.5));
  $('#zoom-out').addEventListener('click', () => zoomAt({ x: W.w / 2, y: W.h / 2 }, 1 / 1.5));

  const PRESETS = {
    world:   { title: '世界视图', lat: 20, lon: 8, k: 1 },
    europe:  { title: '欧洲视图', lat: 48.5, lon: 9, k: 3.4 },
    britain: { title: '英伦三岛', lat: 53.8, lon: -2.8, k: 7.2 },
    sa:      { title: '南美视图', lat: -26, lon: -56, k: 2.4 },
  };
  function setPreset(name) {
    document.querySelectorAll('#preset-row button').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
    if (name) $('#map-title-text').textContent = PRESETS[name].title;
  }
  document.querySelectorAll('#preset-row button').forEach((b) => {
    b.addEventListener('click', () => {
      const p = PRESETS[b.dataset.view];
      setPreset(b.dataset.view);
      flyTo(p.lat, p.lon, p.k);
    });
  });

  /* ---------- tooltip ---------- */
  function showTip(s) {
    const g = markerEls.get(s.id);
    const r = g.getBoundingClientRect();
    const wr = mapWrap.getBoundingClientRect();
    tooltip.style.setProperty('--c', s.color);
    tooltip.innerHTML =
      `<div class="tt-club">${s.club}</div>
       <div class="tt-stadium">${s.stadium} · ${s.city}</div>
       <div class="tt-cap">${fmt(s.cap)} 席 · ${LEAGUES[s.league].name}</div>
       <div class="tt-bar"><i style="width:${(s.cap / maxCap * 100).toFixed(0)}%"></i></div>`;
    tooltip.style.left = (r.left - wr.left + r.width / 2) + 'px';
    tooltip.style.top = (r.top - wr.top) + 'px';
    tooltip.hidden = false;
  }
  function hideTip() { tooltip.hidden = true; }

  /* ---------- filters ---------- */
  function filtered() {
    const q = state.q.trim().toLowerCase();
    return byCap.filter((s) => {
      if (state.leagues.size && !state.leagues.has(s.league)) return false;
      if (s.cap < state.minCap) return false;
      if (q) {
        const hay = [s.club, s.clubEn, s.stadium, s.stadiumEn, s.city, s.country, s.nick, LEAGUES[s.league].name]
          .join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function buildChips() {
    const counts = {};
    STADIUMS.forEach((s) => (counts[s.league] = (counts[s.league] || 0) + 1));
    let html = `<button class="chip all on" data-league=""><span class="cdot"></span>全部<span class="ccount">${STADIUMS.length}</span></button>`;
    for (const key of LEAGUE_ORDER) {
      html += `<button class="chip" data-league="${key}" style="--c:${LEAGUES[key].color}">
        <span class="cdot"></span>${LEAGUES[key].name}<span class="ccount">${counts[key] || 0}</span></button>`;
    }
    chipsEl.innerHTML = html;
    chipsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      const key = btn.dataset.league;
      if (!key) state.leagues.clear();
      else if (state.leagues.has(key)) state.leagues.delete(key);
      else state.leagues.add(key);
      syncChips(); renderAll();
    });
  }
  function syncChips() {
    chipsEl.querySelectorAll('.chip').forEach((c) => {
      const key = c.dataset.league;
      c.classList.toggle('on', key ? state.leagues.has(key) : state.leagues.size === 0);
    });
  }

  function buildLegend() {
    $('#legend-leagues').innerHTML = LEAGUE_ORDER
      .map((k) => `<span class="lg" style="--c:${LEAGUES[k].color}"><i></i>${LEAGUES[k].name}</span>`)
      .join('');
  }

  const searchEl = $('#search');
  searchEl.addEventListener('input', () => {
    state.q = searchEl.value;
    $('#clear-search').hidden = !state.q;
    renderAll();
  });
  $('#clear-search').addEventListener('click', () => {
    searchEl.value = ''; state.q = ''; $('#clear-search').hidden = true; renderAll(); searchEl.focus();
  });

  const slider = $('#cap-slider');
  function syncSlider() {
    const v = state.minCap;
    slider.value = v;
    slider.style.setProperty('--fill', ((v - 40000) / 45000 * 100).toFixed(1) + '%');
    $('#cap-value').textContent = v <= 40000 ? '≥ 40,000' : '≥ ' + fmt(v);
  }
  slider.addEventListener('input', () => { state.minCap = +slider.value; syncSlider(); renderAll(); });

  /* ---------- list ---------- */
  function renderList(list) {
    if (!list.length) {
      listEl.innerHTML = '<li class="empty-hint">没有匹配的球场<br>试试放宽筛选条件</li>';
      return;
    }
    listEl.innerHTML = list.map((s, i) => {
      const cr = ((window.CLUB_CRESTS || {})[s.id] || [])[0];
      return `
      <li class="row${state.sel === s.id ? ' sel' : ''}" data-id="${s.id}" style="--c:${s.color};animation-delay:${Math.min(i * 22, 500)}ms">
        <span class="rank">${String(s.rank).padStart(2, '0')}</span>
        <span class="row-mark">${cr
          ? `<img class="row-crest" src="${cr.file}" alt="" loading="lazy">`
          : '<span class="dot"></span>'}</span>
        <span class="who">
          <b>${s.club}</b>
          <i>${s.stadium} · ${s.city}</i>
          <span class="minibar"><i style="--w:${(s.cap / maxCap * 100).toFixed(1)}%"></i></span>
        </span>
        <span class="cap">${fmt(s.cap)}</span>
      </li>`;
    }).join('');
    listEl.querySelectorAll('img.row-crest').forEach((im) => im.addEventListener('error', () => {
      const d = document.createElement('span');
      d.className = 'dot';
      im.replaceWith(d);
    }));
  }
  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (row) select(row.dataset.id, { fly: true });
  });
  listEl.addEventListener('pointerover', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const g = markerEls.get(row.dataset.id);
    if (g) g.classList.add('hot');
  });
  listEl.addEventListener('pointerout', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const g = markerEls.get(row.dataset.id);
    if (g) g.classList.remove('hot');
  });

  /* ---------- stats ---------- */
  function tweenNum(node, to, dur = 650) {
    const from = parseFloat(node.dataset.v || '0');
    node.dataset.v = to;
    if (from === to) { node.textContent = fmt(to); return; }
    const t0 = performance.now();
    function step(t) {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      node.textContent = fmt(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function renderStats(list) {
    $('#stat-count').textContent = list.length;
    const total = list.reduce((a, s) => a + s.cap, 0);
    tweenNum($('#stat-total'), total);
    tweenNum($('#stat-avg'), list.length ? total / list.length : 0);
    const big = list.length ? list[0] : null;
    const bigEl = $('#stat-big');
    bigEl.textContent = big ? big.nick : '–';
    bigEl.title = big ? `${big.stadium} · ${fmt(big.cap)} 席` : '';
    const old = list.length ? [...list].sort((a, b) => a.opened - b.opened)[0] : null;
    const oldEl = $('#stat-old');
    oldEl.textContent = old ? old.opened + ' 年' : '–';
    oldEl.title = old ? `${old.stadium} · ${old.city}` : '';
    $('#list-count').textContent = `${list.length} / ${STADIUMS.length}`;
  }

  /* ---------- detail panel ---------- */
  function crestSVG(s) {
    const gid = 'cg-' + s.id;
    const dark = lum(s.c1) < 0.16;
    const base = dark ? shade(s.c1, 0.22) : s.c1;
    const tip = lum(s.c2) > 0.6 ? shade(base, -0.45) : s.c2;
    const txt = lum(base) > 0.55 ? '#14161a' : '#ffffff';
    return `<svg class="crest" viewBox="0 0 64 72" aria-hidden="true">
      <defs>
        <linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${base}"/><stop offset="1" stop-color="${tip}"/>
        </linearGradient>
      </defs>
      <path d="M32 2.5 60.5 10.5V38c0 16.5-12 26.8-28.5 31.5C15.5 64.8 3.5 54.5 3.5 38V10.5Z"
        fill="url(#${gid})" stroke="rgba(255,255,255,.38)" stroke-width="1.4"/>
      <path d="M32 6.5 56.8 13.4V38c0 14-10.3 23.2-24.8 27.8C17.5 61.2 7.2 52 7.2 38V13.4Z"
        fill="rgba(0,0,0,.16)"/>
      <path d="M32 2.5 60.5 10.5V22H3.5V10.5Z" fill="rgba(255,255,255,.12)"/>
      <text x="32" y="44" text-anchor="middle" fill="${txt}">${s.code}</text>
    </svg>`;
  }

  function bowlSVG(s) {
    const cx = 152, yTop = 74, depth = 30, steps = 6;
    const cap01 = Math.min(1, Math.max(0, (s.cap - 40000) / 45000));
    const rxOut = 104 + cap01 * 18, ryOut = rxOut * 0.56;
    const rxU = rxOut - 17, ryU = ryOut - 11;
    const rxL = rxU - 16, ryL = ryU - 11;
    const rxP = rxL - 9, ryP = ryL - 8;
    const seat = lum(s.c1) < 0.18 ? '#dfe6f0' : s.c1;
    const tier2 = lum(s.c2) > 0.55 ? shade(seat, 0.3) : s.c2;

    let out = `<svg viewBox="0 0 304 196" aria-hidden="true">
      <defs>
        <linearGradient id="pit-${s.id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#357f43"/><stop offset="1" stop-color="#1e5a2b"/>
        </linearGradient>
        <radialGradient id="shd-${s.id}" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="rgba(0,0,0,.5)"/><stop offset="1" stop-color="rgba(0,0,0,0)"/>
        </radialGradient>
      </defs>
      <ellipse cx="${cx}" cy="${yTop + depth + 16}" rx="${rxOut * 1.08}" ry="15" fill="url(#shd-${s.id})"/>`;

    for (let i = steps; i >= 1; i--) {
      const y = yTop + (i / steps) * depth;
      const a = 0.45 + 0.55 * (1 - i / steps);
      out += `<ellipse cx="${cx}" cy="${y}" rx="${rxOut}" ry="${ryOut}" fill="none" stroke="rgba(15,20,28,${a})" stroke-width="10"/>`;
      out += `<ellipse cx="${cx}" cy="${y}" rx="${rxU}" ry="${ryU}" fill="none" stroke="${hexA(seat, 0.05 + 0.14 * a)}" stroke-width="16"/>`;
      out += `<ellipse cx="${cx}" cy="${y}" rx="${rxL}" ry="${ryL}" fill="none" stroke="${hexA(tier2, 0.04 + 0.1 * a)}" stroke-width="11"/>`;
    }

    out += `<ellipse cx="${cx}" cy="${yTop}" rx="${rxOut}" ry="${ryOut}" fill="none" stroke="rgba(233,237,243,.24)" stroke-width="8"/>`;
    out += `<ellipse cx="${cx}" cy="${yTop}" rx="${rxOut}" ry="${ryOut}" fill="none" stroke="rgba(0,0,0,.4)" stroke-width="8" stroke-dasharray="1.4 5.2"/>`;
    out += `<ellipse cx="${cx}" cy="${yTop}" rx="${rxU}" ry="${ryU}" fill="none" stroke="${seat}" stroke-width="16" opacity=".95"/>`;
    out += `<ellipse cx="${cx}" cy="${yTop}" rx="${rxU}" ry="${ryU}" fill="none" stroke="rgba(6,8,12,.45)" stroke-width="16" stroke-dasharray="1.8 3.6"/>`;
    out += `<ellipse cx="${cx}" cy="${yTop}" rx="${rxL}" ry="${ryL}" fill="none" stroke="${tier2}" stroke-width="11" opacity=".82"/>`;
    out += `<ellipse cx="${cx}" cy="${yTop}" rx="${rxL}" ry="${ryL}" fill="none" stroke="rgba(6,8,12,.4)" stroke-width="11" stroke-dasharray="1.4 3"/>`;

    const px = cx - rxP, py = yTop - ryP, pw = rxP * 2, ph = ryP * 2;
    out += `<clipPath id="pc-${s.id}"><rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="7"/></clipPath>`;
    out += `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="7" fill="url(#pit-${s.id})" stroke="rgba(255,255,255,.22)" stroke-width=".8"/>`;
    out += `<g clip-path="url(#pc-${s.id})">`;
    const stripes = 7, sw = pw / stripes;
    for (let i = 0; i < stripes; i += 2) {
      out += `<rect x="${px + i * sw}" y="${py}" width="${sw}" height="${ph}" fill="rgba(255,255,255,.05)"/>`;
    }
    out += `<line x1="${cx}" y1="${py}" x2="${cx}" y2="${py + ph}" stroke="rgba(255,255,255,.4)" stroke-width=".8"/>`;
    out += `<circle cx="${cx}" cy="${yTop}" r="${(ryP * 0.42).toFixed(1)}" fill="none" stroke="rgba(255,255,255,.4)" stroke-width=".8"/>`;
    out += `</g>`;

    for (const ang of [-148, -32, 32, 148]) {
      const fx = cx + Math.cos(ang * DEG) * (rxOut + 3);
      const fy = yTop + Math.sin(ang * DEG) * (ryOut + 3);
      out += `<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="5" fill="rgba(255,250,214,.15)"/>`;
      out += `<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="1.7" fill="#fff8d6"/>`;
    }
    return out + '</svg>';
  }

  function compareHTML(s) {
    const top = byCap.slice(0, 4).map((x) => x.id);
    let rows = byCap.slice(0, 4);
    if (!top.includes(s.id)) rows = [...rows.slice(0, 3), s].sort((a, b) => b.cap - a.cap);
    return rows.map((x) => `
      <div class="cmp${x.id === s.id ? ' self' : ''}" style="--c:${x.id === s.id ? 'var(--accent)' : x.color}">
        <span class="cmp-n">${x.club}</span>
        <span class="cmp-t"><i style="--w:${(x.cap / maxCap * 100).toFixed(1)}%"></i></span>
        <span class="cmp-v">${fmt(x.cap)}</span>
      </div>`).join('');
  }

  let viewer3d = null;

  function crestHTML(s) {
    const map = window.CLUB_CRESTS || {};
    const list = (map[s.id] || []).filter((c) => c && c.file);
    if (!list.length) return crestSVG(s); // 无真实队徽时退回生成图形
    return `<div class="crest-real${list.length > 1 ? ' duo' : ''}">` +
      list.map((c) => `<img src="${c.file}" alt="${c.title} 队徽" title="${c.title} · 图片来源 Wikipedia，版权归俱乐部">`).join('') +
      '</div>';
  }

  let panoView = null;
  let activeView = null;   // 'pano' | '3d'
  let fsFrom = null;       // 进入全屏前画布所在的行内容器

  function currentViewer() { return activeView === 'pano' ? panoView : viewer3d; }

  function panoCreditText(s) {
    const p = (window.STADIUM_PANOS || {})[s.id];
    return p ? `360° 实拍全景 © ${p.credit} · ${p.license} · Wikimedia Commons` : '';
  }

  function closeFullscreen() {
    const ov = document.getElementById('v3d-overlay');
    if (!ov) return;
    const v = currentViewer();
    if (v && fsFrom && document.body.contains(fsFrom)) v.attach(fsFrom);
    fsFrom = null;
    ov.remove();
    document.body.classList.remove('no-scroll');
  }

  function openFullscreen() {
    const v = currentViewer();
    if (!v || v.failed || document.getElementById('v3d-overlay')) return;
    const s = byId(state.sel);
    if (!s) return;
    const isPano = activeView === 'pano';
    const ov = document.createElement('div');
    ov.className = 'v3d-overlay';
    ov.id = 'v3d-overlay';
    ov.innerHTML = `
      <div class="v3d-ov-head">
        <div class="v3d-ov-title"><b>${s.stadium} · ${isPano ? '实拍全景漫游' : '3D 模型'}</b><span>${s.club} · ${fmt(s.cap)} 席 · ${s.city}</span></div>
        <div class="v3d-ov-presets">
          ${isPano
            ? '<button data-act="cruise" class="on">⟳ 自动巡航</button>'
            : `<button data-view="orbit" class="on">环绕</button>
               <button data-view="aerial">航拍</button>
               <button data-view="stand">看台席</button>
               <button data-view="pitch">草皮</button>
               <button data-view="top">俯瞰</button>
               <button data-view="corner">斜角</button>
               <button data-view="facade">外观</button>`}
        </div>
        <button class="v3d-ov-close" type="button">✕ 退出全屏 (Esc)</button>
      </div>
      <div class="v3d-ov-stage" id="v3d-ov-stage"></div>
      <div class="v3d-ov-hint">${isPano
        ? '拖拽环视四周 · 滚轮缩放视野 · 触屏双指捏合' + (panoCreditText(s) ? ' · ' + panoCreditText(s) : '')
        : '左键拖拽旋转 · 右键 / Shift+拖拽平移 · 滚轮缩放（可一直拉近到场内任意位置） · 触屏双指捏合'}</div>`;
    document.body.appendChild(ov);
    document.body.classList.add('no-scroll');
    fsFrom = detailBody.querySelector(isPano ? '#d-viewpano' : '#d-view3d');
    v.attach(document.getElementById('v3d-ov-stage'));
    const presetBtns = ov.querySelectorAll('.v3d-ov-presets button[data-view]');
    presetBtns.forEach((b) => b.addEventListener('click', () => {
      presetBtns.forEach((x) => x.classList.toggle('on', x === b));
      if (viewer3d) viewer3d.setView(b.dataset.view);
    }));
    const cruiseBtn = ov.querySelector('[data-act="cruise"]');
    if (cruiseBtn && panoView) {
      cruiseBtn.classList.toggle('on', panoView.isCruising());
      cruiseBtn.addEventListener('click', () => {
        panoView.setCruise(!panoView.isCruising());
        cruiseBtn.classList.toggle('on', panoView.isCruising());
      });
    }
    ov.querySelector('.v3d-ov-close').addEventListener('click', closeFullscreen);
  }

  function disposeViewers() {
    closeFullscreen();
    if (panoView) { try { panoView.dispose(); } catch (e) { /* noop */ } panoView = null; }
    if (viewer3d) { try { viewer3d.dispose(); } catch (e) { /* noop */ } viewer3d = null; }
    activeView = null;
  }

  /* ---------- 外观实拍画廊 · 灯箱 ---------- */
  let lightbox = null;
  function closeLightbox() {
    if (!lightbox) return;
    lightbox.el.remove();
    lightbox = null;
    if (!document.getElementById('v3d-overlay')) document.body.classList.remove('no-scroll');
  }
  function openLightbox(list, idx) {
    closeLightbox();
    const el = document.createElement('div');
    el.className = 'lightbox';
    el.innerHTML = `
      <button class="lb-x" type="button" title="关闭 (Esc)">✕</button>
      <button class="lb-nav lb-prev" type="button" title="上一张 (←)">‹</button>
      <figure class="lb-fig"><img alt="球场外观实拍"><figcaption class="lb-cap"></figcaption></figure>
      <button class="lb-nav lb-next" type="button" title="下一张 (→)">›</button>`;
    document.body.appendChild(el);
    document.body.classList.add('no-scroll');
    const img = el.querySelector('img');
    const cap = el.querySelector('.lb-cap');
    let cur = idx;
    function show() {
      const g = list[cur];
      img.src = g.file;
      cap.innerHTML = `<a href="${g.src}" target="_blank" rel="noopener">${g.credit || 'Wikimedia Commons'}</a> · ${g.license || ''} · Wikimedia Commons<span class="lb-pos">${cur + 1} / ${list.length}</span>`;
    }
    show();
    const step = (d) => { cur = (cur + d + list.length) % list.length; show(); };
    el.querySelector('.lb-x').addEventListener('click', closeLightbox);
    el.querySelector('.lb-prev').addEventListener('click', (e) => { e.stopPropagation(); step(-1); });
    el.querySelector('.lb-next').addEventListener('click', (e) => { e.stopPropagation(); step(1); });
    el.addEventListener('click', (e) => { if (e.target === el) closeLightbox(); });
    lightbox = { el, step };
  }

  function renderDetail(s) {
    disposeViewers();
    closeLightbox();
    const pct = (s.cap / maxCap * 100).toFixed(0);
    const img = (window.STADIUM_IMAGES || {})[s.id];
    const hasPano = !!(window.STADIUM_PANOS || {})[s.id];
    const gal = (window.STADIUM_GALLERY || {})[s.id] || [];
    detailBody.innerHTML = `
      <div class="d-hero${img ? '' : ' nophoto'}" style="--c1:${s.c1};--c2:${s.c2}">
        ${img ? `<img class="d-hero-img" src="${img.file}" alt="${s.stadium}实拍照片">` : ''}
        <div class="d-hero-shade"></div>
        <div class="d-hero-id">
          ${crestHTML(s)}
          <div class="d-hero-text">
            <div class="d-club">${s.club}</div>
            <div class="d-club-en">${s.clubEn}</div>
            <div class="d-stadium">${s.stadium}<small>${s.stadiumEn} · ${s.city}</small></div>
          </div>
        </div>
        ${img ? `<div class="d-hero-credit"><a href="${img.src}" target="_blank" rel="noopener">${img.credit}</a> · ${img.license} · Wikimedia Commons</div>` : ''}
      </div>

      <div class="d-tags">
        <span class="tag" style="--c:${s.color}">${LEAGUES[s.league].name}</span>
        <span class="tag" style="--c:#8a94a6">${s.opened} 年启用</span>
        <span class="tag" style="--c:#8a94a6">${s.nick || '—'}</span>
      </div>

      <div class="d-cap"><b id="d-cap-num">0</b><span>容量（席）· 全场第 ${s.rank} 大 · 最大球场的 ${pct}%</span></div>
      <div class="d-capbar"><i id="d-capbar-i"></i></div>

      <div class="d-tabs">
        ${hasPano ? '<button class="d-tab on" data-tab="pano" type="button">🌄 实拍漫游</button>' : ''}
        <button class="d-tab${hasPano ? '' : ' on'}" data-tab="3d" type="button">3D 模型</button>
        <button class="d-tab" data-tab="svg" type="button">平面示意</button>
      </div>
      ${hasPano ? `
      <div class="d-viewpano" id="d-viewpano">
        <button class="v3d-full" id="vpano-full" type="button" hidden>⛶ 全屏查看</button>
        <span class="v3d-hint">拖拽环视 · 滚轮缩放</span>
      </div>` : ''}
      <div class="d-view3d" id="d-view3d"${hasPano ? ' hidden' : ''}>
        <button class="v3d-full" id="v3d-full" type="button" hidden>⛶ 全屏查看</button>
        <span class="v3d-hint">拖拽旋转 · 滚轮缩放</span>
      </div>
      <div class="d-bowl" id="d-bowl" hidden>${bowlSVG(s)}
        <div class="d-bowl-cap">STANDS DIAGRAM · 按容量与主队配色生成</div>
      </div>
      ${hasPano ? `<div class="d-pano-credit">${panoCreditText(s)}</div>` : ''}

      ${gal.length ? `
      <div class="d-section-title">外观实拍 · ${gal.length} 张</div>
      <div class="d-gallery" id="d-gallery">
        ${gal.map((g, i) => `<img src="${g.file}" alt="${s.stadium}外观实拍 ${i + 1}" loading="lazy" data-i="${i}" title="点击放大">`).join('')}
      </div>` : ''}

      <div class="d-section-title">容量对比 · TOP</div>
      <div class="d-compare">${compareHTML(s)}</div>

      <div class="d-section-title">档案</div>
      <div class="d-meta">
        <div class="m"><span>启用年份</span><b>${s.opened}</b></div>
        <div class="m"><span>坐标</span><b class="num">${Math.abs(s.lat).toFixed(2)}°${s.lat >= 0 ? 'N' : 'S'} ${Math.abs(s.lon).toFixed(2)}°${s.lon >= 0 ? 'E' : 'W'}</b></div>
        <div class="m"><span>城市</span><b>${s.city}</b></div>
        <div class="m"><span>国家</span><b>${s.country}</b></div>
      </div>

      <p class="d-fact">${s.fact}</p>`;

    const viewPano = detailBody.querySelector('#d-viewpano');
    const view3d = detailBody.querySelector('#d-view3d');
    const bowl = detailBody.querySelector('#d-bowl');
    const tabs = detailBody.querySelectorAll('.d-tab');
    activeView = hasPano ? 'pano' : '3d';

    function initPano() {
      if (!panoView && window.PanoView && window.THREE && viewPano && !viewPano.hidden && viewPano.clientWidth > 0) {
        panoView = window.PanoView(viewPano, s.id, {});
        activeView = 'pano';
        const full = detailBody.querySelector('#vpano-full');
        if (full && !panoView.failed) {
          full.hidden = false;
          full.addEventListener('click', openFullscreen);
        }
      }
    }
    function init3d() {
      if (!viewer3d && window.Stadium3D && window.THREE && view3d && !view3d.hidden && view3d.clientWidth > 0) {
        viewer3d = window.Stadium3D(view3d, s, {});
        activeView = '3d';
        const full = detailBody.querySelector('#v3d-full');
        if (full && !viewer3d.failed) {
          full.hidden = false;
          full.addEventListener('click', openFullscreen);
        }
      }
    }
    tabs.forEach((btn) => btn.addEventListener('click', () => {
      tabs.forEach((b) => b.classList.toggle('on', b === btn));
      const t = btn.dataset.tab;
      if (viewPano) viewPano.hidden = t !== 'pano';
      view3d.hidden = t !== '3d';
      bowl.hidden = t !== 'svg';
      if (t !== 'svg') activeView = t;
      if (t === 'pano') initPano();
      if (t === '3d') init3d();
    }));
    const galEl = detailBody.querySelector('#d-gallery');
    if (galEl && gal.length) {
      galEl.addEventListener('click', (e) => {
        const im = e.target.closest('img');
        if (im) openLightbox(gal, +im.dataset.i || 0);
      });
    }
    const crestBox = detailBody.querySelector('.crest-real');
    if (crestBox) {
      crestBox.querySelectorAll('img').forEach((im) => im.addEventListener('error', () => {
        im.remove();
        if (!crestBox.querySelector('img')) crestBox.outerHTML = crestSVG(s);
      }));
    }
    const heroImg = detailBody.querySelector('.d-hero-img');
    if (heroImg) {
      heroImg.addEventListener('error', () => {
        heroImg.remove();
        const hero = detailBody.querySelector('.d-hero');
        if (hero) hero.classList.add('nophoto');
      });
    }
    requestAnimationFrame(() => {
      const bar = detailBody.querySelector('#d-capbar-i');
      if (bar) bar.style.width = pct + '%';
      if (hasPano) initPano(); else init3d();
    });
    tweenNum($('#d-cap-num'), s.cap, 750);
    detailBody.scrollTop = 0;
  }

  function updateDetailPos(list) {
    const idx = list.findIndex((s) => s.id === state.sel);
    detailPos.textContent = idx >= 0 ? `${idx + 1} / ${list.length}` : '';
  }

  function select(id, opts = {}) {
    const s = byId(id);
    if (!s) return;
    state.sel = id;
    markerEls.forEach((g, mid) => g.classList.toggle('sel', mid === id));
    listEl.querySelectorAll('.row').forEach((r) => r.classList.toggle('sel', r.dataset.id === id));
    const row = listEl.querySelector(`.row[data-id="${id}"]`);
    if (row && opts.scrollList !== false) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    detailEl.hidden = false; // 先显示面板，保证 3D 容器初始化时有尺寸
    renderDetail(s);
    updateDetailPos(filtered());
    if (opts.fly && view.k < 4.5) flyTo(s.lat, s.lon, 5.6);
    hideTip();
  }
  function deselect() {
    if (!state.sel) return;
    state.sel = null;
    disposeViewers();
    markerEls.forEach((g) => g.classList.remove('sel'));
    listEl.querySelectorAll('.row.sel').forEach((r) => r.classList.remove('sel'));
    detailEl.hidden = true;
  }

  $('#detail-close').addEventListener('click', deselect);
  $('#prev-btn').addEventListener('click', () => stepSel(-1));
  $('#next-btn').addEventListener('click', () => stepSel(1));
  function stepSel(d) {
    const list = filtered();
    if (!list.length) return;
    const idx = list.findIndex((s) => s.id === state.sel);
    const next = list[(idx + d + list.length) % list.length];
    select(next.id, { fly: true });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (lightbox) { closeLightbox(); return; }
      if (document.getElementById('v3d-overlay')) { closeFullscreen(); return; }
      deselect();
    }
    if (lightbox) {
      if (e.key === 'ArrowLeft') lightbox.step(-1);
      if (e.key === 'ArrowRight') lightbox.step(1);
      return;
    }
    if (detailEl.hidden || document.getElementById('v3d-overlay')) return;
    if (e.key === 'ArrowLeft') stepSel(-1);
    if (e.key === 'ArrowRight') stepSel(1);
  });

  /* ---------- render all ---------- */
  function renderAll() {
    const list = filtered();
    visibleIds = new Set(list.map((s) => s.id));
    markerEls.forEach((g, id) => g.classList.toggle('dim', !visibleIds.has(id)));
    renderList(list);
    renderStats(list);
    if (state.sel) {
      if (!visibleIds.has(state.sel)) deselect();
      else updateDetailPos(list);
    }
  }

  /* ---------- init ---------- */
  buildChips();
  buildLegend();
  syncSlider();
  applyView();
  renderAll();
  setPreset('world');
  setTimeout(() => { if (!state.sel) select(byCap[0].id, { scrollList: false }); }, 1100);
})();
