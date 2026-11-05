'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useInView } from './useInView';
import { useReducedMotion } from './useReducedMotion';

/** Live library numbers that count up when they come into view. */

export type Counter = { value: number; label: string; href?: string };

const MS = 1800;

export default function Counters({ items, lead = false }: { items: Counter[]; lead?: boolean }) {
  const [ref, inView] = useInView<HTMLDivElement>(0.5);
  const still = useReducedMotion();
  const [t, setT] = useState(0);

  useEffect(() => {
    if (!inView || still) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / MS);
      setT(1 - Math.pow(1 - k, 3));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setT(0);
    };
  }, [inView, still]);

  const p = still ? 1 : t;
  if (lead) {
    // The first item is the achievement: one very large number, the rest beneath it.
    const [first, ...rest] = items;
    const big = (
      <>
        <p className="font-serif text-[clamp(5.5rem,15vw,15rem)] text-primary tabular-nums leading-[0.9] tracking-[-0.04em]">{Math.round(first.value * p).toLocaleString('en-GB')}</p>
        <p className="mt-4 md:mt-6 text-xl md:text-2xl text-primary max-w-xl">{first.label}</p>
      </>
    );
    return (
      <div ref={ref}>
        {first.href ? <Link href={first.href} className="block hover:opacity-80 transition-opacity">{big}</Link> : big}
        <div className="mt-14 md:mt-20 grid grid-cols-[minmax(0,1fr)] sm:grid-cols-2 lg:grid-cols-3 gap-10 sm:gap-8">
          {rest.map((c) => {
            const body = (
              <>
                <p className="font-serif text-5xl md:text-6xl text-primary tabular-nums leading-none tracking-tight">{Math.round(c.value * p).toLocaleString('en-GB')}</p>
                <p className="mt-3 text-lg text-secondary">{c.label}</p>
              </>
            );
            return (
              <div key={c.label} className="border-t border-primary pt-5">
                {c.href ? <Link href={c.href} className="block hover:opacity-80 transition-opacity">{body}</Link> : body}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <div ref={ref} className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-3 gap-10 sm:gap-8">
      {items.map((c) => {
        const n = Math.round(c.value * p).toLocaleString('en-GB');
        const body = (
          <>
            <p className="font-serif text-6xl md:text-7xl text-primary tabular-nums leading-none tracking-tight">{n}</p>
            <p className="mt-3 text-lg text-secondary">{c.label}</p>
          </>
        );
        return (
          <div key={c.label} className="border-t border-primary pt-5">
            {c.href ? (
              <Link href={c.href} className="block hover:opacity-80 transition-opacity">
                {body}
              </Link>
            ) : (
              body
            )}
          </div>
        );
      })}
    </div>
  );
}
