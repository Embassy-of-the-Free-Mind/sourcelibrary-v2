'use client';

import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Book-page hero: a tiled page-scan background with the meta content over it.
 * Desktop uses a fixed "Scrim" treatment (dark wash + reddish glow + text
 * shadow). Mobile offers two layouts, switchable in place:
 *  2. Full — the tiled background fills the hero with the Scrim tint.
 *  3. Forehead — a lighter band of tiles up top that darkens downward; the
 *     content starts lower so the tiles read as a header image.
 */
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
  // Mobile-only layout variant: 2 = full tint; 3 = lighter "forehead".
  const [mv, setMv] = useState(2);

  return (
    <section className="relative" style={{ background: '#14100c' }}>
      {/* Background + tints live in their own clipped layer so the action-bar
          dropdowns (rendered in the content below) can overflow the section. */}
      <div className="absolute inset-0 overflow-hidden">
        {mosaicUrl ? (
          <div className="absolute inset-0 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: `url(${mosaicUrl})` }} />
        ) : pageThumbs.length > 0 ? (
          <div className="absolute inset-0 overflow-hidden">
            <div className="grid grid-cols-6 md:grid-cols-10 gap-1.5">
              {pageThumbs.map((src, i) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img key={i} src={src} alt="" className="w-full aspect-[3/4] object-cover" loading="lazy" />
              ))}
            </div>
          </div>
        ) : null}

        {/* Mobile variant 2 — full Scrim tint + reddish glow */}
        {mv === 2 && (
          <>
            <div className="absolute inset-0 md:hidden" style={{ background: 'rgba(16,12,8,0.82)' }} />
            <div className="absolute inset-0 md:hidden" style={{ background: 'radial-gradient(120% 80% at 78% 16%, rgba(165,80,61,0.26) 0%, transparent 55%)' }} />
          </>
        )}
        {/* Mobile variant 3 — lighter "forehead" that darkens downward + glow */}
        {mv === 3 && (
          <>
            <div className="absolute inset-0 md:hidden" style={{ background: 'linear-gradient(to bottom, rgba(16,12,8,0.28) 0%, rgba(16,12,8,0.58) 40%, rgba(16,12,8,0.93) 100%)' }} />
            <div className="absolute inset-0 md:hidden" style={{ background: 'radial-gradient(120% 80% at 78% 16%, rgba(165,80,61,0.24) 0%, transparent 55%)' }} />
          </>
        )}

        {/* Desktop Scrim: base tint + left scrim + reddish glow */}
        <div className="hidden md:block absolute inset-0" style={{ background: 'rgba(16,12,8,0.82)' }} />
        <div className="hidden md:block absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(14,10,7,0.55) 0%, rgba(14,10,7,0.15) 60%, transparent 100%)' }} />
        <div className="hidden md:block absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 82% 18%, rgba(165,80,61,0.22) 0%, transparent 55%)' }} />
      </div>

      {/* Mobile hero-layout switcher (full / forehead) */}
      <div className="flex md:hidden absolute top-3 right-3 z-20 items-center gap-1.5">
        <span className="text-[11px] font-mono" style={{ color: 'rgba(245,240,232,0.6)' }}>Hero {mv === 2 ? 1 : 2}/2</span>
        <button type="button" aria-label="Previous hero layout" onClick={() => setMv(x => (x === 2 ? 3 : 2))} className="w-7 h-7 inline-flex items-center justify-center rounded-full border transition-colors" style={{ borderColor: 'rgba(245,240,232,0.3)', color: '#f7f2ea', background: 'rgba(16,12,8,0.4)' }}>
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button type="button" aria-label="Next hero layout" onClick={() => setMv(x => (x === 2 ? 3 : 2))} className="w-7 h-7 inline-flex items-center justify-center rounded-full border transition-colors" style={{ borderColor: 'rgba(245,240,232,0.3)', color: '#f7f2ea', background: 'rgba(16,12,8,0.4)' }}>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Content: variant 3 sits lower (below the forehead); variant 2 + desktop
          overlay the full-height background from near the top. */}
      <div data-hero-mv={mv} className={`relative max-w-[var(--container-wide)] mx-auto px-5 md:px-12 ${mv === 3 ? 'pt-[27vh]' : 'pt-16'} md:pt-16 pb-10 md:pb-16 grid gap-4 md:gap-14 items-start md:items-center grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:grid-cols-[auto_minmax(0,1fr)]`}>
        {cover}
        <div style={{ textShadow: '0 1px 12px rgba(0,0,0,0.6)' }}>
          {meta}
        </div>
      </div>
    </section>
  );
}
