'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useInView } from './useInView';
import { useReducedMotion } from './useReducedMotion';

/**
 * Four reasons a book stays unknown, set large. When the scene arrives each
 * "Not" is struck through and falls away in turn, leaving what Source Library
 * does: Scanned. Translated. Free. Known. Leaving the scene puts the Nots back.
 */

const LOCKS: { word: string; line: ReactNode }[] = [
  { word: 'scanned', line: 'The vast majority of books and manuscripts from the Renaissance have never been digitised.' },
  { word: 'translated', line: 'Of everything printed in Europe before 1700, fewer than one work in a hundred can be read in English.' },
  { word: 'free', line: 'Many scans that do exist sit behind subscriptions and closed viewers, out of reach of readers and search.' },
  { word: 'known', line: 'A book can be in the public domain and still nowhere near the public mind. If nobody can read it or quote it, nobody knows what it says.' },
];

const STEP = 650;

export default function FourLocks({ children }: { children?: ReactNode }) {
  const [ref, inView] = useInView<HTMLDivElement>(0.4);
  const still = useReducedMotion();
  const open = still || inView;
  // How many words have lost their "Not" so far; drives the capital letter.
  const [freed, setFreed] = useState(0);
  useEffect(() => {
    if (!inView || still) return;
    const timers = LOCKS.map((_, k) => setTimeout(() => setFreed(k + 1), 500 + k * STEP + 600));
    return () => {
      timers.forEach(clearTimeout);
      setFreed(0);
    };
  }, [inView, still]);

  return (
    <div ref={ref} className="fl">
      <ol className="space-y-8 md:space-y-10">
        {LOCKS.map((l, k) => {
          const d = still ? 0 : 500 + k * STEP;
          return (
            <li key={l.word} className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-x-12 gap-y-2 items-baseline">
              <p className="font-serif text-5xl sm:text-6xl md:text-7xl lg:text-8xl text-primary leading-none tracking-tight whitespace-nowrap">
                <span
                  className="fl-not relative inline-block overflow-hidden align-baseline text-muted"
                  style={{
                    maxWidth: open ? 0 : '2.4em',
                    opacity: open ? 0 : 1,
                    marginRight: open ? 0 : '0.25em',
                    transitionDelay: open ? `${d + 450}ms` : '0ms',
                  }}
                >
                  Not
                  <i
                    className="fl-strike absolute left-0 right-0 top-[55%] h-[0.07em] bg-accent-rust"
                    style={{ transform: `scaleX(${open ? 1 : 0})`, transitionDelay: open ? `${d}ms` : '0ms' }}
                  />
                </span>
                <span className="fl-word inline-block">
                  {still || k < freed ? l.word[0].toUpperCase() + l.word.slice(1) : l.word}.
                </span>
              </p>
              <p className="text-lg text-secondary leading-relaxed max-w-md">{l.line}</p>
            </li>
          );
        })}
      </ol>
      {children}
      <style>{`
        .fl .fl-not { transition: max-width .7s cubic-bezier(.6,0,.2,1), opacity .5s ease, margin-right .7s cubic-bezier(.6,0,.2,1); }
        .fl .fl-strike { transform-origin: left center; transition: transform .45s cubic-bezier(.2,.7,.2,1); }
        @media (prefers-reduced-motion: reduce) { .fl .fl-not, .fl .fl-strike { transition: none; } }
      `}</style>
    </div>
  );
}
