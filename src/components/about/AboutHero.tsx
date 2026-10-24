'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import atlas from './covers-atlas.json';

/**
 * The /about hero, ported from the /talks/ai-case-study title slide: a wall of
 * 220 real covers at their true proportions, rows separated by a strip of
 * ground. Tiles arrive one by one in a sweep, then the rows drift sideways at
 * two speeds. Atlas = public/about/covers-atlas.jpg, rects in covers-atlas.json
 * ([x, y, w, h] per cover). Reduced motion: the wall is drawn still.
 */

export type HeroStat = { value: string; label: string; href?: string; color: string };

type Row = { y: number; h: number; w: number; items: { r: number[]; x: number; w: number; delay: number }[] };

const ITEMS = atlas.items as number[][];

export default function AboutHero({ stats }: { stats: HeroStat[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const img = new Image();
    img.src = '/about/covers-atlas.jpg';
    let born = 0;
    let started = false;
    let rows: Row[] | null = null;
    let raf = 0;
    let disposed = false;

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
      const gap = 10;
      const rowsFit = Math.max(3, Math.floor(H / (130 + gap)));
      const rowH = Math.floor((H - gap * (rowsFit - 1)) / rowsFit);
      rows = [];
      let i = 0;
      let y = 0;
      let seed = 3;
      const rnd = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };
      while (y + rowH <= H + 1) {
        const row: Row = { y, h: rowH, items: [], w: 0 };
        let x = 0;
        while (x < W * 2) {
          const r = ITEMS[i % ITEMS.length];
          i++;
          const w = (r[2] * rowH) / r[3];
          const wave = (x / W) * 0.9 + (y / H) * 0.5;
          row.items.push({ r, x, w, delay: wave + rnd() * 0.7 });
          x += w + gap;
        }
        row.w = x;
        rows.push(row);
        y += rowH + gap;
      }
    };
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);

    const draw = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth;
      const H = c.clientHeight;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
        rows = null;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!rows) layout(W, H);
      ctx.clearRect(0, 0, W, H);
      if (!started || !img.complete || !img.naturalWidth) return;
      const age = (now - born) / 1000;
      const drift = reduced ? 0 : Math.max(0, age - 1.6);
      rows!.forEach((row, ri) => {
        const off = (drift * (ri % 2 ? 6 : 9)) % row.w;
        for (const q of row.items) {
          let x = q.x - off;
          if (x + q.w < 0) x += row.w;
          if (x > W) continue;
          const p = reduced ? 1 : Math.min(1, Math.max(0, (age - q.delay) / 0.9));
          if (p <= 0) continue;
          const e = ease(p);
          ctx.globalAlpha = e;
          const sc = 0.94 + 0.06 * e;
          const dw = q.w * sc;
          const dh = row.h * sc;
          ctx.drawImage(img, q.r[0], q.r[1], q.r[2], q.r[3], x + (q.w - dw) / 2, row.y + (row.h - dh) / 2 + (1 - e) * 14, dw, dh);
        }
      });
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(fallback);
    };
  }, []);

  return (
    <section className={`about-hero relative overflow-hidden bg-[#1a1612] text-white ${ready ? 'is-ready' : ''}`}>
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 w-full h-full" />
      {/* The book page's HeroScrim recipe, plus a bottom fade the text sits on. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(120% 90% at 82% 18%, rgba(165,80,61,.22) 0%, transparent 55%), linear-gradient(90deg, rgba(14,10,7,.5) 0%, rgba(14,10,7,.12) 60%, transparent 100%), linear-gradient(180deg, rgba(16,12,8,.5), rgba(16,12,8,.5) 50%, rgba(16,12,8,.92) 100%), rgba(16,12,8,.4)',
        }}
      />
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
      <style>{`
        .about-hero canvas { opacity: 0; transition: opacity 1.6s ease; }
        .about-hero.is-ready canvas { opacity: 1; }
        .about-hero .ah-in, .about-hero .ah-pill-wrap { opacity: 0; transform: translateY(16px); transition: opacity .9s cubic-bezier(.2,.7,.2,1), transform .9s cubic-bezier(.2,.7,.2,1); }
        .about-hero.is-ready .ah-in, .about-hero.is-ready .ah-pill-wrap { opacity: 1; transform: none; }
        .about-hero.is-ready h1.ah-in { transition-delay: .4s; }
        .about-hero.is-ready p.ah-in { transition-delay: .6s; }
        .about-hero.is-ready ul.ah-in { transition-delay: .8s; }
        @media (prefers-reduced-motion: reduce) {
          .about-hero canvas, .about-hero .ah-in, .about-hero .ah-pill-wrap { transition: none; opacity: 1; transform: none; }
        }
      `}</style>
    </section>
  );
}
