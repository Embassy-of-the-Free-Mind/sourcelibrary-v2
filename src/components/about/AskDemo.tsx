'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useInView } from './useInView';
import { useReducedMotion } from './useReducedMotion';

/**
 * A question typed out large, answered from three traditions in their own
 * words. It is a demonstration, so nothing about it looks like an input. Each quote is copied exactly from the English on the linked page
 * (checked 2026-10-23). Plays when the scene arrives, resets when it leaves.
 */

const QUESTION = 'What is mind?';

const ANSWERS: { who: string; work: string; lang: string; quote: string; href: string }[] = [
  {
    who: 'Plato',
    work: 'Alcibiades I',
    lang: 'Greek',
    quote: 'Would it not then, my friend Alcibiades, if the soul is to know itself, have to look into a soul?',
    href: '/q/BhIfljO2ApigrcHcTeD',
  },
  {
    who: 'Śaṅkara',
    work: 'The Crest-Jewel of Wisdom',
    lang: 'Sanskrit',
    quote: 'The form is seen, the eye is seer; the mind is both seen and seer.',
    href: '/q/BgRsFohtofMtBqdNmop',
  },
  {
    who: 'Xunzi',
    work: 'Dispelling Obsession',
    lang: 'Chinese',
    quote: 'How does the heart-mind know? I say: through emptiness, unity, and stillness.',
    href: '/book/xunzi-siku-quanshu-huiyao-vol-4/page/6ac774dd541cd556e64f300d',
  },
];

const TYPE_MS = 70;
const START = 600;

export default function AskDemo() {
  const [ref, inView] = useInView<HTMLDivElement>(0.45);
  const still = useReducedMotion();
  const [typed, setTyped] = useState(0);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!inView || still) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= QUESTION.length; i++) timers.push(setTimeout(() => setTyped(i), START + i * TYPE_MS));
    const done = START + QUESTION.length * TYPE_MS + 500;
    ANSWERS.forEach((_, k) => timers.push(setTimeout(() => setShown(k + 1), done + k * 450)));
    return () => {
      timers.forEach(clearTimeout);
      setTyped(0);
      setShown(0);
    };
  }, [inView, still]);

  const q = still ? QUESTION : QUESTION.slice(0, typed);
  const n = still ? ANSWERS.length : shown;

  return (
    <div ref={ref} className="ask">
      <p className="text-center">
        <span className="block text-sm text-muted">Asked of the library</span>
        <span className="mt-3 block font-serif text-4xl md:text-6xl text-primary leading-tight" aria-label={QUESTION}>
          &ldquo;{q}
          <i className="ask-caret inline-block w-[3px] h-[0.85em] align-[-0.08em] mx-0.5 bg-accent-rust" style={{ opacity: n || (!still && typed === 0) ? 0 : 1 }} />
          {q.length === QUESTION.length ? '\u201d' : ''}
        </span>
      </p>

      <ul className="mt-12 md:mt-14 grid grid-cols-[minmax(0,1fr)] md:grid-cols-3 gap-5">
        {ANSWERS.map((a, k) => (
          <li
            key={a.who}
            className="ask-card"
            style={{ opacity: k < n ? 1 : 0, transform: k < n ? 'none' : 'translateY(24px)' }}
          >
            <Link href={a.href} className="group flex flex-col h-full border border-border-medium bg-cream p-6 hover:border-primary transition-colors">
              <blockquote className="font-serif text-xl md:text-2xl text-primary leading-snug">&ldquo;{a.quote}&rdquo;</blockquote>
              <span className="mt-auto pt-6 block">
                <span className="block font-medium text-primary">{a.who}</span>
                <span className="block text-sm text-muted">
                  <em>{a.work}</em>, translated from the {a.lang}
                </span>
                <span className="mt-3 block text-sm text-secondary group-hover:text-primary">Read the page →</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <style>{`
        .ask .ask-card { transition: opacity .7s ease, transform .8s cubic-bezier(.2,.7,.2,1); }
        .ask .ask-caret { animation: ask-blink 1s steps(2) infinite; }
        @keyframes ask-blink { 50% { visibility: hidden; } }
        @media (prefers-reduced-motion: reduce) { .ask .ask-card { transition: none; } .ask .ask-caret { animation: none; } }
      `}</style>
    </div>
  );
}
