'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import atlas from './covers-atlas.json';
import { useInView } from './useInView';
import { useReducedMotion } from './useReducedMotion';

/**
 * The /about opening: one wall of real covers pinned full-screen behind two
 * panels. First the hero, the covers sweeping in and drifting under a dark
 * scrim. When the second panel arrives the wall changes in one move: the
 * ground lifts to cream, the camera pulls back so far more books fill the
 * screen, the drift stops, every cover fades back and fewer than one in a
 * hundred stays lit (0.9% of Europe's pre-1700 print is readable in English,
 * translation census, May 2026). Scrolling back up reverses it. The change is
 * timed, not tied to scroll position.
 *
 * Atlas = public/about/covers-atlas.jpg, rects in covers-atlas.json ([x, y, w, h]).
 */

export type HeroStat = { value: string; label: string; href?: string; color: string };

type Item = { r: number[]; x: number; w: number; delay: number; lit: number };
type Row = { y: number; h: number; w: number; items: Item[] };

const ITEMS = atlas.items as number[][];
const SHARE = 0.009;
const ZOOM_OUT = 0.42; // scale of the wall in the second panel
const MORPH_S = 1.4;
const DARK = '#1a1612';
const CREAM = '#fafaf9';

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const smooth = (t: number) => t * t * (3 - 2 * t);

export default function HeroWall({ stats, second }: { stats: HeroStat[]; second: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [panelRef, locked] = useInView<HTMLDivElement>(0.4);
  const still = useReducedMotion();
  const lockedRef = useRef(false);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.src = '/about/covers-atlas.jpg';
    let born = 0;
    let started = false;
    let rows: Row[] | null = null;
    let raf = 0;
    let disposed = false;
    // Morph state: f runs 0 (hero) → 1 (locked wall).
    let f = still ? (lockedRef.current ? 1 : 0) : 0;
    let target = 0;
    let lastNow = 0;
    // Horizontal drift, integrated so it can slow to a stop.
    let drift = 0;

    const start = () => {
      if (started || disposed) return;
      started = true;
      born = performance.now();
      setReady(true);
    };
    const fonts = document.fonts?.ready ?? Promise.resolve();
    const decoded = img.decode ? img.decode().catch(() => undefined) : new Promise((r) => (img.onload = r));
    Promise.all([fonts, decoded]).then(() => setTimeout(start, 80));
    const fallback = setTimeout(start, 2000);

    // Lay out enough wall to fill the screen at the zoomed-out scale.
    const layout = (W: number, H: number) => {
      const gap = 10;
      const rowsFit = Math.max(3, Math.floor(H / (130 + gap)));
      const rowH = Math.floor((H - gap * (rowsFit - 1)) / rowsFit);
      const WW = W / ZOOM_OUT;
      const HH = H / ZOOM_OUT;
      const ox = (WW - W) / 2;
      const oy = (HH - H) / 2;
      rows = [];
      let i = 0;
      let seed = 3;
      const rnd = () => ((seed = (seed * 9301 + 49297) % 233280), seed / 233280);
      for (let y = -oy; y < H + oy; y += rowH + gap) {
        const row: Row = { y, h: rowH, items: [], w: 0 };
        for (let x = -ox; x < W + ox + W; ) {
          const r = ITEMS[i % ITEMS.length];
          i++;
          const w = (r[2] * rowH) / r[3];
          const inHero = y >= -1 && y < H && x > -w && x < W;
          const wave = (Math.max(0, x) / W) * 0.9 + (Math.max(0, y) / H) * 0.5;
          row.items.push({ r, x, w, delay: inHero ? wave + rnd() * 0.7 : 1.2 + rnd() * 0.8, lit: -1 });
          x += w + gap;
        }
        row.w = row.items.length ? row.items[row.items.length - 1].x + row.items[row.items.length - 1].w + gap + ox : W;
        rows.push(row);
      }
    };

    // Choose the lit covers from where things will sit once zoomed out, keeping
    // them clear of the text (left half on wide screens, the bottom on phones).
    const chooseLit = (W: number, H: number) => {
      if (!rows) return;
      const s = ZOOM_OUT;
      const cx = W / 2;
      const cy = H / 2;
      const visible: Item[] = [];
      let count = 0;
      const narrow = W < 768;
      rows.forEach((row) => {
        for (const q of row.items) {
          q.lit = -1;
          const x = q.x - (drift % row.w);
          const sx = cx + (x + q.w / 2 - cx) * s;
          const sy = cy + (row.y + row.h / 2 - cy) * s;
          if (sx < 0 || sx > W || sy < 0 || sy > H) continue;
          count++;
          const clear = narrow ? sy < H * 0.42 && sy > 70 : sx > W * 0.56 && sx < W - 30 && sy > 90 && sy < H - 40;
          if (clear) visible.push(q);
        }
      });
      const n = Math.max(3, Math.round(count * SHARE));
      for (let k = 0; k < n && visible.length; k++) {
        const q = visible[Math.floor(((k + 0.5) / n) * visible.length)];
        if (q) q.lit = k;
      }
    };

    const draw = (now: number) => {
      if (disposed) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth;
      const H = c.clientHeight;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
        rows = null;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!rows) {
        layout(W, H);
        if (target === 1) chooseLit(W, H);
      }
      ctx.clearRect(0, 0, W, H);
      raf = requestAnimationFrame(draw);
      if (!started || !img.complete || !img.naturalWidth) return;
      const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
      lastNow = now;
      const age = (now - born) / 1000;

      const want = lockedRef.current ? 1 : 0;
      if (want !== target) {
        target = want;
        if (target === 1) chooseLit(W, H);
      }
      f = still ? target : Math.min(1, Math.max(0, f + (target ? 1 : -1) * (dt / MORPH_S)));
      const e = smooth(f);
      if (!still && age > 1.6) drift += dt * 8 * (1 - e);

      const s = 1 - (1 - ZOOM_OUT) * e;
      const cx = W / 2;
      const cy = H / 2;
      const baseAlpha = 1 - 0.86 * e;
      const litAt = (k: number) => (still ? 1 : Math.min(1, Math.max(0, (e - 0.55 - k * 0.04) / 0.3)));

      for (const row of rows!) {
        const off = drift % row.w;
        for (const q of row.items) {
          let x = q.x - off;
          if (x + q.w < -W) x += row.w;
          const p = still ? 1 : Math.min(1, Math.max(0, (age - q.delay) / 0.9));
          if (p <= 0) continue;
          const pe = ease(p);
          const sw = q.w * s;
          const sh = row.h * s;
          const sx = cx + (x - cx) * s;
          const sy = cy + (row.y - cy) * s;
          if (sx > W || sx + sw < 0 || sy > H || sy + sh < 0) continue;
          const lit = q.lit >= 0 ? litAt(q.lit) : 0;
          ctx.globalAlpha = pe * Math.max(baseAlpha, lit);
          const grow = 0.94 + 0.06 * pe;
          ctx.drawImage(img, q.r[0], q.r[1], q.r[2], q.r[3], sx + (sw - sw * grow) / 2, sy + (sh - sh * grow) / 2 + (1 - pe) * 14, sw * grow, sh * grow);
          if (lit > 0) {
            ctx.globalAlpha = lit;
            ctx.strokeStyle = '#9e4a3a';
            ctx.lineWidth = 2;
            ctx.strokeRect(sx - 4, sy - 4, sw + 8, sh + 8);
          }
        }
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(fallback);
    };
  }, [still]);

  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  return (
    <div className={`hero-wall relative ${ready ? 'is-ready' : ''} ${locked ? 'is-locked' : ''}`}>
      {/* The pinned wall, behind both panels. */}
      <div className="hw-stage sticky top-0 h-[100svh] -mb-[100svh] overflow-hidden" aria-hidden="true">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        {/* The book page's HeroScrim recipe, plus a bottom fade the text sits on. */}
        <div
          className="hw-scrim absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(120% 90% at 82% 18%, rgba(165,80,61,.22) 0%, transparent 55%), linear-gradient(90deg, rgba(14,10,7,.5) 0%, rgba(14,10,7,.12) 60%, transparent 100%), linear-gradient(180deg, rgba(16,12,8,.5), rgba(16,12,8,.5) 50%, rgba(16,12,8,.92) 100%), rgba(16,12,8,.4)',
          }}
        />
      </div>

      {/* Panel 1: the hero */}
      <section className="relative text-white">
        <div className="relative max-w-[var(--container-wide)] mx-auto px-6 md:px-12 pt-40 pb-12 md:pb-16 min-h-[600px] md:min-h-[calc(100svh-64px)] flex flex-col justify-end">
          <h1 className="ah-in font-serif text-[44px] leading-[1.02] md:text-[clamp(56px,6.2vw,92px)] tracking-[-0.03em] max-w-[11em] text-white">
            The written past, open to everyone
          </h1>
          <p className="ah-in mt-6 text-lg md:text-xl text-stone-200 max-w-2xl leading-relaxed">
            We scan rare books and manuscripts, read and translate them with AI, and put every translation next to the page it came from. Free to read, quote and cite.
          </p>
          <ul className="ah-in mt-8 flex flex-wrap gap-2">
            {stats.map((s, i) => {
              const inner = (
                <>
                  <b className="font-semibold tabular-nums" style={{ color: s.color }}>{s.value}</b> {s.label}
                </>
              );
              const cls = 'ah-pill inline-block px-3 py-1.5 text-sm md:text-[15px] text-stone-200 border border-white/20 bg-white/[0.06]';
              return (
                <li key={s.label} style={{ transitionDelay: ready ? `${0.9 + i * 0.1}s` : undefined }} className="ah-pill-wrap">
                  {s.href ? (
                    <Link href={s.href} className={`${cls} hover:bg-white/[0.12] hover:border-white/40 transition-colors no-underline`}>{inner}</Link>
                  ) : (
                    <span className={cls}>{inner}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* Panel 2: the locked wall */}
      <section className="relative min-h-[100svh] flex items-end md:items-start">
        <div ref={panelRef} className="hw-second max-w-[var(--container-wide)] w-full mx-auto px-6 md:px-12 pt-24 md:pt-32 pb-16">
          {second}
        </div>
      </section>

      <style>{`
        .hero-wall { background: ${DARK}; transition: background-color ${MORPH_S}s ease; }
        .hero-wall.is-locked { background: ${CREAM}; }
        .hero-wall canvas { opacity: 0; transition: opacity 1.6s ease; }
        .hero-wall.is-ready canvas { opacity: 1; }
        .hero-wall .hw-scrim { transition: opacity ${MORPH_S}s ease; }
        .hero-wall.is-locked .hw-scrim { opacity: 0; }
        .hero-wall .ah-in, .hero-wall .ah-pill-wrap { opacity: 0; transform: translateY(16px); transition: opacity .9s cubic-bezier(.2,.7,.2,1), transform .9s cubic-bezier(.2,.7,.2,1); }
        .hero-wall.is-ready .ah-in, .hero-wall.is-ready .ah-pill-wrap { opacity: 1; transform: none; }
        .hero-wall.is-ready h1.ah-in { transition-delay: .4s; }
        .hero-wall.is-ready p.ah-in { transition-delay: .6s; }
        .hero-wall.is-ready ul.ah-in { transition-delay: .8s; }
        .hero-wall .hw-second { opacity: 0; transform: translateY(20px); transition: opacity .7s ease, transform .8s cubic-bezier(.2,.7,.2,1); }
        .hero-wall.is-locked .hw-second { opacity: 1; transform: none; transition-delay: .25s; }
        @media (prefers-reduced-motion: reduce) {
          .hero-wall, .hero-wall canvas, .hero-wall .hw-scrim, .hero-wall .ah-in, .hero-wall .ah-pill-wrap, .hero-wall .hw-second { transition: none; }
          .hero-wall canvas, .hero-wall .ah-in, .hero-wall .ah-pill-wrap, .hero-wall .hw-second { opacity: 1; transform: none; }
        }
      `}</style>
    </div>
  );
}
