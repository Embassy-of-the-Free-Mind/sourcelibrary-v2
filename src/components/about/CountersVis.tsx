'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useInView } from './useInView';
import { useReducedMotion } from './useReducedMotion';

/**
 * The library's three live numbers drawn as one nested whole: of every book
 * digitised, the share readable in English, and within that the share that had
 * never been in English before. First translations are readable in English by
 * definition, and readable books are digitised books, so the parts nest.
 * Colours follow the WrittenPastChart "hues" palette.
 *
 * Order runs from the whole to the part (digitised, readable, first), so the
 * bar fills from the right and the grid's last squares are the first translations.
 */

const C = { first: '#9e4a3a', readable: '#d0a397', rest: '#e3dcd1' };

export type VisStats = { totalBooks: number; readableInEnglish: number; firstTranslationCount: number };

export default function CountersVis({ stats, mode }: { stats: VisStats; mode: 'bars' | 'grid' }) {
  const [ref, inView] = useInView<HTMLDivElement>(0.35);
  const still = useReducedMotion();
  const [t, setT] = useState(0);
  const on = still || inView;

  useEffect(() => {
    if (!on || still) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 1800);
      setT(1 - Math.pow(1 - k, 3));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, still]);

  const { totalBooks: all, readableInEnglish: read, firstTranslationCount: first } = stats;
  const k = still ? 1 : t;
  const n = (v: number) => Math.round(v * k).toLocaleString('en-GB');

  const legend = (
    <dl className="mt-10 md:mt-12 grid grid-cols-[minmax(0,1fr)] sm:grid-cols-3 gap-8">
      {[
        { c: C.rest, v: all, label: 'books digitised', href: '/search' },
        { c: C.readable, v: read, label: 'readable in English', href: '/search?has_translation=true' },
        { c: C.first, v: first, label: 'translated into English for the first time', href: '/search?first_translation=true' },
      ].map((it) => (
        <Link key={it.label} href={it.href} className="block hover:opacity-80 transition-opacity">
          <dt className="flex items-center gap-3">
            <i className="block w-4 h-4 shrink-0" style={{ background: it.c }} />
            <span className="font-serif text-5xl md:text-6xl text-primary tabular-nums leading-none tracking-tight">{n(it.v)}</span>
          </dt>
          <dd className="mt-3 text-lg text-secondary">{it.label}</dd>
        </Link>
      ))}
    </dl>
  );

  if (mode === 'bars') {
    const ease = 'width 1.6s cubic-bezier(.2,.7,.2,1)';
    return (
      <div ref={ref}>
        <div className="relative h-20 md:h-28 w-full" style={{ background: C.rest }} role="img" aria-label={`${first} first translations and ${read} books readable in English, out of ${all} books digitised`}>
          <i className="absolute inset-y-0 right-0 block" style={{ background: C.readable, width: on ? `${(read / all) * 100}%` : '0%', transition: still ? 'none' : ease }} />
          <i className="absolute inset-y-0 right-0 block" style={{ background: C.first, width: on ? `${(first / all) * 100}%` : '0%', transition: still ? 'none' : `${ease} .35s` }} />
        </div>
        {legend}
      </div>
    );
  }

  // grid: one square per hundred books
  const total = Math.round(all / 100);
  const nFirst = Math.round(first / 100);
  const nRead = Math.round(read / 100);
  return (
    <div ref={ref}>
      <div className="grid gap-[3px] grid-cols-[repeat(25,minmax(0,1fr))] md:grid-cols-[repeat(50,minmax(0,1fr))]" role="img" aria-label={`${first} first translations and ${read} books readable in English, out of ${all} books digitised; one square per hundred books`}>
        {Array.from({ length: total }, (_, i) => (
          <i
            key={i}
            className="block aspect-square"
            style={{
              background: total - i <= nFirst ? C.first : total - i <= nRead ? C.readable : C.rest,
              opacity: on ? 1 : 0,
              transition: still ? 'none' : `opacity .35s ease ${Math.min(i, total) * 2.2}ms`,
            }}
          />
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">Each square is a hundred books.</p>
      {legend}
    </div>
  );
}
