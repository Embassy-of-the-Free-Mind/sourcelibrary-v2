'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './useReducedMotion';

/**
 * The chart's last word: 100 squares for everything printed in Europe before
 * 1700, of which 0.9 of one square has an English translation (the census
 * figure in written-past-data.ts, step 2). The squares come in when the block
 * reaches the screen; the filled one comes last.
 */

const SHARE = 0.9; // percent
const RUST = '#9e4a3a';

export default function TranslatedShare() {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const still = useReducedMotion();
  const on = seen || still;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="ts grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] gap-8 md:gap-14 items-center">
      <div>
        <p className="font-serif text-7xl md:text-8xl text-primary tabular-nums leading-none">
          {SHARE}%
        </p>
        <p className="mt-4 text-lg md:text-xl text-secondary leading-snug">
          of everything printed in Europe before 1700 can be read in English. Beyond Europe, most of it has never even been counted.
        </p>
      </div>
      <div>
        <div
          className="grid grid-cols-[repeat(20,minmax(0,1fr))] md:grid-cols-[repeat(25,minmax(0,1fr))] gap-1 md:gap-1.5"
          role="img"
          aria-label={`100 squares, one for each hundredth of the works; ${SHARE} of one square is filled`}
        >
          {Array.from({ length: 100 }, (_, k) => (
            <span
              key={k}
              className="ts-cell relative aspect-square overflow-hidden"
              style={{
                background: 'rgba(87,83,78,.13)',
                opacity: on ? 1 : 0,
                transitionDelay: on ? `${k * 12}ms` : '0ms',
              }}
            >
              {k === 0 && (
                <i
                  className="ts-fill absolute inset-y-0 left-0"
                  style={{ background: RUST, width: on ? `${SHARE * 100}%` : '0%', transitionDelay: on ? '1.5s' : '0ms' }}
                />
              )}
            </span>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-5 text-sm text-secondary">
          <span className="inline-flex items-center gap-2">
            <i className="inline-block w-3 h-3" style={{ background: RUST }} />
            translated into English
          </span>
          <span className="inline-flex items-center gap-2">
            <i className="inline-block w-3 h-3" style={{ background: 'rgba(87,83,78,.13)' }} />
            never translated
          </span>
        </div>
      </div>
      <style>{`
        .ts .ts-cell { transition: opacity .4s ease; }
        .ts .ts-fill { transition: width 1.2s cubic-bezier(.2,.7,.2,1); }
        @media (prefers-reduced-motion: reduce) { .ts .ts-cell, .ts .ts-fill { transition: none; } }
      `}</style>
    </div>
  );
}
