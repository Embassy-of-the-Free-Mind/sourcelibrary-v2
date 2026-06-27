'use client';

import { useState } from 'react';
import Link from 'next/link';

/**
 * Quote band. A sourced passage over a collection plate (chosen per the
 * quote-background-image skill), with a lighter tint than the rest of the dark
 * surfaces. When an original-language text is provided, a Translated/Original
 * toggle swaps the displayed quote. Existing tokens only; square corners.
 */
export default function QuoteBlock({
  translated, original, originalLanguage, attribution, attributionHref, bgUrl,
}: {
  translated: string;
  original?: string;
  originalLanguage?: string;
  attribution: string;
  attributionHref: string;
  bgUrl?: string;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const hasOriginal = Boolean(original);
  const text = showOriginal && original ? original : translated;

  return (
    <section className="relative bg-dark overflow-hidden">
      {bgUrl && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={bgUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-55" />
      )}
      <div className="absolute inset-0 bg-dark/40" />
      <div className="relative z-10 max-w-3xl mx-auto px-6 py-20 text-center">
        {hasOriginal && (
          <div className="inline-flex items-center border border-white/25 mb-8 text-xs">
            <button type="button" onClick={() => setShowOriginal(false)}
              className={`px-3 py-1.5 transition-colors ${!showOriginal ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white/90'}`}>Translated</button>
            <button type="button" onClick={() => setShowOriginal(true)}
              className={`px-3 py-1.5 transition-colors ${showOriginal ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white/90'}`}>Original{originalLanguage ? ` · ${originalLanguage}` : ''}</button>
          </div>
        )}
        <p className="text-2xl sm:text-3xl text-white font-display leading-snug" lang={showOriginal && originalLanguage ? undefined : 'en'} style={{ textShadow: '0 1px 12px rgba(0,0,0,0.5)' }}>
          &ldquo;{text}&rdquo;
        </p>
        <Link href={attributionHref} className="inline-block text-sm text-white/70 hover:text-white transition-colors mt-5">{attribution}</Link>
      </div>
    </section>
  );
}
