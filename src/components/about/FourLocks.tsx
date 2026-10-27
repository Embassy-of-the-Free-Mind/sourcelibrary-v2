'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useInView } from './useInView';
import { useReducedMotion } from './useReducedMotion';

/**
 * Problem first, then the mission. Each row opens on what is wrong, set large
 * ("Unscanned."), with the reason beside it. When the mission line at the
 * bottom comes into view the rows flip one by one: the problem word is struck
 * out and replaced by what we do ("Scanned."), and the reason by how. Scrolling
 * back up flips them back.
 */

const ROWS: { problem: string; fixed: string; why: string; how: string }[] = [
  {
    problem: 'Unscanned.',
    fixed: 'Scanned.',
    why: 'The vast majority of books and manuscripts from the Renaissance have never been digitised.',
    how: 'We scan them at the Embassy of the Free Mind and bring in scans from libraries around the world.',
  },
  {
    problem: 'Untranslated.',
    fixed: 'Translated.',
    why: 'Fewer than one in a hundred works printed in Europe before 1700 can be read in English.',
    how: 'Every page is translated into English and set beside the original, so any line can be checked.',
  },
  {
    problem: 'Paywalled.',
    fixed: 'Free.',
    why: 'Many of the scans that do exist sit behind subscriptions and closed viewers.',
    how: 'Everything is free to read, quote and cite, for people and for AI.',
  },
  {
    problem: 'Unknown.',
    fixed: 'Known.',
    why: 'A book can be in the public domain and still nowhere near the public mind.',
    how: 'Names, ideas and pictures are indexed, so you can find what is inside the books, not just their titles.',
  },
];

const STEP = 450;

export default function FourLocks({ mission }: { mission: ReactNode }) {
  const [missionRef, missionIn] = useInView<HTMLDivElement>(0.9);
  const still = useReducedMotion();
  const [flipped, setFlipped] = useState(0);

  useEffect(() => {
    if (!missionIn || still) return;
    const timers = ROWS.map((_, k) => setTimeout(() => setFlipped(k + 1), 150 + k * STEP));
    return () => {
      timers.forEach(clearTimeout);
      setFlipped(0);
    };
  }, [missionIn, still]);

  return (
    <div className="fl">
      <ol className="space-y-10 md:space-y-12">
        {ROWS.map((r, k) => {
          const done = !still && k < flipped;
          return (
            <li key={r.problem} className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-x-12 gap-y-3 items-center">
              <p className="relative font-serif text-5xl sm:text-6xl md:text-7xl lg:text-8xl leading-[1.05] tracking-tight">
                <span className="fl-problem relative inline-block text-primary" style={{ opacity: done ? 0 : 1, transform: done ? 'translateY(-30%)' : 'none' }}>
                  {r.problem}
                  <i className="fl-strike absolute left-0 right-0 top-[55%] h-[0.06em] bg-accent-rust" style={{ transform: `scaleX(${done ? 1 : 0})` }} />
                </span>
                <span className="fl-fixed absolute left-0 top-0 inline-block text-accent-rust" style={{ opacity: done ? 1 : 0, transform: done ? 'none' : 'translateY(30%)' }}>
                  {r.fixed}
                </span>
              </p>
              <div className="grid text-lg leading-relaxed max-w-md">
                <p className="fl-why [grid-area:1/1] text-secondary" style={{ opacity: done ? 0 : 1 }}>{r.why}</p>
                <p className="fl-how [grid-area:1/1] text-primary" style={{ opacity: done ? 1 : 0 }}>{r.how}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <div ref={missionRef} className="mt-20 md:mt-28 max-w-3xl">
        {mission}
      </div>
      <style>{`
        .fl .fl-problem { transition: opacity .45s ease .25s, transform .6s cubic-bezier(.6,0,.2,1) .25s; }
        .fl .fl-strike { transform-origin: left center; transition: transform .3s cubic-bezier(.2,.7,.2,1); }
        .fl .fl-fixed { transition: opacity .5s ease .45s, transform .7s cubic-bezier(.2,.7,.2,1) .45s; }
        .fl .fl-why, .fl .fl-how { transition: opacity .5s ease .35s; }
        @media (prefers-reduced-motion: reduce) { .fl .fl-problem, .fl .fl-strike, .fl .fl-fixed, .fl .fl-why, .fl .fl-how { transition: none; } }
      `}</style>
    </div>
  );
}
