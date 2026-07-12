'use client';

import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Book-page hero. The tiled page-scan background stays fixed across variants —
 * the arrows cycle how the TEXT CONTENT is treated over it, for readability:
 *
 *  1. Scrim   — a left-anchored dark wash + text-shadow, no container.
 *  2. Panel   — meta in a frosted-glass (backdrop-blur) dark panel.
 *  3. Card    — meta in a solid dark card.
 *  4. Deep    — a heavier overall tint, text directly (max legibility).
 */
const TREATMENTS = ['Scrim', 'Panel', 'Card', 'Deep'] as const;

export default function HeroVariants({
  cover,
  meta,
  pageThumbs = [],
  mosaicUrl,
}: {
  cover: ReactNode;
  meta: ReactNode;
  pageThumbs?: string[];
  /** A single pre-composited tiled background image (preferred over pageThumbs). */
  mosaicUrl?: string;
}) {
  const [t, setT] = useState(0);
  const total = TREATMENTS.length;
  // Mobile-only layout variant: 1 = tiled band across the top + content below;
  // 2 = the tiled background fills the whole hero (like desktop) with a tint
  // between it and the content.
  const [mv, setMv] = useState(1);

  // Overall tint over the page-grid: heavier for "Deep", lighter where the meta
  // has its own panel (Panel/Card).
  const tint = t === 3 ? 'rgba(16,12,8,0.90)' : (t === 1 || t === 2) ? 'rgba(16,12,8,0.78)' : 'rgba(16,12,8,0.82)';

  // Meta container per treatment.
  const metaWrap =
    t === 1 ? 'backdrop-blur-md rounded-2xl p-6 md:p-8' :
    t === 2 ? 'rounded-2xl p-6 md:p-8' : '';
  const metaWrapStyle =
    t === 1 ? { background: 'rgba(14,10,7,0.44)', border: '1px solid rgba(245,240,232,0.10)' } :
    t === 2 ? { background: 'rgba(14,10,7,0.76)' } : undefined;
  // Scrim/Deep lean on a soft text-shadow for legibility.
  const metaTextShadow = (t === 0 || t === 3) ? { textShadow: '0 1px 12px rgba(0,0,0,0.55)' } as const : undefined;

  return (
    <section className="relative overflow-hidden" style={{ background: '#14100c' }}>
      {/* Page-scan background. Mobile variant 1: a band across the TOP that fades
          into the solid dark below the content. Mobile variant 2 + desktop: it
          fills the whole hero behind the content. Prefer the composited mosaic. */}
      {mosaicUrl ? (
        /* CSS background so we can show ~6 columns across on mobile (band) while
           still covering the full hero on desktop / mobile variant 2. */
        <div
          className={`absolute inset-x-0 top-0 ${mv === 2 ? 'h-full bg-cover bg-center' : 'h-[25vh] bg-[length:166%_auto] bg-top'} md:h-full md:bg-cover md:bg-center bg-no-repeat`}
          style={{ backgroundImage: `url(${mosaicUrl})` }}
        />
      ) : pageThumbs.length > 0 ? (
        <div className={`absolute inset-x-0 top-0 ${mv === 2 ? 'h-full' : 'h-[25vh]'} md:h-full overflow-hidden`}>
          <div className="grid grid-cols-6 md:grid-cols-10 gap-1.5">
            {pageThumbs.map((src, i) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img key={i} src={src} alt="" className="w-full aspect-[3/4] object-cover" loading="lazy" />
            ))}
          </div>
        </div>
      ) : null}

      {/* Mobile overlays */}
      {mv === 2 ? (
        /* Variant 2: tint the full background (matches the desktop Scrim tint)
           so the content reads clearly over it */
        <div className="absolute inset-0 md:hidden" style={{ background: 'rgba(16,12,8,0.82)' }} />
      ) : (
        /* Variant 1: fade the band into the solid dark below */
        <div className="absolute inset-x-0 top-0 h-[25vh] md:hidden" style={{ background: 'linear-gradient(to bottom, rgba(20,16,12,0.28) 0%, rgba(20,16,12,0.12) 45%, #14100c 100%)' }} />
      )}

      {/* Desktop: base tint + a left-anchored scrim so the left-aligned text reads */}
      <div className="hidden md:block absolute inset-0" style={{ background: tint }} />
      <div className="hidden md:block absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(14,10,7,0.55) 0%, rgba(14,10,7,0.15) 60%, transparent 100%)' }} />
      <div className="hidden md:block absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 82% 18%, rgba(165,80,61,0.22) 0%, transparent 55%)' }} />

      {/* Desktop treatment switcher */}
      <div className="hidden md:flex absolute top-4 right-4 z-20 items-center gap-2">
        <span className="text-[12px] font-mono" style={{ color: 'rgba(245,240,232,0.55)' }}>{TREATMENTS[t]} {t + 1}/{total}</span>
        <button type="button" aria-label="Previous hero treatment" onClick={() => setT(x => (x === 0 ? total - 1 : x - 1))} className="w-8 h-8 inline-flex items-center justify-center rounded-full border transition-colors hover:bg-white/10" style={{ borderColor: 'rgba(245,240,232,0.25)', color: '#f7f2ea' }}>
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button type="button" aria-label="Next hero treatment" onClick={() => setT(x => (x === total - 1 ? 0 : x + 1))} className="w-8 h-8 inline-flex items-center justify-center rounded-full border transition-colors hover:bg-white/10" style={{ borderColor: 'rgba(245,240,232,0.25)', color: '#f7f2ea' }}>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Mobile hero-variant switcher (band vs full background) */}
      <div className="flex md:hidden absolute top-3 right-3 z-20 items-center gap-1.5">
        <span className="text-[11px] font-mono" style={{ color: 'rgba(245,240,232,0.6)' }}>Hero {mv}/2</span>
        <button type="button" aria-label="Previous hero layout" onClick={() => setMv(x => (x === 1 ? 2 : 1))} className="w-7 h-7 inline-flex items-center justify-center rounded-full border transition-colors" style={{ borderColor: 'rgba(245,240,232,0.3)', color: '#f7f2ea', background: 'rgba(16,12,8,0.4)' }}>
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button type="button" aria-label="Next hero layout" onClick={() => setMv(x => (x === 1 ? 2 : 1))} className="w-7 h-7 inline-flex items-center justify-center rounded-full border transition-colors" style={{ borderColor: 'rgba(245,240,232,0.3)', color: '#f7f2ea', background: 'rgba(16,12,8,0.4)' }}>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Content: variant 1 sits below the band; variant 2 + desktop overlay the
          full-height background. */}
      <div className={`relative max-w-[var(--container-wide)] mx-auto px-5 md:px-12 ${mv === 2 ? 'pt-16' : 'pt-[27vh]'} md:pt-16 pb-10 md:pb-16 grid gap-4 md:gap-14 items-start md:items-center grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:grid-cols-[auto_minmax(0,1fr)]`}>
        {cover}
        <div className={metaWrap} style={{ ...metaWrapStyle, ...metaTextShadow, ...(mv === 2 ? { textShadow: '0 1px 12px rgba(0,0,0,0.6)' } : {}) }}>
          {meta}
        </div>
      </div>
    </section>
  );
}
