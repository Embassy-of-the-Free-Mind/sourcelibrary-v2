'use client';

import { useEffect, useRef } from 'react';
import atlas from './covers-atlas.json';
import { useInView } from './useInView';
import { useReducedMotion } from './useReducedMotion';

/**
 * A screen-filling wall of small real covers (the hero's atlas, repeated).
 * When the scene arrives the wall fades back to almost nothing and fewer than
 * one tile in a hundred stays lit: the share of Europe's pre-1700 print that
 * can be read in English (0.9%, translation census, May 2026). Leaving the
 * scene resets it so it plays again.
 */

const ITEMS = atlas.items as number[][];
const SHARE = 0.009;

type Tile = { r: number[]; x: number; y: number; w: number; h: number; lit: boolean; order: number };

export default function LockedLibrary({ children }: { children: React.ReactNode }) {
  const [sceneRef, inView] = useInView<HTMLDivElement>(0.45);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const still = useReducedMotion();
  const state = useRef({ tiles: [] as Tile[], img: null as HTMLImageElement | null, t0: 0, on: false });

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.src = '/about/covers-atlas.jpg';
    state.current.img = img;
    let raf = 0;

    const layout = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth;
      const H = c.clientHeight;
      c.width = W * dpr;
      c.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const rowH = W < 640 ? 46 : 62;
      const gap = 5;
      const tiles: Tile[] = [];
      let i = 0;
      let seed = 7;
      const rnd = () => ((seed = (seed * 9301 + 49297) % 233280), seed / 233280);
      for (let y = 0; y < H; y += rowH + gap) {
        for (let x = -rnd() * 30; x < W; ) {
          const r = ITEMS[(i * 37) % ITEMS.length];
          i++;
          const w = (r[2] * rowH) / r[3];
          tiles.push({ r, x, y, w, h: rowH, lit: false, order: 0 });
          x += w + gap;
        }
      }
      // Light the share, spread across the wall rather than bunched.
      const n = Math.max(2, Math.round(tiles.length * SHARE));
      // Keep the lit tiles clear of the text panel: top left on wide screens,
      // the bottom on phones.
      const narrow = W < 768;
      const underText = (t: Tile) => (narrow ? t.y > H * 0.5 : t.x < W * 0.62 && t.y < H * 0.62);
      const pool = tiles.filter((t) => t.y > rowH && t.y < H - rowH * 2 && t.x > 40 && t.x < W - 80 && !underText(t));
      for (let k = 0; k < n && pool.length; k++) {
        const t = pool[Math.floor(((k + 0.5) / n) * pool.length + (rnd() - 0.5) * (pool.length / n) * 0.6)] ?? pool[0];
        t.lit = true;
        t.order = k;
      }
      state.current.tiles = tiles;
    };

    const draw = (now: number) => {
      const s = state.current;
      const W = c.clientWidth;
      const H = c.clientHeight;
      ctx.clearRect(0, 0, W, H);
      if (!img.complete) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const t = still ? 10 : s.on ? (now - s.t0) / 1000 : 0;
      // 0 → 1.2s: wall visible; 1.2 → 3s: everything fades back; lit tiles come on after.
      const fade = Math.min(1, Math.max(0, (t - 1.2) / 1.8));
      for (const tile of s.tiles) {
        const [sx, sy, sw, sh] = tile.r;
        let a = 0.85 - fade * 0.75;
        if (tile.lit) {
          const k = Math.min(1, Math.max(0, (t - 2.6 - tile.order * 0.35) / 0.6));
          a = Math.max(a, k);
        }
        ctx.globalAlpha = Math.min(1, s.on || still ? a : 0.85);
        ctx.drawImage(img, sx, sy, sw, sh, tile.x, tile.y, tile.w, tile.h);
      }
      ctx.globalAlpha = 1;
      // Lit tiles get a thin ring once they are on.
      for (const tile of s.tiles) {
        if (!tile.lit) continue;
        const k = still ? 1 : Math.min(1, Math.max(0, (t - 2.6 - tile.order * 0.35) / 0.6));
        if (k <= 0) continue;
        ctx.strokeStyle = `rgba(158,74,58,${k})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(tile.x - 3, tile.y - 3, tile.w + 6, tile.h + 6);
      }
      if (s.on && t < 6) raf = requestAnimationFrame(draw);
    };

    const kick = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };
    layout();
    img.onload = kick;
    kick();
    const ro = new ResizeObserver(() => {
      layout();
      kick();
    });
    ro.observe(c);
    (state.current as { kick?: () => void }).kick = kick;
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [still]);

  useEffect(() => {
    const s = state.current as typeof state.current & { kick?: () => void };
    s.on = inView;
    s.t0 = performance.now();
    s.kick?.();
  }, [inView]);

  return (
    <div ref={sceneRef} className="relative min-h-[100svh] overflow-hidden bg-cream">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" aria-hidden="true" />
      <div
        className="relative z-10 min-h-[100svh] flex items-end md:items-start px-4 md:px-12 py-10 md:py-24 transition-opacity duration-1000"
        style={{ opacity: still || inView ? 1 : 0, transitionDelay: inView ? '1.6s' : '0s' }}
      >
        <div className="max-w-2xl bg-cream/90 backdrop-blur-[2px] p-6 md:p-10">{children}</div>
      </div>
    </div>
  );
}
