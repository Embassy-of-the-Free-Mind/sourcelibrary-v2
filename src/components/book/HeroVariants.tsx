'use client';

import { useState, useRef, useEffect, type ReactNode } from 'react';
import HeroScrim from '@/components/HeroScrim';

/**
 * Book-page hero.
 *  - Mobile: a "Letterboxd" treatment — a clean band of the page-scan bg up
 *    top, a strong gradient down into the dark, then the meta (left) with the
 *    cover (always 1/3 of the container, auto height) on the right. The
 *    actions bottom-align across the section.
 *  - Desktop: a fixed-height panel — the tiled page-scan bg full-bleed with a
 *    dark scrim and the cover (left) + meta over it, vertically centred.
 *
 * The background + tint drift with a subtle scroll parallax on all sizes.
 * The cover + meta (which carry interactive controls and a `book_read`
 * analytics beacon) render exactly once. The background is an <img> so we can
 * fall back to a single page scan when the tiled mosaic can't be built.
 */
export default function HeroVariants({
  cover,
  meta,
  actions,
  pageThumbs = [],
  mosaicUrl,
  upgradeUrl,
}: {
  cover: ReactNode;
  meta: ReactNode;
  /** Read / cite / download / like — pinned to the foot of the section on
   *  mobile (on desktop these live inline in `meta`). */
  actions?: ReactNode;
  pageThumbs?: string[];
  /** A single pre-composited tiled background image (preferred over pageThumbs). */
  mosaicUrl?: string;
  /** Set when this book's STORED mosaic is short of a full 10x4 grid and the
   *  book has the pages to do better. Pinged once after the current background
   *  has painted, so this reader keeps the instant image and the NEXT visitor
   *  gets the fuller one. Absent for books already at a full grid. */
  upgradeUrl?: string;
}) {
  const single = pageThumbs[0];
  const [bgSrc, setBgSrc] = useState<string | undefined>(mosaicUrl || single);
  // If the mosaic route 404s (not enough pages to tile), fall back to a single
  // page scan covering the background.
  const onBgError = () => { if (single && bgSrc !== single) setBgSrc(single); };

  // Fade + focus the background in once it decodes, so the load reads as
  // deliberate rather than a hard pop. Because warmed books load the mosaic
  // straight from R2 (often instantly / from cache), we must PAINT the blurred
  // state for a couple frames first — otherwise React flips to the sharp state
  // in the same tick and the transition never plays. Two rAFs guarantee at
  // least one painted frame in the blurred state before we resolve.
  const [revealed, setRevealed] = useState(false);
  const reveal = () => {
    requestAnimationFrame(() => requestAnimationFrame(() => setRevealed(true)));
  };

  // Background self-repair for a short mosaic. Deliberately fire-and-forget and
  // deliberately AFTER the background has painted: this reader sees the stored
  // image immediately and never waits on the rebuild — it exists to improve the
  // NEXT visit. The server enforces the cooldown and the attempt cap, so a
  // popular book can't rebuild in a loop; the ref just avoids firing twice from
  // one mount. Errors are ignored on purpose (a failed upgrade is a no-op, and
  // the hero is already showing the right thing).
  const upgradeFired = useRef(false);
  useEffect(() => {
    if (!upgradeUrl || !revealed || upgradeFired.current) return;
    upgradeFired.current = true;
    const t = setTimeout(() => {
      // Deliberately NOT `cache: 'no-store'`: when the server decides there is
      // nothing to do it answers with a week-long Cache-Control, so the browser
      // and the CDN absorb every repeat ping and the function is never reached.
      // Forcing no-store here would turn a cached no-op into ~11k live
      // invocations a day.
      fetch(upgradeUrl, { method: 'GET', keepalive: true }).catch(() => {});
    }, 2000); // let the page settle first — this is the lowest-priority work here
    return () => clearTimeout(t);
  }, [upgradeUrl, revealed]);

  // Subtle scroll parallax — the bg + tint drift slower than the page.
  const sectionRef = useRef<HTMLElement>(null);
  const [parallax, setParallax] = useState(0);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = sectionRef.current;
        if (!el) return;
        const top = el.getBoundingClientRect().top; // 0 when the hero top hits the viewport top
        setParallax(Math.max(-60, Math.min(60, -top * 0.11)));
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);

  const drift = { transform: `translateY(${parallax}px)` } as const;

  const Bg = () =>
    bgSrc ? (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        ref={(el) => { if (el?.complete) reveal(); }}
        src={bgSrc}
        alt=""
        onLoad={reveal}
        onError={onBgError}
        loading="eager"
        className={`absolute inset-0 w-full h-full object-cover will-change-[opacity,filter,transform] ${
          revealed ? 'hero-focus-in' : 'opacity-0'
        }`}
      />
    ) : null;

  return (
    <section ref={sectionRef} className="relative w-full max-w-full overflow-x-clip" style={{ background: '#14100c' }}>
      {/* ===================== Background ===================== */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Desktop: full-bleed bg + dark scrim + left scrim + reddish glow — all
            in one oversized layer that drifts together on scroll. */}
        <div className="hidden md:block absolute inset-0 overflow-hidden">
          <div className="absolute inset-x-0 -top-[12%] h-[124%] will-change-transform" style={drift}>
            <Bg />
            <HeroScrim />
          </div>
        </div>
        {/* Mobile: a clean band of the bg up top (drifting), then a fixed strong
            gradient into the dark so the author eyebrow sits on the dark. */}
        <div className="md:hidden absolute inset-x-0 top-0 h-[42vh] overflow-hidden">
          <div className="absolute inset-x-0 -top-[14%] h-[128%] will-change-transform" style={drift}>
            <Bg />
            <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 70% at 74% 18%, rgba(165,80,61,0.2) 0%, transparent 55%)' }} />
          </div>
          <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(20,16,12,0) 8%, rgba(20,16,12,0.4) 34%, rgba(20,16,12,0.9) 56%, #14100c 70%)' }} />
        </div>
      </div>

      {/* ===================== Content ===================== */}
      {/* Mobile: a flex column — the text + cover sit at the TOP (just under the
          gradient), top-aligned with each other, and the actions follow
          directly beneath the taller of the two (no bottom gap). Desktop: a
          centred 2-col grid (the inner row is `md:contents` so cover + meta
          become grid items), and the actions live inline in `meta` instead. */}
      <div
        className="relative max-w-[var(--container-wide)] mx-auto px-5 md:px-12
          pt-[29vh] md:pt-16 pb-9 md:pb-16 min-h-[60vh] md:min-h-[75vh]
          flex flex-col gap-6
          md:grid md:gap-14 md:items-center md:grid-cols-[auto_minmax(0,1fr)]"
      >
        {/* Top row: cover (right, 1/3 on mobile) + meta (left), top-aligned. */}
        <div className="flex flex-row-reverse items-start gap-4 md:contents">
          {/* Cover: 1/3 of the container on mobile (auto height); the large
              left-hand cover on desktop. */}
          <div className="hero-cover-in w-1/3 md:w-auto flex-shrink-0
            [&_img]:!w-full [&_img]:!h-auto [&_img]:!max-w-none [&_img]:!max-h-none
            md:[&_img]:!w-auto md:[&_img]:!h-[420px] md:[&_img]:!max-h-none md:[&_img]:!max-w-[min(44vw,520px)]">
            {cover}
          </div>
          <div className="min-w-0 flex-1 md:flex-none" style={{ textShadow: '0 1px 16px rgba(0,0,0,0.72)' }}>
            {meta}
          </div>
        </div>
        {/* Actions: mobile only, pinned to the foot of the section. */}
        {actions && <div className="md:hidden">{actions}</div>}
      </div>
    </section>
  );
}
