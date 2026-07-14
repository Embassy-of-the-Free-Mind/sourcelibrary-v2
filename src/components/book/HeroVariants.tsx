'use client';

import { useRef, useState, useEffect, type ReactNode } from 'react';

/**
 * Book-page hero: a tiled page-scan background with the meta content over it.
 * A fixed "Scrim" treatment on both breakpoints — dark wash + reddish glow +
 * text shadow. On mobile the hero is a tall (≈66vh) full-bleed panel with the
 * cover at 1/3 width and the meta beside it. The background + tint drift with a
 * subtle scroll parallax.
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
  const sectionRef = useRef<HTMLElement>(null);
  const [parallax, setParallax] = useState(0);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = sectionRef.current;
        if (!el) return;
        const top = el.getBoundingClientRect().top; // 0 when the hero's top is at the viewport top
        // Drift the background slower than the scroll; clamp so the oversized
        // layer never reveals an edge.
        setParallax(Math.max(-70, Math.min(70, -top * 0.12)));
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);

  return (
    <section ref={sectionRef} className="relative" style={{ background: '#14100c' }}>
      {/* Background + tints live in their own clipped layer so the action-bar
          dropdowns (rendered in the content below) can overflow the section. */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Oversized parallax layer — the tiled bg AND tint drift together. */}
        <div className="absolute inset-x-0 -top-[12%] h-[124%] will-change-transform" style={{ transform: `translateY(${parallax}px)` }}>
          {mosaicUrl ? (
            /* Mobile: ~6 columns across (166% width), tiled vertically to fill.
               Desktop: cover the whole area. */
            <div className="absolute inset-0 bg-[length:166%_auto] bg-top bg-repeat-y md:bg-cover md:bg-center md:bg-no-repeat" style={{ backgroundImage: `url(${mosaicUrl})` }} />
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

          {/* Mobile Scrim tint + reddish glow */}
          <div className="absolute inset-0 md:hidden" style={{ background: 'rgba(16,12,8,0.72)' }} />
          <div className="absolute inset-0 md:hidden" style={{ background: 'radial-gradient(120% 80% at 78% 16%, rgba(165,80,61,0.24) 0%, transparent 55%)' }} />

          {/* Desktop Scrim: base tint + left scrim + reddish glow */}
          <div className="hidden md:block absolute inset-0" style={{ background: 'rgba(16,12,8,0.72)' }} />
          <div className="hidden md:block absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(14,10,7,0.5) 0%, rgba(14,10,7,0.12) 60%, transparent 100%)' }} />
          <div className="hidden md:block absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 82% 18%, rgba(165,80,61,0.2) 0%, transparent 55%)' }} />
        </div>
      </div>

      {/* Content. Mobile: a tall (≈66vh) panel, cover 1/3 + meta 2/3, centred. */}
      <div className="relative max-w-[var(--container-wide)] mx-auto px-5 md:px-12 min-h-[66vh] md:min-h-0 pt-10 md:pt-16 pb-8 md:pb-16 grid gap-4 md:gap-14 items-start md:items-center grid-cols-[1fr_2fr] md:grid-cols-[auto_minmax(0,1fr)]">
        {cover}
        <div style={{ textShadow: '0 1px 16px rgba(0,0,0,0.72)' }}>
          {meta}
        </div>
      </div>
    </section>
  );
}
