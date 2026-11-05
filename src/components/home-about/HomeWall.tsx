'use client';

import Link from 'next/link';
import atlas from './covers-atlas.json';
import { useEffect, useState, type CSSProperties } from 'react';
import { useInView } from './useInView';
import { useReducedMotion } from './useReducedMotion';

/**
 * One full-screen section, no pinning: a still wall of real covers behind the
 * story (Laura, 2026-11-05: no drift here). When it comes into view every
 * cover fades back and about one in a hundred of those on screen stays lit
 * (0.9% of Europe's pre-1700 print can be read in English, translation census,
 * May 2026). The lit ones are picked from those on screen, right of the text,
 * so they are always in view. Plays once.
 */

const ITEMS = atlas.items as number[][];
const ROWS = 9;
const H = 118; // row height, px
const GAP = 10;
const PER_ROW = 22;
const SHARE = 0.009;
// Local preview can point this at the new /about on another dev server; defaults to /about.
const ABOUT = process.env.NEXT_PUBLIC_ABOUT_URL || '/about';

export default function HomeWall({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const [ref, inView] = useInView<HTMLElement>(0.2);
  const still = useReducedMotion();
  const on = still || inView;
  const dark = tone === 'dark';
  const [lit, setLit] = useState<Set<string> | null>(null);
  // Copies of the lit covers, drawn above the tint so they stay bright (as on /about).
  const [lifted, setLifted] = useState<{ k: string; left: number; top: number; style: CSSProperties }[]>([]);

  // On arrival: light about 1 in 100 of the covers on
  // screen, choosing from those right of the text (anywhere on a phone).
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => {
      const sec = ref.current;
      if (!sec) return;
      const box = sec.getBoundingClientRect();
      const vw = window.innerWidth;
      const top = Math.max(box.top, 0) + 24;
      const bottom = Math.min(box.bottom, window.innerHeight) - 24;
      const covers = [...sec.querySelectorAll<HTMLElement>('i[data-k]')].map((el) => ({ k: el.dataset.k!, b: el.getBoundingClientRect() }));
      const onScreen = covers.filter(({ b }) => b.right > 0 && b.left < vw && b.bottom > top && b.top < bottom);
      const minX = vw < 768 ? 16 : vw * 0.56;
      // Never behind the text (on phones the text runs full width, so lit covers go above it).
      const tb = sec.querySelector<HTMLElement>('[data-hwall-text]')?.getBoundingClientRect();
      const clear = (b: DOMRect) => !tb || b.right < tb.left - 16 || b.left > tb.right + 16 || b.bottom < tb.top - 24 || b.top > tb.bottom + 16;
      const pool = onScreen.filter(({ b }) => b.left >= minX && b.right <= vw - 24 && b.top >= top && b.bottom <= bottom && clear(b));
      const n = Math.max(1, Math.round(onScreen.length * SHARE));
      // Spread out: take every so-many from the pool rather than neighbours.
      const step = Math.max(1, Math.floor(pool.length / n));
      const chosen = pool.filter((_, i) => i % step === Math.floor(step / 2)).slice(0, n);
      setLit(new Set(chosen.map((c) => c.k)));
      setLifted(chosen.map(({ k, b }) => {
        const el = sec.querySelector<HTMLElement>(`i[data-k="${k}"]`)!;
        return {
          k,
          left: b.left - box.left,
          top: b.top - box.top,
          style: { width: b.width, height: b.height, backgroundImage: el.style.backgroundImage, backgroundSize: el.style.backgroundSize, backgroundPosition: el.style.backgroundPosition },
        };
      }));
    }, still ? 0 : 700);
    return () => clearTimeout(t);
  }, [on, still, ref]);

  return (
    <section ref={ref} className={`hwall relative min-h-[100svh] overflow-hidden flex ${dark ? 'bg-[#1a1612]' : 'bg-cream'}`}>
      <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-center" style={{ gap: GAP }}>
        {Array.from({ length: ROWS }, (_, r) => {
          const items = Array.from({ length: PER_ROW }, (_, k) => ITEMS[(r * PER_ROW + k * 5 + r) % ITEMS.length]);
          return (
            <div key={r} className="shrink-0 overflow-visible" style={{ height: H }}>
              <div
                className="hwall-track flex"
                style={{
                  gap: GAP,
                  marginLeft: -((r * 53) % 140),
                }}
              >
                {[0, 1].map((copy) =>
                  items.map(([x, y, w, h], k) => {
                    const s = H / h;
                    const id = `${r}:${copy}:${k}`;
                    const isLit = !!lit?.has(id);
                    return (
                      <i
                        key={`${copy}-${k}`}
                        data-k={id}
                        className="block shrink-0 relative"
                        style={{
                          width: Math.round(w * s),
                          height: H,
                          backgroundImage: 'url(/about/covers-atlas.jpg)',
                          backgroundSize: `${atlas.w * s}px ${atlas.h * s}px`,
                          backgroundPosition: `${-x * s}px ${-y * s}px`,
                          opacity: isLit ? 1 : lit ? (dark ? 0.3 : 0.12) : dark ? 0.8 : 0.5,
                          outline: isLit ? `2px solid ${dark ? '#d98a74' : '#9e4a3a'}` : '2px solid transparent',
                          outlineOffset: 4,
                          transition: still ? 'none' : isLit ? 'opacity 1s ease, outline-color .8s ease 1.6s' : `opacity 1.8s ease ${((r * 7 + k * 13) % 30) * 30}ms`,
                        }}
                      />
                    );
                  }),
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* The scrim the text sits on: strongest bottom left, clear top right. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background: dark
            ? // the /about hero's scrim: rust glow top right, darker to the left and the bottom
              'radial-gradient(120% 90% at 82% 18%, rgba(165,80,61,.22) 0%, transparent 55%), linear-gradient(90deg, rgba(14,10,7,.5) 0%, rgba(14,10,7,.12) 60%, transparent 100%), linear-gradient(180deg, rgba(16,12,8,.5), rgba(16,12,8,.5) 50%, rgba(16,12,8,.92) 100%), rgba(16,12,8,.4)'
            : 'linear-gradient(90deg, rgba(250,250,249,.97) 0%, rgba(250,250,249,.75) 45%, rgba(250,250,249,0) 75%), linear-gradient(0deg, rgba(250,250,249,.8) 0%, rgba(250,250,249,0) 50%)',
        }}
      />

      {/* The lit covers, above the tint. */}
      {lifted.map((c) => (
        <i
          key={c.k}
          aria-hidden="true"
          className="hwall-lift absolute block pointer-events-none"
          style={{ ...c.style, left: c.left, top: c.top, outline: `2px solid ${dark ? '#d98a74' : '#9e4a3a'}`, outlineOffset: 4 }}
        />
      ))}

      {/* Phones: the text runs full width, so the whole wall sits further back. */}
      <div aria-hidden="true" className={`absolute inset-0 pointer-events-none md:hidden ${dark ? 'bg-[#1a1612]/55' : 'bg-cream/70'}`} />

      <div className="relative w-full max-w-[1500px] mx-auto px-6 md:px-12 py-24 md:py-32 flex flex-col justify-end">
        <div className="max-w-2xl" data-hwall-text>
          <h2 className={`font-serif text-[44px] leading-[1.02] md:text-[clamp(56px,6vw,88px)] tracking-[-0.03em] text-balance ${dark ? 'text-white' : 'text-primary'}`}>
            We think it is time for another Renaissance
          </h2>
          <p className={`mt-8 text-lg md:text-xl leading-relaxed ${dark ? 'text-stone-200' : 'text-secondary'}`}>
            In the 1400s, translating Plato and other ancient writers helped spark the Renaissance. Today, fewer than 1 in 100 historical texts can be read in English. Our mission is to translate humanity’s written heritage, with help from AI, so anyone can read it.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href={ABOUT} className={`px-6 py-3 font-medium transition-colors ${dark ? 'bg-white text-[#1a1612] hover:bg-stone-200' : 'bg-[#1a1612] text-white hover:bg-black'}`}>Read our story</Link>
          </div>
        </div>
      </div>

      <style>{`
        .hwall-track { width: max-content; }
          .hwall-lift { animation: hwall-lift 1.2s ease both; }
        @keyframes hwall-lift { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </section>
  );
}
