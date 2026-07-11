'use client';

import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Book-page hero with switchable background/layout variants (flick with the
 * arrows, in place). Cover + meta content are the same across variants — only
 * the background and (for v4) the cover/alignment change.
 *
 *  1. Plain — gradient wash + hairline texture (the default).
 *  2. Plate — a plate/page of the book behind everything, strong tint.
 *  3. Page grid — a 10-column wall of page scans behind everything, tinted.
 *  4. Page grid, no cover — same as 3 but cover dropped, content shifts left.
 *  5. Wall of text — a text page filling the hero, lightly tinted.
 */
export default function HeroVariants({
  cover,
  meta,
  plateUrl,
  pageThumbs = [],
  textPageUrl,
}: {
  cover: ReactNode;
  meta: ReactNode;
  plateUrl?: string;
  pageThumbs?: string[];
  textPageUrl?: string;
}) {
  const TOTAL = 5;
  const [v, setV] = useState(1);
  const showCover = v !== 4;

  return (
    <section className="relative overflow-hidden" style={{ background: '#14100c' }}>
      {/* Variant 2 — single plate/page behind everything */}
      {v === 2 && plateUrl && (
        <div className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={plateUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: 'rgba(18,14,10,0.84)' }} />
        </div>
      )}

      {/* Variants 3 & 4 — a 10-column wall of page scans behind everything */}
      {(v === 3 || v === 4) && pageThumbs.length > 0 && (
        <div className="absolute inset-0 overflow-hidden">
          <div className="grid grid-cols-10 gap-1">
            {pageThumbs.map((src, i) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img key={i} src={src} alt="" className="w-full aspect-[3/4] object-cover" loading="lazy" />
            ))}
          </div>
          <div className="absolute inset-0" style={{ background: 'rgba(18,14,10,0.86)' }} />
        </div>
      )}

      {/* Variant 5 — a text page filling the hero (wall of text), lighter tint */}
      {v === 5 && textPageUrl && (
        <div className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={textPageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: 'center 12%' }} />
          <div className="absolute inset-0" style={{ background: 'rgba(18,14,10,0.72)' }} />
        </div>
      )}

      {/* Base gradient wash (all variants) */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 82% 18%, rgba(165,80,61,0.30) 0%, rgba(165,80,61,0.08) 34%, transparent 60%)' }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(80% 70% at 16% 32%, rgba(247,242,234,0.08) 0%, transparent 55%)' }} />
      {v === 1 && <div className="absolute inset-0 opacity-50" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(245,240,232,0.05) 0 1px, transparent 1px 3px)' }} />}

      {/* Variant switcher */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        <span className="text-[12px] font-mono" style={{ color: 'rgba(245,240,232,0.5)' }}>Hero {v}/{TOTAL}</span>
        <button type="button" aria-label="Previous hero variant" onClick={() => setV(x => (x === 1 ? TOTAL : x - 1))} className="w-8 h-8 inline-flex items-center justify-center rounded-full border transition-colors hover:bg-white/10" style={{ borderColor: 'rgba(245,240,232,0.25)', color: '#f7f2ea' }}>
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button type="button" aria-label="Next hero variant" onClick={() => setV(x => (x === TOTAL ? 1 : x + 1))} className="w-8 h-8 inline-flex items-center justify-center rounded-full border transition-colors hover:bg-white/10" style={{ borderColor: 'rgba(245,240,232,0.25)', color: '#f7f2ea' }}>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Content — extra top space so the variant background reads before the
          cover/title enter (especially on mobile). Cover is ~1/3 on mobile with
          the meta to its right; auto-width cover on desktop. */}
      <div className={`relative max-w-[var(--container-wide)] mx-auto px-6 md:px-12 pt-24 md:pt-16 pb-14 md:pb-16 grid gap-5 md:gap-14 items-center ${showCover ? 'grid-cols-[1fr_2fr] md:grid-cols-[auto_1fr]' : 'grid-cols-1'}`}>
        {showCover && cover}
        {meta}
      </div>
    </section>
  );
}
