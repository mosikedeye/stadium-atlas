/* stadium3d.js — 程序化生成的高保真可交互 3D 球场（three.js r159）
 * 数据驱动：容量 → 规模/看台层数；年代 → 灯光形式；主队配色 → 看台/大屏/广告牌。
 * 真实感要素：座位纹理、带过道的分块看台、桁架悬挑屋顶、环形 LED 广告牌、
 *             悬挂大屏幕、球门与球网、泛光灯辉光、阴影、夜景光照、观众点云。
 * 自由相机：左键旋转 / 右键或 Shift 平移 / 滚轮缩放 / 双指捏合 / 预设机位。
 * API: window.Stadium3D(container, s) -> { dispose(), attach(newContainer), setView(name), setAutoRotate(b) }
 */
(function () {
  'use strict';

  /* ---------- 颜色工具 ---------- */
  function hex2rgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function mixHex(h, target, t) {
    const [r, g, b] = hex2rgb(h);
    const f = target === 'w' ? 255 : 0;
    const m = (v) => Math.round(v + (f - v) * t);
    return '#' + ((1 << 24) + (m(r) << 16) + (m(g) << 8) + m(b)).toString(16).slice(1);
  }
  function lum(h) { const [r, g, b] = hex2rgb(h).map((v) => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

  /* ---------- 程序化纹理 ---------- */
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if ('colorSpace' in t && THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  function seatTexture(base) {
    return canvasTex(128, 128, (x) => {
      x.fillStyle = mixHex(base, 'b', 0.62);
      x.fillRect(0, 0, 128, 128);
      const seat = mixHex(base, 'w', 0.16), seat2 = mixHex(base, 'w', 0.3);
      for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 8; col++) {
          const off = row % 2 ? 8 : 0;
          const px = col * 16 + off, py = row * 12.8;
          x.fillStyle = Math.random() < 0.22 ? mixHex(base, 'b', 0.3) : (Math.random() < 0.5 ? seat : seat2);
          x.beginPath();
          x.roundRect ? x.roundRect(px + 2, py + 2, 11, 8, 2.5) : x.rect(px + 2, py + 2, 11, 8);
          x.fill();
          x.fillStyle = 'rgba(0,0,0,.28)';
          x.fillRect(px + 2, py + 9.5, 11, 1.6);
        }
      }
    });
  }

  function adTexture(c1) {
    return canvasTex(512, 64, (x, w, h) => {
      x.fillStyle = '#07090d'; x.fillRect(0, 0, w, h);
      x.font = '700 17px system-ui, sans-serif';
      x.textBaseline = 'middle';
      for (let i = 0; i < 4; i++) {
        x.fillStyle = i % 2 ? mixHex(c1, 'w', 0.25) : '#e8edf3';
        x.fillText('STADIUM ATLAS', i * 128 + 7, h / 2 - 4);
      }
      const g = x.createLinearGradient(0, h - 8, 0, h);
      g.addColorStop(0, 'rgba(215,255,63,0)'); g.addColorStop(1, 'rgba(215,255,63,.5)');
      x.fillStyle = g; x.fillRect(0, h - 8, w, 8);
    });
  }

  function screenTexture(s, c1) {
    return canvasTex(512, 288, (x, w, h) => {
      const g = x.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, mixHex(c1, 'b', 0.55)); g.addColorStop(1, '#05070a');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.strokeStyle = mixHex(c1, 'w', 0.3); x.lineWidth = 6;
      x.strokeRect(6, 6, w - 12, h - 12);
      x.fillStyle = '#f2f6fb';
      x.font = '800 64px system-ui, sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(s.nick || s.code, w / 2, h / 2 - 34);
      x.font = '600 40px system-ui, sans-serif';
      x.fillStyle = mixHex(c1, 'w', 0.45);
      x.fillText(s.cap.toLocaleString('en-US') + ' SEATS', w / 2, h / 2 + 40);
      x.font = '500 26px system-ui, sans-serif';
      x.fillStyle = 'rgba(255,255,255,.55)';
      x.fillText(s.clubEn.toUpperCase().slice(0, 26), w / 2, h / 2 + 96);
    });
  }

  function glowTexture() {
    return canvasTex(128, 128, (x, w, h) => {
      const g = x.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,250,225,.95)');
      g.addColorStop(0.25, 'rgba(255,244,200,.45)');
      g.addColorStop(1, 'rgba(255,240,190,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    });
  }

  /* ---------- 外立面纹理（按年代三种建筑风格，id 种子随机，每座球场独一无二） ---------- */
  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function facadeTextures(s, accent) {
    const style = s.opened < 1975 ? 'heritage' : s.opened < 2000 ? 'transitional' : 'modern';
    const rng = mulberry32(hashStr(s.id));
    const W = 384, H = 256; // 瓦片 = 12m × 8m
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    const base = mk(), emis = mk();
    const bx = base.getContext('2d'), ex = emis.getContext('2d');
    ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
    const warm = 'rgba(255,214,150,';

    if (style === 'heritage') {
      bx.fillStyle = '#4a352a'; bx.fillRect(0, 0, W, H);
      for (let i = 0; i < 900; i++) {
        bx.fillStyle = `rgba(${rng() < 0.5 ? '0,0,0' : '255,255,255'},${(0.03 + rng() * 0.05).toFixed(3)})`;
        bx.fillRect(rng() * W, rng() * H, 6 + rng() * 10, 3);
      }
      bx.fillStyle = 'rgba(0,0,0,.25)'; bx.fillRect(0, H * 0.52, W, 6);
      bx.fillStyle = 'rgba(230,225,215,.14)'; bx.fillRect(0, H * 0.52 - 3, W, 3);
      for (let i = 0; i < 6; i++) {
        const x = 16 + i * 62;
        bx.beginPath();
        bx.moveTo(x, H * 0.44); bx.lineTo(x, H * 0.2);
        bx.arc(x + 15, H * 0.2, 15, Math.PI, 0);
        bx.lineTo(x + 30, H * 0.44); bx.closePath();
        bx.fillStyle = '#1b120c'; bx.fill();
        if (rng() < 0.55) {
          bx.fillStyle = warm + '0.75)'; bx.fill();
          ex.fillStyle = warm + '0.7)'; ex.fill();
        }
        bx.strokeStyle = 'rgba(230,225,215,.22)'; bx.lineWidth = 2; bx.stroke();
      }
      for (let i = 0; i < 4; i++) {
        const x = 10 + i * 96;
        bx.fillStyle = '#0d0906'; bx.fillRect(x, H * 0.62, 64, H * 0.38);
        const g = bx.createLinearGradient(0, H * 0.62, 0, H);
        g.addColorStop(0, 'rgba(255,205,130,0)'); g.addColorStop(1, 'rgba(255,205,130,.5)');
        bx.fillStyle = g; bx.fillRect(x, H * 0.62, 64, H * 0.38);
        ex.fillStyle = 'rgba(255,200,120,.5)'; ex.fillRect(x + 6, H * 0.8, 52, H * 0.2);
      }
    } else if (style === 'transitional') {
      bx.fillStyle = '#494f58'; bx.fillRect(0, 0, W, H);
      for (let i = 0; i < 700; i++) { bx.fillStyle = `rgba(0,0,0,${(rng() * 0.06).toFixed(3)})`; bx.fillRect(rng() * W, rng() * H, 8, 4); }
      for (let i = 0; i < 12; i++) { bx.fillStyle = 'rgba(0,0,0,.22)'; bx.fillRect(i * 32, 0, 8, H); }
      bx.fillStyle = 'rgba(255,255,255,.08)'; bx.fillRect(0, H * 0.3, W, 4); bx.fillRect(0, H * 0.66, W, 4);
      for (let i = 0; i < 10; i++) {
        const x = 12 + i * 38, y = H * 0.36 + (i % 2) * (H * 0.16);
        bx.fillStyle = '#20262e'; bx.fillRect(x, y, 22, H * 0.12);
        if (rng() < 0.5) {
          bx.fillStyle = warm + '0.7)'; bx.fillRect(x + 2, y + 2, 18, H * 0.12 - 4);
          ex.fillStyle = warm + '0.6)'; ex.fillRect(x + 2, y + 2, 18, H * 0.12 - 4);
        }
      }
      for (let i = 0; i < 4; i++) {
        const x = 10 + i * 96;
        bx.fillStyle = '#14181d'; bx.fillRect(x, H * 0.72, 60, H * 0.28);
        ex.fillStyle = 'rgba(255,205,140,.4)'; ex.fillRect(x + 5, H * 0.86, 50, H * 0.14);
      }
    } else {
      bx.fillStyle = '#161c26'; bx.fillRect(0, 0, W, H);
      for (let gy = 0; gy < 8; gy++) {
        for (let gx = 0; gx < 12; gx++) {
          const x = gx * 32, y = gy * 32;
          bx.fillStyle = rng() < 0.18 ? 'rgba(120,150,190,.16)' : 'rgba(255,255,255,.03)';
          bx.fillRect(x + 2, y + 2, 28, 28);
          bx.strokeStyle = 'rgba(140,160,190,.18)'; bx.lineWidth = 1;
          bx.strokeRect(x + 2, y + 2, 28, 28);
          if (rng() < 0.16) {
            bx.fillStyle = warm + '0.5)'; bx.fillRect(x + 4, y + 4, 24, 24);
            ex.fillStyle = warm + '0.4)'; ex.fillRect(x + 4, y + 4, 24, 24);
          }
        }
      }
      bx.globalAlpha = 0.85; bx.fillStyle = accent; bx.fillRect(0, H * 0.52, W, 10); bx.globalAlpha = 1;
      ex.fillStyle = accent; ex.fillRect(0, H * 0.52, W, 10);
      for (let i = 0; i < 3; i++) {
        const x = 20 + i * 128;
        bx.fillStyle = '#0c1016'; bx.fillRect(x, H * 0.78, 88, H * 0.22);
        ex.fillStyle = 'rgba(255,215,160,.35)'; ex.fillRect(x + 8, H * 0.9, 72, H * 0.1);
      }
    }
    // 俱乐部垂幅旗帜
    const nBan = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < nBan; i++) {
      const x = 30 + Math.floor(rng() * (W - 80));
      bx.fillStyle = rng() < 0.5 ? s.c1 : (s.c2 === '#ffffff' ? '#d9dee6' : s.c2);
      bx.globalAlpha = 0.9; bx.fillRect(x, H * 0.08, 26, H * 0.5); bx.globalAlpha = 1;
      bx.fillStyle = 'rgba(255,255,255,.92)';
      bx.font = '700 15px system-ui, sans-serif';
      for (let k = 0; k < s.code.length; k++) bx.fillText(s.code[k], x + 6, H * 0.16 + k * 17);
    }
    const map = new THREE.CanvasTexture(base);
    const em = new THREE.CanvasTexture(emis);
    for (const t of [map, em]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      if ('colorSpace' in t && THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    }
    return { map, em, style };
  }

  function pitchTexture() {
    return canvasTex(1050, 680, (x) => {
      for (let i = 0; i < 12; i++) {
        x.fillStyle = i % 2 ? '#2f7d3a' : '#368c42';
        x.fillRect(i * 87.5, 0, 87.5, 680);
      }
      // 草皮磨损噪点
      for (let i = 0; i < 900; i++) {
        x.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.045)' : 'rgba(255,255,255,.03)';
        x.fillRect(Math.random() * 1050, Math.random() * 680, 3 + Math.random() * 5, 2);
      }
      x.strokeStyle = 'rgba(255,255,255,.88)';
      x.lineWidth = 3;
      const m = 30;
      x.strokeRect(m, m, 1050 - m * 2, 680 - m * 2);
      x.beginPath(); x.moveTo(525, m); x.lineTo(525, 680 - m); x.stroke();
      x.beginPath(); x.arc(525, 340, 91.5, 0, Math.PI * 2); x.stroke();
      x.fillStyle = '#fff';
      x.beginPath(); x.arc(525, 340, 4, 0, Math.PI * 2); x.fill();
      for (const side of [0, 1]) {
        const gx = side ? 1050 - m : m;
        const dir = side ? -1 : 1;
        x.strokeRect(side ? gx - 165 : gx, 340 - 201.5, 165, 403);
        x.strokeRect(side ? gx - 55 : gx, 340 - 91.5, 55, 183);
        x.beginPath(); x.arc(gx + dir * 110, 340, 4, 0, Math.PI * 2); x.fill();
        x.beginPath();
        x.arc(gx + dir * 165, 340, 91.5, side ? Math.PI * 0.72 : -Math.PI * 0.28, side ? Math.PI * 1.28 : Math.PI * 0.28);
        x.stroke();
      }
    });
  }

  /* ---------- 椭圆参数曲面（带 UV、支持弧段分块） ---------- */
  function bandGeometry(a, b, profile, seg, th0, thSpan, uPerM, vPerM) {
    th0 = th0 || 0;
    seg = seg || 96;
    thSpan = thSpan == null ? Math.PI * 2 : thSpan;
    uPerM = uPerM || 0.5; vPerM = vPerM || 0.55;
    const n = profile.length;
    const cum = [0];
    for (let j = 1; j < n; j++) {
      cum.push(cum[j - 1] + Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]));
    }
    const avgR = (a + b) / 2 + (profile[0][0] + profile[n - 1][0]) / 2;
    const pos = new Float32Array((seg + 1) * n * 3);
    const uv = new Float32Array((seg + 1) * n * 2);
    const idx = [];
    let v3 = 0, v2 = 0;
    for (let i = 0; i <= seg; i++) {
      const th = th0 + thSpan * (i / seg), c = Math.cos(th), sn = Math.sin(th);
      const arc = avgR * thSpan * (i / seg);
      for (let j = 0; j < n; j++) {
        pos[v3++] = (a + profile[j][0]) * c;
        pos[v3++] = profile[j][1];
        pos[v3++] = (b + profile[j][0]) * sn;
        uv[v2++] = arc * uPerM;
        uv[v2++] = cum[j] * vPerM;
      }
    }
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < n - 1; j++) {
        const A = i * n + j, B = A + 1, C = (i + 1) * n + j, D = C + 1;
        idx.push(A, C, B, B, C, D);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* ---------- 主函数 ---------- */
  window.Stadium3D = function (container, s, opts) {
    opts = opts || {};
    const disposables = [];
    const track = (d) => { disposables.push(d); return d; };

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    } catch (e) {
      container.innerHTML = '<div class="v3d-fallback">当前环境不支持 WebGL，请切换到「平面示意」</div>';
      return { dispose() { }, attach() { }, setView() { }, setAutoRotate() { }, failed: true };
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth || 320, container.clientHeight || 300);
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const nightBg = new THREE.Color('#06080c');
    scene.background = nightBg;
    scene.fog = new THREE.Fog('#06080c', 400, 950);
    const camera = new THREE.PerspectiveCamera(45, 16 / 10, 0.4, 2500);

    /* ----- 参数 ----- */
    const cap01 = Math.min(1, Math.max(0, (s.cap - 40000) / 60000));
    const tiers = s.cap >= 68000 ? 3 : 2;
    const a0 = 61 + cap01 * 7, b0 = 41 + cap01 * 6;
    const seatC = lum(s.c1) < 0.18 ? '#dfe6f0' : s.c1;
    const tier2C = lum(s.c2) > 0.55 ? mixHex(seatC, 'w', 0.34) : s.c2;
    const modern = s.opened >= 1995;

    /* ----- 灯光（夜场比赛氛围） ----- */
    const hemi = new THREE.HemisphereLight(0x9db4e8, 0x0a0d13, 0.42);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff4e0, 1.35);
    const fill = new THREE.DirectionalLight(0x7ea0ff, 0.3);
    fill.position.set(-120, 90, -140);
    scene.add(fill);

    /* ----- 地面 ----- */
    const ground = new THREE.Mesh(
      track(new THREE.CircleGeometry(620, 48)),
      track(new THREE.MeshStandardMaterial({ color: 0x0a0e14, roughness: 1 }))
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.6;
    scene.add(ground);

    /* ----- 材质 ----- */
    const seatTex1 = track(seatTexture(seatC));
    const seatTex2 = track(seatTexture(tier2C));
    const matSeat1 = track(new THREE.MeshStandardMaterial({ map: seatTex1, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }));
    const matSeat2 = track(new THREE.MeshStandardMaterial({ map: seatTex2, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }));
    const matConcrete = track(new THREE.MeshStandardMaterial({ color: 0x232b38, roughness: 0.95, side: THREE.DoubleSide }));
    const matDark = track(new THREE.MeshStandardMaterial({ color: 0x161d27, roughness: 0.9, side: THREE.DoubleSide }));
    const matRoof = track(new THREE.MeshStandardMaterial({ color: 0x333e4e, roughness: 0.5, metalness: 0.45, side: THREE.DoubleSide }));
    const matWall = track(new THREE.MeshStandardMaterial({ color: 0x1c2431, roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide }));
    const matGlow = track(new THREE.MeshBasicMaterial({ color: 0xfff6d8, side: THREE.DoubleSide }));
    const matSteel = track(new THREE.MeshStandardMaterial({ color: 0x3d4857, roughness: 0.55, metalness: 0.6 }));

    /* ----- 草坪 + 广告牌 + 球门 ----- */
    const pTex = track(pitchTexture());
    const pitch = new THREE.Mesh(
      track(new THREE.PlaneGeometry(105, 68)),
      track(new THREE.MeshStandardMaterial({ map: pTex, roughness: 0.95 }))
    );
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.y = 0.05;
    pitch.receiveShadow = true;
    scene.add(pitch);

    const adTex = track(adTexture(seatC));
    const adMat = track(new THREE.MeshBasicMaterial({ map: adTex }));
    for (const [geo, pos, rot] of [
      [new THREE.BoxGeometry(109, 1.05, 0.22), [0, 0.62, 35.6], 0],
      [new THREE.BoxGeometry(109, 1.05, 0.22), [0, 0.62, -35.6], 0],
      [new THREE.BoxGeometry(0.22, 1.05, 71.4), [54.8, 0.62, 0], 0],
      [new THREE.BoxGeometry(0.22, 1.05, 71.4), [-54.8, 0.62, 0], 0],
    ]) {
      const m = new THREE.Mesh(track(geo), adMat);
      m.position.set(...pos);
      scene.add(m);
    }
    const matPost = track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
    for (const side of [1, -1]) {
      const g = new THREE.Group();
      for (const z of [3.66, -3.66]) {
        const post = new THREE.Mesh(track(new THREE.CylinderGeometry(0.08, 0.08, 2.44, 8)), matPost);
        post.position.set(0, 1.22, z);
        g.add(post);
      }
      const bar = new THREE.Mesh(track(new THREE.CylinderGeometry(0.08, 0.08, 7.4, 8)), matPost);
      bar.rotation.x = Math.PI / 2;
      bar.position.y = 2.44;
      g.add(bar);
      const net = new THREE.Mesh(
        track(new THREE.BoxGeometry(2.1, 2.44, 7.32)),
        track(new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.16 }))
      );
      net.position.set(side * 1.1, 1.22, 0);
      g.add(net);
      g.position.x = side * 52.5;
      scene.add(g);
    }

    /* ----- 分块看台 ----- */
    const crowdPos = [];
    function blockedTier(a, b, baseY, depth, rise, mat, gapM) {
      const avgR = (a + b) / 2 + depth / 2;
      const blocks = Math.max(14, Math.min(44, Math.round((2 * Math.PI * avgR) / 9)));
      const step = (Math.PI * 2) / blocks;
      const gapAng = gapM / avgR;
      const span = step - gapAng;
      const seg = Math.max(3, Math.ceil(((a + depth) * span) / 2.2));
      const wallProf = [[0, baseY - 1.7], [0, baseY]];
      const rakeProf = [[0, baseY], [depth * 0.3, baseY + rise * 0.16], [depth * 0.65, baseY + rise * 0.52], [depth, baseY + rise]];
      for (let k = 0; k < blocks; k++) {
        const th0 = k * step + gapAng / 2;
        const wall = new THREE.Mesh(track(bandGeometry(a, b, wallProf, seg, th0, span)), matConcrete);
        wall.castShadow = true;
        scene.add(wall);
        const rake = new THREE.Mesh(track(bandGeometry(a, b, rakeProf, seg, th0, span)), mat);
        rake.castShadow = true; rake.receiveShadow = true;
        scene.add(rake);
        // 观众
        const per = Math.round(2400 / blocks) + Math.round(cap01 * 900 / blocks);
        for (let i = 0; i < per; i++) {
          const th = th0 + Math.random() * span;
          const d = Math.random() * depth;
          const frac = d / depth;
          const y = baseY + rise * (frac < 0.3 ? frac / 0.3 * 0.16 : frac < 0.65 ? 0.16 + (frac - 0.3) / 0.35 * 0.36 : 0.52 + (frac - 0.65) / 0.35 * 0.48) + 0.55;
          crowdPos.push((a + d) * Math.cos(th) + (Math.random() - 0.5) * 1.4, y, (b + d) * Math.sin(th) + (Math.random() - 0.5) * 1.4);
        }
      }
      // 顶部护栏带
      const rail = new THREE.Mesh(track(bandGeometry(a, b, [[depth, baseY + rise], [depth + 1.1, baseY + rise + 0.5]], 128)), matDark);
      scene.add(rail);
      return { a: a + depth, b: b + depth, y: baseY + rise };
    }

    const dL = 16 + cap01 * 5, hL = 11 + cap01 * 3;
    const T1 = blockedTier(a0, b0, 2.7, dL, hL, matSeat1, 1.7);
    let aT = T1.a + 2.2, bT = T1.b + 2.2, yT = T1.y + 1.1;

    const dU = 15 + cap01 * 5, hU = hL + 15 + cap01 * 5;
    const T2 = blockedTier(aT, bT, yT, dU, hU, matSeat2, 1.7);
    aT = T2.a + 2.2; bT = T2.b + 2.2; yT = T2.y + 1.1;

    if (tiers === 3) {
      const dT = 14 + cap01 * 4, hT = hU + 11 + cap01 * 3;
      const T3 = blockedTier(aT, bT, yT, dT, hT, matSeat1, 1.7);
      aT = T3.a + 2.2; bT = T3.b + 2.2; yT = T3.y + 1.1;
    }

    /* ----- 屋顶 + 桁架 + 外立面 ----- */
    const overhang = 10 + cap01 * 7;
    const roof = new THREE.Mesh(
      track(bandGeometry(aT, bT, [[-overhang, yT + 0.5], [-overhang * 0.5, yT + 1.8], [0, yT + 3], [6.5, yT + 4.6]], 168)),
      matRoof
    );
    roof.castShadow = true;
    scene.add(roof);
    /* ----- 外立面：年代建筑风格 + 亮灯窗户 + 主队色灯带 + 垂幅 ----- */
    const accentC = lum(s.c1) < 0.18 ? mixHex(s.c1, 'w', 0.55) : s.c1;
    const ft = facadeTextures(s, accentC);
    track(ft.map); track(ft.em);
    const matFacade = track(new THREE.MeshStandardMaterial({
      map: ft.map, emissiveMap: ft.em, emissive: 0xffffff, emissiveIntensity: 1.05,
      roughness: 0.88, metalness: 0.08, side: THREE.DoubleSide,
    }));
    const fascia = new THREE.Mesh(
      track(bandGeometry(aT + 6.5, bT + 6.5, [[0, yT + 4.6], [0, 0.3]], 168, 0, Math.PI * 2, 1 / 12, 1 / 8)),
      matFacade
    );
    fascia.castShadow = true;
    scene.add(fascia);
    const nTruss = 36;
    for (let i = 0; i < nTruss; i++) {
      const th = (i / nTruss) * Math.PI * 2;
      const truss = new THREE.Mesh(track(new THREE.BoxGeometry((aT + bT) / 2 * 0.02 + 0.55, 1.0, overhang + 7.5)), matSteel);
      truss.position.set((aT - overhang / 2) * Math.cos(th), yT + 1.6, (bT - overhang / 2) * Math.sin(th));
      truss.rotation.y = -th + Math.PI / 2;
      truss.rotation.z = 0.06;
      scene.add(truss);
    }
    // 立面竖肋
    for (let i = 0; i < 56; i++) {
      const th = (i / 56) * Math.PI * 2;
      const rib = new THREE.Mesh(track(new THREE.BoxGeometry(0.9, yT + 3.6, 0.9)), matDark);
      rib.position.set((aT + 7.1) * Math.cos(th), (yT + 3.6) / 2 + 0.3, (bT + 7.1) * Math.sin(th));
      rib.rotation.y = -th;
      scene.add(rib);
    }

    /* ----- 灯光系统 ----- */
    const glowTex = track(glowTexture());
    if (modern) {
      const strip = new THREE.Mesh(
        track(bandGeometry(aT - overhang + 1.2, bT - overhang + 1.2, [[0, yT - 0.15], [2.0, yT - 1.1]], 148)),
        matGlow
      );
      scene.add(strip);
      for (let i = 0; i < 8; i++) {
        const th = (i / 8) * Math.PI * 2 + 0.2;
        const sp = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.4 })));
        sp.scale.set(34, 22, 1);
        sp.position.set((aT - overhang + 2) * Math.cos(th), yT - 1.5, (bT - overhang + 2) * Math.sin(th));
        scene.add(sp);
      }
    } else {
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const px = sx * (aT * 0.78), pz = sz * (bT * 0.78);
        const mast = new THREE.Mesh(track(new THREE.CylinderGeometry(0.5, 0.8, yT + 22, 10)), matSteel);
        mast.position.set(px, (yT + 22) / 2, pz);
        mast.castShadow = true;
        scene.add(mast);
        const panel = new THREE.Mesh(track(new THREE.BoxGeometry(9.5, 5.4, 0.8)), matGlow);
        panel.position.set(px, yT + 20, pz);
        panel.rotation.y = -Math.atan2(pz, px) + Math.PI / 2;
        panel.rotation.x = 0.4;
        scene.add(panel);
        const sp = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 })));
        sp.scale.set(46, 34, 1);
        sp.position.set(px, yT + 20, pz);
        scene.add(sp);
        const pl = new THREE.PointLight(0xfff2cf, 0.5, 260, 2);
        pl.position.set(px * 0.8, yT + 18, pz * 0.8);
        scene.add(pl);
      }
    }

    /* ----- 悬挂大屏幕 ----- */
    const scrTex = track(screenTexture(s, seatC));
    const scrMat = track(new THREE.MeshBasicMaterial({ map: scrTex, side: THREE.DoubleSide }));
    for (const side of [1, -1]) {
      const scr = new THREE.Mesh(track(new THREE.BoxGeometry(0.6, 11.5, 21)), scrMat);
      scr.position.set(side * (aT - overhang * 0.45), yT - 7.5, 0);
      scene.add(scr);
      const hanger = new THREE.Mesh(track(new THREE.CylinderGeometry(0.18, 0.18, 8, 6)), matSteel);
      hanger.position.set(side * (aT - overhang * 0.45), yT - 1.6, 0);
      scene.add(hanger);
    }

    /* ----- 基座、入口闸口、广场灯柱、角塔 ----- */
    const plinth = new THREE.Mesh(
      track(bandGeometry(aT + 9.5, bT + 9.5, [[0, 0], [0, 2.6], [1.7, 2.6]], 168)),
      matConcrete
    );
    plinth.receiveShadow = true;
    scene.add(plinth);

    const gateMat = track(new THREE.MeshBasicMaterial({ color: 0xffcf96, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    const gateGeo = track(new THREE.PlaneGeometry(3.6, 2.2));
    const nGates = 30;
    for (let i = 0; i < nGates; i++) {
      const th = (i / nGates) * Math.PI * 2 + 0.06;
      const g = new THREE.Mesh(gateGeo, gateMat);
      g.position.set((aT + 9.8) * Math.cos(th), 1.35, (bT + 9.8) * Math.sin(th));
      g.rotation.y = -th + Math.PI / 2;
      scene.add(g);
    }

    const bolGeo = track(new THREE.CylinderGeometry(0.14, 0.2, 3.4, 6));
    const bolGlowMat = track(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.28 }));
    for (let i = 0; i < 18; i++) {
      const th = (i / 18) * Math.PI * 2 + 0.1;
      const bx2 = (aT + 21) * Math.cos(th), bz2 = (bT + 21) * Math.sin(th);
      const b = new THREE.Mesh(bolGeo, matSteel);
      b.position.set(bx2, 1.7, bz2);
      b.castShadow = true;
      scene.add(b);
      const sp = new THREE.Sprite(bolGlowMat);
      sp.scale.set(5, 3.4, 1);
      sp.position.set(bx2, 3.5, bz2);
      scene.add(sp);
    }

    if (ft.style === 'heritage') {
      const matBrick = track(new THREE.MeshStandardMaterial({ color: 0x503a2c, roughness: 1 }));
      const matCap = track(new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.8 }));
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const px = sx * (aT * 0.74 + 9), pz = sz * (bT * 0.74 + 9);
        const h = yT + 8;
        const tow = new THREE.Mesh(track(new THREE.BoxGeometry(9.5, h, 9.5)), matBrick);
        tow.position.set(px, h / 2, pz);
        tow.rotation.y = Math.PI / 4;
        tow.castShadow = true;
        scene.add(tow);
        const cap = new THREE.Mesh(track(new THREE.BoxGeometry(11.5, 1.3, 11.5)), matCap);
        cap.position.set(px, h + 0.5, pz);
        cap.rotation.y = Math.PI / 4;
        scene.add(cap);
        const lamp = new THREE.Sprite(bolGlowMat);
        lamp.scale.set(7, 5, 1);
        lamp.position.set(px, h + 1.8, pz);
        scene.add(lamp);
      }
    }

    /* ----- 观众点云 ----- */
    if (crowdPos.length) {
      const g = track(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.Float32BufferAttribute(crowdPos, 3));
      const cols = [];
      const palette = [hex2rgb(seatC), hex2rgb(tier2C), [228, 232, 238], [46, 50, 60], hex2rgb(mixHex(seatC, 'w', 0.4))];
      for (let i = 0; i < crowdPos.length / 3; i++) {
        const c = palette[(Math.random() * palette.length) | 0];
        cols.push(c[0] / 255, c[1] / 255, c[2] / 255);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      scene.add(new THREE.Points(g, track(new THREE.PointsMaterial({ size: 1.0, vertexColors: true, sizeAttenuation: true }))));
    }

    /* ----- 阴影与主光 ----- */
    key.position.set(aT * 1.5, aT * 2.4, aT * 1.1);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -aT * 1.7; sc.right = aT * 1.7; sc.top = aT * 1.7; sc.bottom = -aT * 1.7;
    sc.near = aT * 0.4; sc.far = aT * 6;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.5;
    scene.add(key);
    ground.receiveShadow = true;
    pitch.receiveShadow = true;

    /* ----- 场底平台 ----- */
    const podium = new THREE.Mesh(
      track(new THREE.CircleGeometry(aT + 30, 64)),
      track(new THREE.MeshStandardMaterial({ color: 0x11161e, roughness: 1 }))
    );
    podium.rotation.x = -Math.PI / 2;
    podium.position.y = -0.35;
    podium.receiveShadow = true;
    scene.add(podium);

    /* ----- 自由相机 ----- */
    const target = new THREE.Vector3(0, yT * 0.3, 0);
    const tTarget = target.clone();
    let az = 0.75, el = 0.38, dist = (aT + 58) * 2.35;
    let tAz = az, tEl = el, tDist = dist;
    let auto = true;
    const DMIN = 7, DMAX = 950;

    function clampT() {
      tEl = Math.min(1.553, Math.max(0.012, tEl));
      tDist = Math.min(DMAX, Math.max(DMIN, tDist));
      tTarget.x = Math.min(aT * 0.85, Math.max(-aT * 0.85, tTarget.x));
      tTarget.z = Math.min(bT * 0.85, Math.max(-bT * 0.85, tTarget.z));
      tTarget.y = Math.min(yT * 0.95, Math.max(0, tTarget.y));
    }
    function placeCamera() {
      camera.position.set(
        target.x + dist * Math.cos(el) * Math.cos(az),
        target.y + dist * Math.sin(el),
        target.z + dist * Math.cos(el) * Math.sin(az)
      );
      camera.lookAt(target);
      camera.updateMatrixWorld();
    }
    const VIEWS = {
      orbit: { el: 0.38, dist: (aT + 58) * 2.35, tx: 0, ty: yT * 0.3, tz: 0, auto: false },
      aerial: { el: 0.92, dist: aT * 3.6, tx: 0, ty: 0, tz: 0, auto: true },
      top: { el: 1.52, dist: aT * 3.0, tx: 0, ty: 0, tz: 0, auto: false },
      stand: { el: 0.1, dist: a0 * 0.82, tx: 0, ty: 5, tz: 0, auto: false },
      pitch: { el: 0.045, dist: 24, tx: 0, ty: 2.2, tz: 0, auto: false },
      corner: { el: 0.3, dist: aT * 1.7, tx: 0, ty: yT * 0.25, tz: 0, auto: false },
      facade: { el: 0.15, dist: aT * 2.5, tx: 0, ty: yT * 0.32, tz: 0, auto: true },
    };
    function setView(name) {
      const v = VIEWS[name];
      if (!v) return;
      tEl = v.el; tDist = v.dist;
      tTarget.set(v.tx, v.ty, v.tz);
      auto = !!v.auto;
      clampT();
    }
    function setAutoRotate(b) { auto = !!b; }

    /* ----- 指针交互 ----- */
    const canvas = renderer.domElement;
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    const pointers = new Map();
    let mode = null, lx = 0, ly = 0, pinch0 = 0, pinchDist0 = 0;
    const vRight = new THREE.Vector3(), vUp = new THREE.Vector3();

    function down(e) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      auto = false;
      if (pointers.size === 1) {
        mode = (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
        lx = e.clientX; ly = e.clientY;
        canvas.style.cursor = mode === 'pan' ? 'move' : 'grabbing';
      } else if (pointers.size === 2) {
        mode = 'pinch';
        const [p1, p2] = [...pointers.values()];
        pinch0 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        pinchDist0 = tDist;
        lx = (p1.x + p2.x) / 2; ly = (p1.y + p2.y) / 2;
      }
    }
    function move(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (mode === 'orbit') {
        tAz -= (e.clientX - lx) * 0.0055;
        tEl += (e.clientY - ly) * 0.0042;
        lx = e.clientX; ly = e.clientY;
        clampT();
      } else if (mode === 'pan') {
        const sc2 = tDist * 0.0011;
        vRight.setFromMatrixColumn(camera.matrix, 0);
        vUp.setFromMatrixColumn(camera.matrix, 1);
        tTarget.addScaledVector(vRight, -(e.clientX - lx) * sc2);
        tTarget.addScaledVector(vUp, (e.clientY - ly) * sc2);
        lx = e.clientX; ly = e.clientY;
        clampT();
      } else if (mode === 'pinch' && pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        if (pinch0 > 0) tDist = Math.min(DMAX, Math.max(DMIN, pinchDist0 * (pinch0 / Math.max(1, d))));
        tAz -= (mx - lx) * 0.004;
        tEl += (my - ly) * 0.003;
        lx = mx; ly = my;
        clampT();
      }
    }
    function up(e) {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) { mode = null; canvas.style.cursor = 'grab'; }
      else if (pointers.size === 1) {
        mode = 'orbit';
        const p = [...pointers.values()][0];
        lx = p.x; ly = p.y;
      }
    }
    function wheel(e) {
      e.preventDefault();
      auto = false;
      tDist = Math.min(DMAX, Math.max(DMIN, tDist * Math.exp(e.deltaY * 0.0011)));
    }
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    /* ----- 尺寸与容器切换（全屏） ----- */
    function resize() {
      const w = container.clientWidth || 320, h = container.clientHeight || 300;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    let ro = new ResizeObserver(resize);
    ro.observe(container);
    function attach(newContainer) {
      if (!newContainer || newContainer === container) return;
      ro.disconnect();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      container = newContainer;
      container.appendChild(canvas);
      ro = new ResizeObserver(resize);
      ro.observe(container);
      resize();
    }

    /* ----- 渲染循环 ----- */
    let raf = 0, alive = true;
    function frame() {
      if (!alive) return;
      if (auto) tAz += 0.0024;
      az += (tAz - az) * 0.1;
      el += (tEl - el) * 0.1;
      dist += (tDist - dist) * 0.1;
      target.lerp(tTarget, 0.1);
      placeCamera();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }
    resize();
    placeCamera();
    frame();

    return {
      attach,
      setView,
      setAutoRotate,
      dispose() {
        alive = false;
        cancelAnimationFrame(raf);
        ro.disconnect();
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
        canvas.removeEventListener('wheel', wheel);
        scene.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        });
        disposables.forEach((d) => d.dispose && d.dispose());
        renderer.dispose();
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      },
    };
  };
})();
