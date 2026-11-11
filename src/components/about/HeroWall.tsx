'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import atlas from './covers-atlas.json';
import { useReducedMotion } from './useReducedMotion';

/**
 * The /about opening: one wall of real covers pinned full-screen behind two
 * panels. First the hero, the covers sweeping in and drifting under a dark scrim. When
 * the second panel arrives the wall changes in one move: the ground stays
 * dark (or lifts to cream with secondTone="light"), the wall pulls back to
 * many more, smaller rows, the drift stops, every cover fades back and fewer than one in a
 * hundred stays lit (0.9% of Europe's pre-1700 print is readable in English,
 * translation census, May 2026). Scrolling back up reverses it. The change is
 * timed, not tied to scroll position.
 *
 * Atlas = public/about/covers-atlas.jpg, rects in covers-atlas.json ([x, y, w, h]).
 */

// Plain figures: white numbers, no pills, no colour coding (2026-11-11: the
// five coloured chips read as a templated landing page).
export type HeroStat = { value: string; label: string; href?: string };

// Rows of covers at their own proportions, packed edge to edge and drifting
// sideways (the left and right edges cut through covers, by design). Rows
// are measured in units of their own height: ux = where a cover starts,
// uw = its width, len = where the row repeats.
type Item = { r: number[]; ux: number; uw: number; delay: number; lit: number };
// v = the row's own speed, a little either side of 1, so rows flow like streams.
type Row = { k: number; items: Item[]; len: number; start: number; v: number };
type Wall = {
  rows: Row[];
  // Whole rows only, top to bottom, in both views: R1 rows fill the hero's
  // visible height, R2 smaller rows fill the screen with the hero's rows in
  // the middle (r0 = the first hero row).
  h1: number;
  h2: number;
  r0: number;
};

const ITEMS = atlas.items as number[][];
const GAP = 0.07; // gap between covers, as a share of row height
const SHARE = 0.009;
const ZOOM_OUT = 0.42; // roughly how much smaller the rows are in the second panel
const MORPH_S = 1.4;
const DARK = '#1a1612';
const CREAM = '#fafaf9';

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const smooth = (t: number) => t * t * (3 - 2 * t);

// 'dark': the second panel keeps the hero's dark ground; 'light': it lifts to cream.
export type SecondTone = 'dark' | 'light';

export default function HeroWall({
  stats,
  title,
  intro,
  second,
  secondTone = 'dark',
}: {
  stats: HeroStat[];
  title: ReactNode;
  intro: ReactNode;
  second: ReactNode;
  secondTone?: SecondTone;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  // The wall turns light once the hero text has scrolled up and away, and
  // stays light below that; it only goes dark again if you scroll back up to
  // the hero. White hero type therefore never sits on the light wall.
  const heroRef = useRef<HTMLDivElement>(null);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    // Early enough that the second panel's text is there as the hero's leaves.
    const io = new IntersectionObserver(([e]) => setLocked(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const still = useReducedMotion();
  const lockedRef = useRef(false);
  const darkRef = useRef(secondTone === 'dark');
  useEffect(() => {
    darkRef.current = secondTone === 'dark';
  }, [secondTone]);

  // Scrolling is left entirely to the browser. This wall once took over the wheel,
  // touch and keys to glide between two stops; on some laptops, mice and scroll
  // settings that fought the user, so the panels now change on position alone.
  const wallRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    // AVIF is about a third smaller; browsers that can't read it get the JPEG.
    img.onerror = () => {
      img.onerror = null;
      img.src = '/about/covers-atlas.jpg';
    };
    img.src = '/about/covers-atlas.v1.avif';
    let born = 0;
    let started = false;
    let grid: Wall | null = null;
    let drift = 0; // in hero pixels, slowed to a stop as the wall pulls back
    let raf = 0;
    let disposed = false;
    // Morph state: f runs 0 (hero) → 1 (locked wall).
    let f = still ? (lockedRef.current ? 1 : 0) : 0;
    let target = 0;
    let lastNow = 0;

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

    const layout = (W: number, H: number) => {
      const wallTop = wallRef.current ? Math.max(0, wallRef.current.getBoundingClientRect().top + window.scrollY) : 0;
      // The hero's visible height: the stage (100svh) less what sits above the wall.
      // Not innerHeight, which grows when a phone's address bar collapses.
      const HV = Math.max(200, H - wallTop);
      const R1 = Math.max(3, Math.round(HV / (W < 768 ? 150 : 175)));
      const h1 = HV / R1;
      let R2 = Math.max(R1 + 2, Math.round(H / (h1 * ZOOM_OUT)));
      if ((R2 - R1) % 2) R2++; // hero rows sit exactly in the middle
      const h2 = H / R2;
      const r0 = (R2 - R1) / 2;
      // Each row is long enough to cover the screen at the small scale, twice.
      const need = (W / h2) * 2 + 6;
      const rows: Row[] = [];
      let seed = 3;
      const rnd = () => ((seed = (seed * 9301 + 49297) % 233280), seed / 233280);
      let i = 0;
      for (let k = 0; k < R2; k++) {
        const items: Item[] = [];
        let ux = 0;
        while (ux < need) {
          const r = ITEMS[i++ % ITEMS.length];
          const uw = r[2] / r[3];
          items.push({ r, ux, uw, delay: 0, lit: -1 });
          ux += uw + GAP;
        }
        const row: Row = { k, items, len: ux, start: rnd() * ux, v: 1 + (((k * 5) % 7) - 3) * 0.04 };
        const hr = k - r0;
        const inHeroRow = hr >= 0 && hr < R1;
        for (const q of items) {
          const x = rel(q, row, 0) * h1 + W / 2;
          const inHero = inHeroRow && x > -q.uw * h1 && x < W;
          const wave = (Math.max(0, x) / W) * 0.9 + (Math.max(0, hr) / R1) * 0.5;
          q.delay = inHero ? wave + rnd() * 0.7 : 1.2 + rnd() * 0.8;
        }
        rows.push(row);
      }
      grid = { rows, h1, h2, r0 };
      if (target === 1) chooseLit(W, H);
    };

    // A cover's start, in row units, relative to the screen's centre line,
    // wrapped so the row repeats forever. d = drift in row units.
    const rel = (q: Item, row: Row, d: number) => {
      let u = (q.ux - row.start - d * row.v) % row.len;
      if (u < -row.len / 2) u += row.len;
      if (u >= row.len / 2) u -= row.len;
      return u;
    };

    // Lit covers sit in a band about two thirds across on wide screens (clear
    // of the text), and above the text on phones. Chosen from where covers
    // will sit once the wall has pulled back.
    const chooseLit = (W: number, H: number) => {
      if (!grid) return;
      const { h2 } = grid;
      const narrow = W < 768;
      // Drift still to come while the morph runs out, roughly.
      const d = (drift + 8 * MORPH_S * 0.35) / grid.h1;
      const pool: Item[] = [];
      const rowOf = new Map<Item, number>();
      for (const row of grid.rows) {
        for (const q of row.items) {
          q.lit = -1;
          const x = W / 2 + (rel(q, row, d) + q.uw / 2) * h2;
          const y = (row.k + 0.5) * h2;
          const clear = narrow
            ? y < H * 0.28 && y > 60 && x > h2 && x < W - h2
            : x > W * 0.58 && x < W * 0.76 && y > 90 && y < H - 60;
          if (clear && q.uw < 1.2) {
            pool.push(q);
            rowOf.set(q, row.k);
          }
        }
      }
      const count = grid.rows.reduce((n, row) => n + Math.ceil(W / h2 / (row.len / row.items.length)), 0);
      const n = Math.max(3, Math.round(count * SHARE));
      const used = new Set<number>();
      let k = 0;
      for (let j = 0; j < pool.length && k < n; j++) {
        const q = pool[(j * 7919) % pool.length];
        const rk = rowOf.get(q)!;
        if (used.has(rk) || used.has(rk - 1) || used.has(rk + 1)) continue;
        used.add(rk);
        q.lit = k++;
      }
    };

    // Off screen the wall stops drawing altogether, to spare the battery.
    let onScreen = true;
    const draw = (now: number) => {
      if (disposed || !onScreen) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth;
      const H = c.clientHeight;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
        grid = null;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!grid) layout(W, H);
      ctx.clearRect(0, 0, W, H);
      raf = requestAnimationFrame(draw);
      if (!started || !img.complete || !img.naturalWidth || !grid) return;
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
      const { h1, h2, r0 } = grid;
      const h = h1 + (h2 - h1) * e; // row height now
      const gapPx = GAP * h;
      const d = drift / h1;
      const baseAlpha = 1 - (darkRef.current ? 0.8 : 0.86) * e;
      const litAt = (k: number) => (still ? 1 : Math.min(1, Math.max(0, (e - 0.55 - k * 0.04) / 0.3)));

      const lits: [number, number, number, number, number[], number][] = [];
      for (const row of grid.rows) {
        // Row top: hero slot and wall slot, blended. Rows outside the hero
        // carry on above and below it at the hero's spacing.
        const yh = (row.k - r0) * h1;
        const yw = row.k * h2;
        const y0 = yh + (yw - yh) * e;
        if (y0 > H || y0 + h < 0) continue;
        const sh = h - gapPx;
        const sy = y0 + gapPx / 2;
        for (const q of row.items) {
          const sx = W / 2 + rel(q, row, d) * h;
          const sw = q.uw * h;
          if (sx > W || sx + sw < 0) continue;
          const p = still ? 1 : Math.min(1, Math.max(0, (age - q.delay) / 0.9));
          if (p <= 0) continue;
          const pe = ease(p);
          const w = sw * (sh / h);
          const lit = q.lit >= 0 ? litAt(q.lit) : 0;
          ctx.globalAlpha = pe * Math.max(baseAlpha, lit);
          const grow = 0.94 + 0.06 * pe;
          ctx.drawImage(img, q.r[0], q.r[1], q.r[2], q.r[3], sx + (w - w * grow) / 2, sy + (sh - sh * grow) / 2 + (1 - pe) * 14, w * grow, sh * grow);
          if (lit > 0) lits.push([sx, sy, w, sh, q.r, lit]);
        }
      }
      // Dark tone: the hero's scrim and the second panel's tint are one
      // recipe drawn here, every stop blended by e, so the wall goes straight
      // from one to the other (two separate layers crossfading dipped lighter
      // in the middle). Drawn under the lit covers so they stay bright.
      if (darkRef.current) {
        // The tint lifts a little behind the covers fading, so the overall
        // brightness moves one way only.
        const et = e * e;
        const mix = (a0: number, a1: number) => a0 + (a1 - a0) * et;
        ctx.globalAlpha = 1;
        ctx.fillStyle = `rgba(16,12,8,${mix(0.4, 0.28)})`;
        ctx.fillRect(0, 0, W, H);
        const fall = ctx.createLinearGradient(0, 0, 0, H);
        fall.addColorStop(0, `rgba(16,12,8,${mix(0.5, 0)})`);
        fall.addColorStop(0.5, `rgba(16,12,8,${mix(0.5, 0)})`);
        fall.addColorStop(1, `rgba(16,12,8,${mix(0.92, 0)})`);
        ctx.fillStyle = fall;
        ctx.fillRect(0, 0, W, H);
        const side = ctx.createLinearGradient(0, 0, W, 0);
        side.addColorStop(0, `rgba(14,10,7,${mix(0.5, 0.55)})`);
        side.addColorStop(0.5, `rgba(14,10,7,${mix(0.15, 0.2)})`);
        side.addColorStop(1, 'rgba(14,10,7,0)');
        ctx.fillStyle = side;
        ctx.fillRect(0, 0, W, H);
        // The rust glow, an ellipse in the top right as in the hero's CSS.
        const rx = W * 1.2 * 0.55;
        const ry = H * 0.9 * 0.55;
        ctx.save();
        ctx.translate(W * 0.82, H * 0.18);
        ctx.scale(1, ry / rx);
        const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        glow.addColorStop(0, `rgba(165,80,61,${mix(0.22, 0.26)})`);
        glow.addColorStop(1, 'rgba(165,80,61,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(-W, -H * (rx / ry), W * 2, H * 2 * (rx / ry));
        ctx.restore();
      }
      for (const [sx, sy, sw, sh, r, lit] of lits) {
        ctx.globalAlpha = lit;
        if (darkRef.current) ctx.drawImage(img, r[0], r[1], r[2], r[3], sx, sy, sw, sh);
        ctx.strokeStyle = darkRef.current ? '#d98a74' : '#9e4a3a';
        ctx.lineWidth = 2;
        ctx.strokeRect(sx - 4, sy - 4, sw + 8, sh + 8);
      }
      ctx.globalAlpha = 1;
    };
    const seen = new IntersectionObserver(([e]) => {
      const was = onScreen;
      onScreen = e.isIntersecting;
      if (onScreen && !was) {
        lastNow = 0;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(draw);
      }
    });
    if (wallRef.current) seen.observe(wallRef.current);
    raf = requestAnimationFrame(draw);
    return () => {
      seen.disconnect();
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(fallback);
    };
  }, [still]);

  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  return (
    <div ref={wallRef} className={`hero-wall relative tone-${secondTone} ${ready ? 'is-ready' : ''} ${locked ? 'is-locked' : ''}`}>
      {/* The pinned wall, behind both panels. The absolute layer spans exactly
          the two panels, so the sticky stage inside it stops at their end and
          never runs over the next section. */}
      <div className="absolute inset-0" aria-hidden="true">
      <div className="hw-stage sticky top-0 h-[100svh] overflow-hidden">
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
      </div>

      {/* Panel 1: the hero */}
      <section className="relative text-white">
        <div className="relative max-w-[var(--container-wide)] mx-auto px-6 md:px-12 pt-12 md:pt-40 pb-6 md:pb-16 min-h-[calc(100svh-64px)] md:min-h-[calc(100svh-64px)] flex flex-col justify-end">
          <div ref={heroRef} className="hw-hero">
          <h1 className="ah-in text-balance font-serif text-[44px] leading-[1.02] md:text-[clamp(56px,6.2vw,92px)] tracking-[-0.03em] max-w-[11em] text-white">
            {title}
          </h1>
          <p className="ah-in mt-6 text-lg md:text-xl text-stone-200 max-w-2xl leading-relaxed">
            {intro}
          </p>
          <ul className="ah-in mt-10 flex flex-wrap gap-x-10 md:gap-x-14 gap-y-5">
            {stats.map((s, i) => {
              const inner = (
                <>
                  <b className="block font-serif font-normal text-3xl md:text-4xl text-white [font-variant-numeric:lining-nums_tabular-nums] leading-none">{s.value}</b>
                  <span className="block mt-2 text-sm md:text-[15px] text-stone-300">{s.label}</span>
                </>
              );
              const cls = 'ah-pill block';
              return (
                <li key={s.label} style={{ transitionDelay: ready ? `${0.9 + i * 0.1}s` : undefined }} className="ah-pill-wrap">
                  {s.href ? (
                    <Link href={s.href} className={`${cls} no-underline hover:[&>span]:text-white transition-colors`}>{inner}</Link>
                  ) : (
                    <span className={cls}>{inner}</span>
                  )}
                </li>
              );
            })}
          </ul>
          </div>
        </div>
      </section>

      {/* Panel 2: the locked wall */}
      <section className="relative min-h-[100svh] flex items-end md:items-start">
        <div className="hw-second max-w-[var(--container-wide)] w-full mx-auto px-6 md:px-12 pt-24 md:pt-32 pb-16">
          {second}
        </div>
      </section>

      <style>{`
        .hero-wall { background: ${DARK}; transition: background-color ${MORPH_S}s ease; }
        .hero-wall.is-locked.tone-light { background: ${CREAM}; }
        .hero-wall canvas { opacity: 0; transition: opacity 1.6s ease; }
        .hero-wall.is-ready canvas { opacity: 1; }
        .hero-wall .hw-scrim { transition: opacity ${MORPH_S}s ease; }
        .hero-wall.tone-dark .hw-scrim { display: none; }
        .hero-wall.is-locked .hw-scrim { opacity: 0; }
        .hero-wall .ah-in, .hero-wall .ah-pill-wrap { opacity: 0; transform: translateY(16px); transition: opacity .9s cubic-bezier(.2,.7,.2,1), transform .9s cubic-bezier(.2,.7,.2,1); }
        .hero-wall.is-ready .ah-in, .hero-wall.is-ready .ah-pill-wrap { opacity: 1; transform: none; }
        .hero-wall.is-ready h1.ah-in { transition-delay: .4s; }
        .hero-wall.is-ready p.ah-in { transition-delay: .6s; }
        .hero-wall.is-ready ul.ah-in { transition-delay: .8s; }
        .hero-wall .hw-hero { transition: opacity .4s ease; }
        .hero-wall.is-locked .hw-hero { opacity: 0; }
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
