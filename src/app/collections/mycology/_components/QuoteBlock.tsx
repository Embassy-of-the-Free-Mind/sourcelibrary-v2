'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import ParallaxImage from '@/components/ParallaxImage';

export interface Quote {
  translated: string;
  original?: string;
  language?: string;
  attribution: string;
  href: string;
}

/**
 * Quote band over a collection plate. Randomly cycles through several sourced
 * passages; a cycle button (animated) jumps to another at random. When a quote
 * has an original-language text, a Translated/Original toggle swaps it; the
 * language is shown in the attribution. Existing tokens only.
 */
export default function QuoteBlock({ quotes, bgUrl }: { quotes: Quote[]; bgUrl?: string }) {
  const [i, setI] = useState(0);
  const [showOriginal, setShowOriginal] = useState(false);
  const [spin, setSpin] = useState(false);

  const cycle = useCallback(() => {
    setShowOriginal(false);
    setSpin(true);
    setI((cur) => {
      if (quotes.length <= 1) return cur;
      let n = cur;
      while (n === cur) n = Math.floor(Math.random() * quotes.length);
      return n;
    });
    setTimeout(() => setSpin(false), 600);
  }, [quotes.length]);

  // Auto-cycle at random every ~9s.
  useEffect(() => {
    if (quotes.length <= 1) return;
    const t = setInterval(cycle, 9000);
    return () => clearInterval(t);
  }, [cycle, quotes.length]);

  const q = quotes[i] || quotes[0];
  if (!q) return null;
  const hasOriginal = Boolean(q.original);
  const text = showOriginal && q.original ? q.original : q.translated;
  const attribution = q.language ? `${q.attribution} · ${q.language}` : q.attribution;

  return (
    <section className="relative bg-dark overflow-hidden">
      {bgUrl && <ParallaxImage src={bgUrl} className="opacity-55" strength={0.1} />}
      <div className="absolute inset-0 bg-dark/40" />
      <div className="relative z-10 max-w-3xl mx-auto px-6 py-20 text-center">
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
            <button type="button" onClick={cycle} aria-label="Show another quote"
              className="w-8 h-8 inline-flex items-center justify-center rounded-full border border-white/25 text-white/70 hover:text-white hover:border-white/50 transition-colors">
              <RefreshCw className={`w-4 h-4 ${spin ? 'animate-spin' : ''}`} />
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
