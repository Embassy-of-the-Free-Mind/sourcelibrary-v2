'use client';

import Link from 'next/link';
import atlas from '@/components/about/covers-atlas.json';
import { useEffect, useState, type CSSProperties } from 'react';
import { HOME_STRINGS, type HomeLang } from '@/lib/home-i18n';
import { localePath } from '@/lib/locale-path';
import { useInView } from '@/components/about/useInView';
import { useReducedMotion } from '@/components/about/useReducedMotion';

/**
 * One full-screen section, no pinning: a still wall of real covers behind the
 * story (Laura, 2026-11-05: no drift here). When it comes into view every
 * cover fades back and about one in a hundred of those on screen stays lit
 * (0.9% of Europe's pre-1700 print can be read in English, translation census,
 * May 2026). The lit ones are picked from those on screen, right of the text,
 * so they are always in view. Plays once.
 */

const ITEMS = atlas.items as number[][];
const TARGET_H = 118; // preferred row height, px; the real one is fitted to the section
const TARGET_H_PHONE = 72; // smaller on phones, so the wall reads as a wall of books
const GAP = 10;
const ROW_STRIDE = 22; // how far apart in the atlas each row starts
const SHARE = 0.009;
const AVIF = '/about/covers-atlas.v1.avif';
const JPEG = '/about/covers-atlas.jpg';

export default function HomeWall({ lang = 'en' }: { lang?: HomeLang }) {
  const t = HOME_STRINGS[lang];
  const [ref, inView] = useInView<HTMLElement>(0.2);
  const still = useReducedMotion();
  const on = still || inView;
  const [lit, setLit] = useState<Set<string> | null>(null);
  // Copies of the lit covers, drawn above the tint so they stay bright (as on /about).
  const [lifted, setLifted] = useState<{ k: string; left: number; top: number; style: CSSProperties }[]>([]);

  // The covers image is only fetched as you get near the section, so it never
  // competes with the top of the page. AVIF, or the JPEG if the browser can't.
  const [atlasUrl, setAtlasUrl] = useState<string | null>(null);
  useEffect(() => {
    const sec = ref.current;
    if (!sec) return;
    const near = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      near.disconnect();
      const probe = new Image();
      probe.onload = () => setAtlasUrl(AVIF);
      probe.onerror = () => setAtlasUrl(JPEG);
      probe.src = AVIF;
    }, { rootMargin: '1000px 0px' });
    near.observe(sec);
    return () => near.disconnect();
  }, [ref]);

  // Whole rows only, at every screen size: pick the row count nearest the
  // preferred height, then size the rows so they fill the section exactly.
  const [fit, setFit] = useState<{ rows: number; h: number; perRow: number } | null>(null);
  useEffect(() => {
    const sec = ref.current;
    if (!sec) return;
    const measure = () => {
      const total = sec.clientHeight;
      const target = sec.clientWidth < 768 ? TARGET_H_PHONE : TARGET_H;
      const rows = Math.max(3, Math.round(total / (target + GAP)));
      const h = total / rows - GAP;
      // Only as many covers as reach the right edge, whatever the screen.
      const perRow = Math.ceil((sec.clientWidth + 140) / (h * 0.55 + GAP)) + 2;
      setFit((f) => (f && f.rows === rows && f.perRow === perRow && Math.abs(f.h - h) < 0.01 ? f : { rows, h, perRow }));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(sec);
    return () => ro.disconnect();
  }, [ref]);

  // On arrival: light about 1 in 100 of the covers on
  // screen, choosing from those right of the text (anywhere on a phone).
  useEffect(() => {
    if (!on || !fit || !atlasUrl) return;
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
      // Nearest the middle of the free space: centred above the text on phones,
      // centred in the space right of the text on wider screens.
      const narrow = vw < 768;
      const fx = narrow ? vw / 2 : (Math.max(minX, tb ? tb.right : 0) + vw) / 2;
      const fy = narrow && tb ? (top + tb.top) / 2 : (top + bottom) / 2;
      const dist = (b: DOMRect) => Math.hypot(b.left + b.width / 2 - fx, b.top + b.height / 2 - fy);
      const chosen: typeof pool = [];
      for (const c of [...pool].sort((p, q) => dist(p.b) - dist(q.b))) {
        if (chosen.length >= n) break;
        if (chosen.every((d) => Math.hypot(d.b.left - c.b.left, d.b.top - c.b.top) > 240)) chosen.push(c);
      }
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
  }, [on, still, ref, fit, atlasUrl]);

  return (
    <section ref={ref} className="hwall relative min-h-[100svh] overflow-hidden flex bg-[#1a1612]">
      <div aria-hidden="true" className="absolute inset-0 flex flex-col" style={{ gap: GAP, paddingTop: GAP / 2 }}>
        {fit && atlasUrl && Array.from({ length: fit.rows }, (_, r) => {
          const H = fit.h;
          const items = Array.from({ length: fit.perRow }, (_, k) => ITEMS[(r * ROW_STRIDE + k * 5 + r) % ITEMS.length]);
          return (
            <div key={r} className="shrink-0 overflow-visible" style={{ height: H }}>
              <div
                className="hwall-track flex"
                style={{
                  gap: GAP,
                  marginLeft: -((r * 53) % 140),
                }}
              >
                {items.map(([x, y, w, h], k) => {
                  const s = H / h;
                  const id = `${r}:${k}`;
                  const isLit = !!lit?.has(id);
                  return (
                    <i
                      key={k}
                      data-k={id}
                      className="block shrink-0 relative"
                      style={{
                        width: Math.round(w * s),
                        height: H,
                        backgroundImage: `url(${atlasUrl})`,
                        backgroundSize: `${atlas.w * s}px ${atlas.h * s}px`,
                        backgroundPosition: `${-x * s}px ${-y * s}px`,
                        opacity: isLit ? 1 : lit ? 0.22 : 0.8,
                        outline: isLit ? '2px solid #d98a74' : '2px solid transparent',
                        outlineOffset: 4,
                        transition: still ? 'none' : isLit ? 'opacity 1s ease, outline-color .8s ease 1.6s' : `opacity 1.8s ease ${((r * 7 + k * 13) % 30) * 30}ms`,
                      }}
                    />
                  );
                })}
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
          // the /about wall's lit-cover stage: rust glow top right, shade on the left only
          background: 'radial-gradient(120% 90% at 82% 18%, rgba(165,80,61,.26) 0%, transparent 55%), linear-gradient(90deg, rgba(14,10,7,.55) 0%, rgba(14,10,7,.2) 50%, transparent 100%), rgba(16,12,8,.28)',
        }}
      />

      {/* The lit covers, above the tint. */}
      {lifted.map((c) => (
        <i
          key={c.k}
          aria-hidden="true"
          className="hwall-lift absolute block pointer-events-none"
          style={{ ...c.style, left: c.left, top: c.top, outline: '2px solid #d98a74', outlineOffset: 4 }}
        />
      ))}

      {/* Phones: the text runs full width, so the whole wall sits further back. */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none md:hidden bg-[#1a1612]/40" />

      <div className="relative w-full max-w-[1500px] mx-auto px-6 md:px-12 py-24 md:py-32 flex flex-col justify-end">
        <div className="max-w-2xl" data-hwall-text>
          <h2 className="font-serif text-[44px] leading-[1.02] md:text-[clamp(56px,6vw,88px)] tracking-[-0.03em] text-balance text-white">{t.wallTitle}</h2>
          <p className="mt-8 text-lg md:text-xl leading-relaxed text-stone-200">{t.wallBody}</p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href={localePath('/about', lang)} className="px-6 py-3 font-medium transition-colors bg-white text-[#1a1612] hover:bg-stone-200">{t.wallCta}</Link>
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
