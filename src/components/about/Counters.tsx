'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useInView } from './useInView';
import { useReducedMotion } from './useReducedMotion';

/** Live library numbers that count up when they come into view. */

export type Counter = { value: number; label: string; href?: string };

const MS = 1800;

export default function Counters({ items }: { items: Counter[] }) {
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
