'use client';

import { useState, type ReactNode } from 'react';

/**
 * Book-page hero.
 *  - Mobile: a "Letterboxd" treatment — a clean band of the page-scan bg up
 *    top, a strong gradient down into the dark, then the meta (left) with the
 *    cover poking up on the right (mirrored). Height follows the content.
 *  - Desktop: the tiled page-scan bg full-bleed with a dark scrim and the
 *    cover (left) + meta over it.
 *
 * The cover + meta (which carry interactive controls and a `book_read`
 * analytics beacon) render exactly once, inside a single responsive layout.
 * The background is an <img> so we can fall back to a single page scan when the
 * tiled mosaic can't be built (too few pages → the mosaic route 404s).
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
  const single = pageThumbs[0];
  const [bgSrc, setBgSrc] = useState<string | undefined>(mosaicUrl || single);
  // If the mosaic route 404s (not enough pages to tile), fall back to a single
  // page scan covering the background.
  const onBgError = () => { if (single && bgSrc !== single) setBgSrc(single); };

  return (
    <section className="relative w-full max-w-full overflow-x-clip" style={{ background: '#14100c' }}>
      {/* An off-screen probe that loads the mosaic and, if it 404s (too few
          pages to tile), falls the background back to a single page scan. Both
          backgrounds below read `bgSrc`. */}
      {bgSrc && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={bgSrc} alt="" aria-hidden onError={onBgError} style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
      )}
      {/* ===================== Background ===================== */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Desktop: full-bleed bg + dark scrim + left scrim + reddish glow. */}
        <div className="hidden md:block absolute inset-0">
          {bgSrc && <div className="absolute inset-0 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: `url(${bgSrc})` }} />}
          <div className="absolute inset-0" style={{ background: 'rgba(16,12,8,0.72)' }} />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(14,10,7,0.5) 0%, rgba(14,10,7,0.12) 60%, transparent 100%)' }} />
          <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 82% 18%, rgba(165,80,61,0.2) 0%, transparent 55%)' }} />
        </div>
        {/* Mobile: a clean band of the bg up top, then a strong gradient that
            reaches solid dark before the content starts, so the author eyebrow
            sits on the dark with full contrast. The bg is zoomed in (~5 tiles
            wide) so the page scans read crisp instead of a mush of tiny tiles. */}
        <div className="md:hidden absolute inset-x-0 top-0 h-[42vh] overflow-hidden">
          {bgSrc && <div className="absolute inset-0 bg-no-repeat" style={{ backgroundImage: `url(${bgSrc})`, backgroundSize: '215% auto', backgroundPosition: 'center 22%' }} />}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(20,16,12,0) 8%, rgba(20,16,12,0.4) 34%, rgba(20,16,12,0.9) 56%, #14100c 70%)' }} />
          <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 70% at 74% 18%, rgba(165,80,61,0.2) 0%, transparent 55%)' }} />
        </div>
      </div>

      {/* ===================== Content ===================== */}
      {/* DOM order is cover → meta: on desktop the grid puts the cover in the
          left column; on mobile flex-row-reverse puts the cover on the right. */}
      <div
        className="relative max-w-[var(--container-wide)] mx-auto px-5 md:px-12
          pt-[30vh] md:pt-16 pb-9 md:pb-16
          flex flex-row-reverse items-start gap-4
          md:grid md:gap-14 md:items-center md:grid-cols-[auto_minmax(0,1fr)]"
      >
        {/* Cover: a small poster on mobile (sits at the image/dark transition on
            the right); the large left-hand cover on desktop (overrides reset). */}
        <div className="flex-shrink-0 [&_img]:!w-auto [&_img]:!h-auto [&_img]:!max-h-[190px] [&_img]:!max-w-[38vw] md:[&_img]:!max-h-[500px] md:[&_img]:!max-w-[min(46vw,560px)]">
          {cover}
        </div>
        <div className="min-w-0 flex-1 md:flex-none pb-1 md:pb-0" style={{ textShadow: '0 1px 16px rgba(0,0,0,0.72)' }}>
          {meta}
        </div>
      </div>
    </section>
  );
}
