'use client';

/**
 * The read-surface lead in 3D (#6740): pages a call (log spaced) across, thinking in depth, quota cost per accepted
 * page up (log), colour the CER difference from live on a diverging scale fixed to ±1 pp, so a sheet of one colour
 * reads as "accuracy does not move". Swapped: height the CER difference on the same fixed ±1 pp (a flat sheet), colour
 * the cost. Each cell a point with its 95 % interval as a whisker; the surface is the quadratic interpolant through
 * the nine cells (it passes through every point; between them it is a guide, not a fit).
 *
 * Loaded with next/dynamic { ssr: false }; renders on demand (no animation loop). No WebGL → onFail, and the page
 * keeps the grid. Drag (mouse or touch) to rotate; tap a point for its numbers.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RAMP, LIVE, TEAL, MUTED, INK, GRID } from '../SurfaceCharts';
import { MARGIN_PP, PPC, THINKS, cerColour, type Cell } from './lead';

export interface Surface3DProps { cells: Cell[]; swap: boolean; resetKey: number; onPick: (c: Cell | null) => void; onFail: () => void }

const XS = PPC.map((p) => (2 * Math.log2(p)) / 3 - 1);   // 1 → −1, 4 → 1/3, 8 → 1
const ZS = [1, 0, -1];                                      // low in front, high (the tall, costly row) at the back
const H = 1.5;                                             // height of the box
const VIEW = { theta: Math.PI / 2 - 0.5, phi: 1.0, r: 5.4 };   // from the front-right: pages a call reads left to right

const lagrange = (nodes: number[], t: number) => nodes.map((_, i) => nodes.reduce((p, nj, j) => (j === i ? p : (p * (t - nj)) / (nodes[i] - nj)), 1));
/** Quadratic interpolant through a 3 × 3 table v[think][ppc] at (x, z). */
const interp = (v: number[][], x: number, z: number) => {
  const lx = lagrange(XS, x), lz = lagrange(ZS, z);
  let s = 0; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) s += lz[a] * lx[b] * v[a][b];
  return s;
};
const rampColour = (t: number) => {
  const u = Math.max(0, Math.min(1, t)) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(u));
  return new THREE.Color(RAMP[i]).lerp(new THREE.Color(RAMP[i + 1]), u - i);
};

let LABEL_K = 1;   // labels a third larger on a phone
function label(text: string, colour: string, size0 = 0.16) {
  const size = size0 * LABEL_K;
  const c = document.createElement('canvas'), ctx = c.getContext('2d')!;
  const font = '500 44px ui-sans-serif, system-ui, sans-serif';
  ctx.font = font; const w = Math.ceil(ctx.measureText(text).width) + 16;
  c.width = w; c.height = 60; ctx.font = font; ctx.fillStyle = colour; ctx.textBaseline = 'middle'; ctx.fillText(text, 8, 31);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set((size * w) / 60, size, 1); s.renderOrder = 10;
  return s;
}

const niceUsd = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

export default function Surface3D({ cells, swap, resetKey, onPick, onFail }: Surface3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ reset: () => void } | null>(null);

  useEffect(() => {
    const el = host.current; if (!el) return;
    LABEL_K = el.clientWidth < 500 ? 1.35 : 1;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { onFail(); return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.display = 'block';
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    const target = new THREE.Vector3(0, H / 2 - 0.25, 0.1);
    const view = { ...VIEW };
    const place = () => {
      camera.position.set(target.x + view.r * Math.sin(view.phi) * Math.cos(view.theta), target.y + view.r * Math.cos(view.phi), target.z + view.r * Math.sin(view.phi) * Math.sin(view.theta));
      camera.lookAt(target);
    };
    const render = () => renderer.render(scene, camera);
    const size = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false); renderer.domElement.style.width = `${w}px`; renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / Math.max(1, h); view.r = w < 500 ? 6.4 : VIEW.r; camera.updateProjectionMatrix(); place(); render();
    };

    // ── what goes up, what colours it ──
    const ok = cells.every((c) => c.usd_1k_accepted !== null && c.d_cer_pp !== null);
    const vals = cells.flatMap((c) => [c.usd_1k_accepted, ...(c.cpa_iv ?? [])]).filter((v): v is number => v !== null && v > 0);
    const lo = Math.log10(Math.max(0.5, Math.min(...vals) * 0.8)), hi = Math.log10(Math.max(...vals) * 1.15);
    const costT = (usd: number) => (Math.log10(usd) - lo) / (hi - lo);   // 0 … 1
    const cerT = (pp: number) => 0.5 + Math.max(-1, Math.min(1, pp / MARGIN_PP)) / 2;
    const heightOf = (c: { usd: number | null; pp: number | null }) => (swap ? (c.pp === null ? null : H * cerT(c.pp)) : c.usd === null ? null : H * costT(c.usd));
    const colourOf = (usd: number | null, pp: number | null) => (swap ? (usd === null ? new THREE.Color(MUTED) : rampColour(0.15 + 0.85 * costT(usd))) : new THREE.Color(...cerColour(pp)));
    const cellAt = (a: number, b: number) => cells.find((c) => c.think === THINKS[a] && c.ppc === PPC[b])!;

    // floor and frame
    const lineMat = new THREE.LineBasicMaterial({ color: GRID });
    const seg: number[] = [];
    for (const x of XS) seg.push(x, 0, -1.15, x, 0, 1.15);
    for (const z of ZS) seg.push(-1.15, 0, z, 1.15, 0, z);
    const floor = new THREE.BufferGeometry(); floor.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    scene.add(new THREE.LineSegments(floor, lineMat));
    // height axis on the back-left corner, with ticks
    const ax: number[] = [-1.15, 0, -1.15, -1.15, H, -1.15];
    const ticks: [number, string][] = swap
      ? [-1, -0.5, 0, 0.5, 1].map((v) => [H * cerT(v * MARGIN_PP), `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * MARGIN_PP)} pp`])
      : niceUsd.filter((u) => Math.log10(u) >= lo && Math.log10(u) <= hi).map((u) => [H * costT(u), `$${u}`]);
    for (const [y] of ticks) ax.push(-1.15, y, -1.15, 1.15, y, -1.15, -1.15, y, -1.15, -1.15, y, 1.15);
    const axg = new THREE.BufferGeometry(); axg.setAttribute('position', new THREE.Float32BufferAttribute(ax, 3));
    scene.add(new THREE.LineSegments(axg, new THREE.LineBasicMaterial({ color: GRID, transparent: true, opacity: 0.55 })));
    for (const [y, t] of ticks) { const s = label(t, MUTED, 0.13); s.position.set(-1.32, y, -1.2); s.center.set(1, 0.5); scene.add(s); }
    const yl = label(swap ? 'CER vs live' : '$ / 1,000 accepted', INK, 0.14); yl.position.set(-1.15, H + 0.18, -1.15); scene.add(yl);
    PPC.forEach((p, i) => { const s = label(String(p), MUTED, 0.15); s.position.set(XS[i], -0.05, 1.42); scene.add(s); });
    const xl = label('pages a call', INK, 0.14); xl.position.set(0, -0.05, 1.75); scene.add(xl);
    THINKS.forEach((t, i) => { const s = label(t, MUTED, 0.14); s.position.set(1.42, -0.05, ZS[i]); s.center.set(0, 0.5); scene.add(s); });
    const zl = label('thinking', INK, 0.14); zl.position.set(1.42, -0.05, -1.5); zl.center.set(0, 0.5); scene.add(zl);

    // the sheet through the nine cells
    if (ok) {
      const hv = [0, 1, 2].map((a) => [0, 1, 2].map((b) => { const c = cellAt(a, b); return swap ? c.d_cer_pp! : Math.log10(c.usd_1k_accepted!); }));
      const cv = [0, 1, 2].map((a) => [0, 1, 2].map((b) => { const c = cellAt(a, b); return swap ? Math.log10(c.usd_1k_accepted!) : c.d_cer_pp!; }));
      const N = 28, pos: number[] = [], col: number[] = [], idx: number[] = [];
      for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
        const x = -1 + (2 * j) / N, z = -1 + (2 * i) / N;
        const h = interp(hv, x, z), cc = interp(cv, x, z);
        const y = swap ? H * cerT(h) : H * Math.max(-0.05, Math.min(1.05, (h - lo) / (hi - lo)));
        pos.push(x, y, z);
        const k = swap ? colourOf(Math.pow(10, cc), null) : colourOf(null, cc);
        col.push(k.r, k.g, k.b);
      }
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const a = i * (N + 1) + j, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
      scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.78, depthWrite: false })));
      const wire = new THREE.WireframeGeometry(g);
      scene.add(new THREE.LineSegments(wire, new THREE.LineBasicMaterial({ color: '#0d1117', transparent: true, opacity: 0.18 })));
    }

    // points, whiskers, live and optimum
    const picks: { mesh: THREE.Mesh; cell: Cell }[] = [];
    const whisk: number[] = [];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      const c = cellAt(a, b), x = XS[b], z = ZS[a];
      const y = heightOf({ usd: c.usd_1k_accepted, pp: c.d_cer_pp });
      if (y === null) continue;
      const k = colourOf(c.usd_1k_accepted, c.d_cer_pp);
      const m = new THREE.Mesh(new THREE.SphereGeometry(c.live || c.optimum ? 0.065 : 0.05, 20, 14), new THREE.MeshBasicMaterial({ color: k }));
      m.position.set(x, y, z); scene.add(m); picks.push({ mesh: m, cell: c });
      const edge = new THREE.Mesh(new THREE.SphereGeometry(c.live || c.optimum ? 0.08 : 0.062, 20, 14), new THREE.MeshBasicMaterial({ color: c.live ? LIVE : c.optimum ? TEAL : '#0d1117', side: THREE.BackSide }));
      edge.position.copy(m.position); scene.add(edge);
      const iv = swap ? c.d_cer_iv : c.cpa_iv;
      if (iv) {
        const y0 = heightOf({ usd: iv[0], pp: iv[0] })!, y1 = heightOf({ usd: iv[1], pp: iv[1] })!;
        whisk.push(x, y0, z, x, y1, z, x - 0.04, y0, z, x + 0.04, y0, z, x - 0.04, y1, z, x + 0.04, y1, z);
      }
      // a drop line to the floor, so a point's place on the grid can be read
      whisk.push(x, 0, z, x, Math.min(y, iv ? heightOf({ usd: iv[0], pp: iv[0] })! : y), z);
      if (c.live || c.optimum) {
        const s = label(c.live && c.optimum ? 'live = optimum' : c.live ? 'live' : 'optimum', c.live ? LIVE : TEAL, 0.15);
        s.position.set(x, y + 0.24, z); scene.add(s);
      }
    }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(whisk, 3));
    scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.7 })));

    // ── interaction: drag rotates, a tap without a drag picks ──
    const cv = renderer.domElement;
    let drag: { x: number; y: number; moved: number; id: number } | null = null;
    const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId }; cv.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
      view.theta += dx * 0.01; view.phi = Math.max(0.15, Math.min(1.5, view.phi - dy * 0.01)); place(); render();
    };
    const ray = new THREE.Raycaster();
    const up = (e: PointerEvent) => {
      if (!drag) return;
      const moved = drag.moved; drag = null;
      if (moved > 6) return;
      const r = cv.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      ray.params.Points = { threshold: 0.1 };
      const hit = ray.intersectObjects(picks.map((p) => p.mesh))[0];
      onPick(hit ? picks.find((p) => p.mesh === hit.object)!.cell : null);
    };
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', () => { drag = null; });
    const ro = new ResizeObserver(size); ro.observe(el);
    api.current = { reset: () => { Object.assign(view, VIEW); size(); } };
    size();

    return () => {
      ro.disconnect(); api.current = null;
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mt of mats) { (mt as THREE.SpriteMaterial).map?.dispose(); mt.dispose(); }
      });
      renderer.dispose(); cv.remove();
    };
  }, [cells, swap]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (resetKey) api.current?.reset(); }, [resetKey]);

  return <div ref={host} className="w-full h-[320px] sm:h-[440px] cursor-grab active:cursor-grabbing" role="img" aria-label="3D surface: quota cost per accepted page over pages a call and thinking, coloured by CER difference from live" />;
}
