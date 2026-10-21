'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from './useReducedMotion';

/**
 * "What it changed": a timeline whose rail fills as you scroll and whose
 * entries rise in as they arrive. Entries that are books in the library show
 * the book itself. Reduced motion: everything shown, rail full.
 */

export type ChangedEntry = {
  year: string;
  body: ReactNode;
  book?: { href: string; src: string; w: number; h: number; alt: string };
};

export default function ChangedTimeline({ entries }: { entries: ChangedEntry[] }) {
  const listRef = useRef<HTMLOListElement>(null);
  const [fill, setFill] = useState(0);
  const [seen, setSeen] = useState<Set<number>>(() => new Set());
  const still = useReducedMotion();

  useEffect(() => {
    const el = listRef.current;
    if (!el || still) return;
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            const k = Number((e.target as HTMLElement).dataset.k);
            setSeen((s) => (s.has(k) ? s : new Set(s).add(k)));
          }
        }),
      { rootMargin: '0px 0px -18% 0px' },
    );
    el.querySelectorAll('[data-k]').forEach((li) => io.observe(li));
    let raf = 0;
    const measure = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const y = window.innerHeight * 0.6;
      setFill(Math.min(1, Math.max(0, (y - r.top) / r.height)));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [still]);

  return (
    <ol ref={listRef} className="ct relative pl-8 md:pl-10">
      <span className="absolute left-[7px] top-2 bottom-2 w-px bg-border-medium" aria-hidden="true" />
      <span
        className="absolute left-[7px] top-2 w-px bg-accent-rust"
        style={{ height: `calc((100% - 1rem) * ${still ? 1 : fill})` }}
        aria-hidden="true"
      />
      {entries.map((e, k) => {
        const on = still || seen.has(k);
        return (
          <li
            key={e.year}
            data-k={k}
            className="ct-item relative pb-10 last:pb-0"
            style={{ opacity: on ? 1 : 0, transform: on ? 'none' : 'translateY(24px)' }}
          >
            <span
              className="absolute -left-8 md:-left-10 top-2 w-[15px] h-[15px] rounded-full border-2 border-accent-rust bg-cream"
              aria-hidden="true"
            />
            <div className="flex gap-5 md:gap-8 items-start">
              <div className="min-w-0 flex-1">
                <p className="font-serif text-4xl md:text-5xl text-primary tabular-nums leading-none">{e.year}</p>
                <p className="mt-3 text-secondary text-lg leading-relaxed max-w-xl">{e.body}</p>
              </div>
              {e.book && (
                <Link href={e.book.href} className="shrink-0 block group" aria-label={e.book.alt}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={e.book.src}
                    alt={e.book.alt}
                    width={e.book.w}
                    height={e.book.h}
                    className="h-28 md:h-40 w-auto border border-border-light shadow-sm group-hover:-translate-y-1 transition-transform"
                    loading="lazy"
                  />
                </Link>
              )}
            </div>
          </li>
        );
      })}
      <style>{`
        .ct .ct-item { transition: opacity .7s ease, transform .7s cubic-bezier(.2,.7,.2,1); }
        @media (prefers-reduced-motion: reduce) { .ct .ct-item { transition: none; } }
      `}</style>
    </ol>
  );
}
