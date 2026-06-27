'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import ParallaxImage from '@/components/ParallaxImage';

const CYCLE_MS = 11000;

export interface Quote {
  translated: string;
  original?: string;
  language?: string;
  attribution: string;
  href: string;
}

/**
 * Quote band over a collection plate. Cycles through the sourced passages in
 * order, ~11s apart, with a countdown ring that sweeps over each cycle and
 * restarts each round; the ring is also the "next" button. When a quote has an
 * original-language text, a Translated/Original toggle swaps it; the language is
 * shown in the attribution. Existing tokens only.
 */
export default function QuoteBlock({ quotes, bgUrl }: { quotes: Quote[]; bgUrl?: string }) {
  const [i, setI] = useState(0);
  const [showOriginal, setShowOriginal] = useState(false);
  const [cycle, setCycle] = useState(0); // re-keys the ring so the sweep restarts each round
  const [visible, setVisible] = useState(true);
  const sectionRef = useRef<HTMLElement>(null);

  // Advance to the next quote in order, restart the ring + clock.
  const advance = useCallback(() => {
    setShowOriginal(false);
    setI((cur) => (quotes.length <= 1 ? cur : (cur + 1) % quotes.length));
    setCycle((c) => c + 1);
  }, [quotes.length]);

  // Only run the clock while the band is on screen.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => {
      setVisible(e.isIntersecting);
      if (e.isIntersecting) setCycle((c) => c + 1); // restart the ring on re-entry
    }, { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Schedule the next advance; reschedules each round (depends on `cycle`).
  useEffect(() => {
    if (quotes.length <= 1 || !visible) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setTimeout(advance, CYCLE_MS);
    return () => clearTimeout(t);
  }, [cycle, visible, advance, quotes.length]);

  const q = quotes[i] || quotes[0];
  if (!q) return null;
  const hasOriginal = Boolean(q.original);
  const text = showOriginal && q.original ? q.original : q.translated;
  const attribution = q.language ? `${q.attribution} · ${q.language}` : q.attribution;

  return (
    <section ref={sectionRef} className="relative bg-dark overflow-hidden min-h-[60vh] md:min-h-[70vh] flex items-center">
      {bgUrl && <ParallaxImage src={bgUrl} className="opacity-55" strength={0.1} />}
      <div className="absolute inset-0 bg-dark/40" />
      <div className="relative z-10 w-full max-w-3xl mx-auto px-6 py-16 text-center">
        <div className="flex items-center justify-center gap-3 mb-8">
          {hasOriginal && (
            <div className="inline-flex items-center border border-white/25 text-xs">
              <button type="button" onClick={() => setShowOriginal(false)}
                className={`px-3 py-1.5 transition-colors ${!showOriginal ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white/90'}`}>Translated</button>
              <button type="button" onClick={() => setShowOriginal(true)}
                className={`px-3 py-1.5 transition-colors ${showOriginal ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white/90'}`}>Original</button>
            </div>
          )}
          {quotes.length > 1 && (
            <button type="button" onClick={advance} aria-label="Next quote"
              className="w-8 h-8 inline-flex items-center justify-center rounded-full border border-white/25 text-white/70 hover:text-white hover:border-white/50 transition-colors">
              <span key={cycle} className="quote-timer" aria-hidden>
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="10" r="8.2" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.7" />
                  <circle className="quote-timer-arc" cx="10" cy="10" r="8.2" stroke="currentColor" strokeWidth="1.7"
                    strokeLinecap="round" transform="rotate(-90 10 10)"
                    style={{ animationDuration: `${CYCLE_MS}ms` }} />
                </svg>
              </span>
            </button>
          )}
        </div>
        <p key={`${i}-${showOriginal}`} className="text-2xl sm:text-3xl text-white font-display leading-snug animate-fade-in-up" style={{ textShadow: '0 1px 12px rgba(0,0,0,0.5)' }} lang={showOriginal && q.language ? undefined : 'en'}>
          &ldquo;{text}&rdquo;
        </p>
        <Link href={q.href} className="inline-block text-sm text-white/70 hover:text-white transition-colors mt-5">{attribution}</Link>
      </div>
    </section>
  );
}
