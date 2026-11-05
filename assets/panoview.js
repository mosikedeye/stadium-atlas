/* panoview.js — 实拍 360° 全景漫游器（three.js）
 * 相机位于全景球心：拖拽转头（带惯性）、滚轮缩放 FOV、双指捏合、自动巡航。
 * 数据来自 assets/pano/<id>.js（dataURL，懒加载，file:// 下可用作 WebGL 纹理）。
 * API: window.PanoView(container, stadiumId, opts) -> { dispose(), attach(el), setCruise(b), isCruising(), failed? }
 */
(function () {
  'use strict';

  function ensurePanoScript(file) {
    return new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = file;
      sc.onload = () => res();
      sc.onerror = () => rej(new Error('pano script load failed'));
      document.head.appendChild(sc);
    });
  }

  window.PanoView = function (container, id, opts) {
    opts = opts || {};
    const info = (window.STADIUM_PANOS || {})[id];
    const api = {
      failed: false,
      dispose() { }, attach() { }, setCruise() { }, isCruising() { return false; },
    };
    if (!info || !window.THREE) {
      container.innerHTML = '<div class="v3d-fallback">该球场暂无实拍全景</div>';
      api.failed = true;
      return api;
    }

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch (e) {
      container.innerHTML = '<div class="v3d-fallback">当前环境不支持 WebGL</div>';
      api.failed = true;
      return api;
    }
    container.classList.add('pview-loading');
    const spin = document.createElement('div');
    spin.className = 'pview-spin';
    spin.textContent = '实拍全景加载中…';
    container.appendChild(spin);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth || 320, container.clientHeight || 300);
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(78, 16 / 10, 0.1, 120);
    camera.position.set(0, 0, 0);

    const geo = new THREE.SphereGeometry(50, 72, 36);
    geo.scale(-1, 1, 1); // 翻面：从球内看
    const mat = new THREE.MeshBasicMaterial({ color: 0x11151c });
    const sphere = new THREE.Mesh(geo, mat);
    scene.add(sphere);

    /* ----- 姿态 ----- */
    let yaw = opts.yaw != null ? opts.yaw : 2.4;
    let pitch = -0.05;
    let tYaw = yaw, tPitch = pitch;
    let fov = 78, tFov = fov;
    let cruise = true;
    const dir = new THREE.Vector3();

    function setCruise(b) {
      cruise = !!b;
      try { container.dataset.cruise = cruise ? 'on' : 'off'; } catch (e) { /* noop */ }
      if (opts.onCruise) { try { opts.onCruise(cruise); } catch (e) { /* noop */ } }
    }
    setCruise(true);

    /* ----- 纹理懒加载 ----- */
    let disposed = false;
    ensurePanoScript(info.file).then(() => {
      const dataUrl = (window.__PANOS__ || {})[id];
      if (!dataUrl) throw new Error('no pano data');
      return new Promise((res, rej) => new THREE.TextureLoader().load(dataUrl, res, undefined, rej));
    }).then((tex) => {
      if (disposed) { tex.dispose(); return; }
      if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      mat.map = tex;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
      container.classList.remove('pview-loading');
      if (spin.parentNode) spin.remove();
      container.dataset.loaded = '1';
    }).catch(() => {
      if (disposed) return;
      container.classList.remove('pview-loading');
      if (spin.parentNode) spin.remove();
      container.innerHTML = '<div class="v3d-fallback">全景加载失败</div>';
      api.failed = true;
    });

    /* ----- 交互：拖拽转头 / 滚轮 FOV / 双指捏合 ----- */
    const canvas = renderer.domElement;
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    const pointers = new Map();
    let dragging = false, lx = 0, ly = 0, pinch0 = 0, pinchFov0 = 78;

    function fovScale() { return fov / 78; }
    function down(e) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      setCruise(false);
      if (pointers.size === 1) {
        dragging = true; lx = e.clientX; ly = e.clientY;
        canvas.style.cursor = 'grabbing';
      } else if (pointers.size === 2) {
        dragging = false;
        const [p1, p2] = [...pointers.values()];
        pinch0 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        pinchFov0 = tFov;
      }
    }
    function move(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (dragging && pointers.size === 1) {
        tYaw -= (e.clientX - lx) * 0.0034 * fovScale();
        tPitch = Math.min(1.45, Math.max(-1.45, tPitch + (e.clientY - ly) * 0.0034 * fovScale()));
        lx = e.clientX; ly = e.clientY;
      } else if (pointers.size === 2 && pinch0 > 0) {
        const [p1, p2] = [...pointers.values()];
        const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        tFov = Math.min(100, Math.max(26, pinchFov0 * (pinch0 / Math.max(1, d))));
      }
    }
    function up(e) {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) { dragging = false; canvas.style.cursor = 'grab'; }
    }
    function wheel(e) {
      e.preventDefault();
      setCruise(false);
      tFov = Math.min(100, Math.max(26, tFov * Math.exp(e.deltaY * 0.0009)));
    }
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });

    /* ----- 尺寸与容器切换 ----- */
    function resize() {
      const w = container.clientWidth || 320, h = container.clientHeight || 300;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    let ro = new ResizeObserver(resize);
    ro.observe(container);
    function attach(newContainer) {
      if (!newContainer || newContainer === container || disposed) return;
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
      raf = requestAnimationFrame(frame);
      if (!container.clientWidth) return; // 隐藏时暂停渲染
      if (cruise) tYaw += 0.0016;
      yaw += (tYaw - yaw) * 0.085;
      pitch += (tPitch - pitch) * 0.085;
      fov += (tFov - fov) * 0.12;
      if (Math.abs(fov - camera.fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
      dir.set(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
      camera.lookAt(dir);
      renderer.render(scene, camera);
    }
    resize();
    frame();

    api.dispose = function () {
      disposed = true; alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
      if (mat.map) mat.map.dispose();
      geo.dispose(); mat.dispose();
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      if (spin.parentNode) spin.remove();
    };
    api.attach = attach;
    api.setCruise = setCruise;
    api.isCruising = () => cruise;
    return api;
  };
})();
