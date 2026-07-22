'use client';

import { useRef, useState, useEffect, type ReactNode } from 'react';

/**
 * Book-page hero — a swipeable chooser of layout variants. Swipe (or use the
 * dots) to move between:
 *   1. Overlay        — tiled page-scan bg, dark scrim, cover + meta over it
 *                       (the original fixed-height treatment).
 *   2. Letterboxd     — a clean band of the bg image up top, a strong sudden
 *                       gradient into the dark, then the cover (left) + meta on
 *                       the dark below. Height follows the content.
 *   3. Letterboxd (R) — the same, mirrored: cover on the right, meta on the left.
 *   4. Overlay · auto — the Overlay treatment but height driven by content
 *                       (no fixed min-height).
 *
 * The cover + meta (which carry interactive controls and a `book_read`
 * analytics beacon) mount ONLY in the active slide — the other slides render
 * just the background treatment, so a swipe previews each look without firing
 * the beacon four times.
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
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);

  const bgUrl = mosaicUrl || pageThumbs[0];

  const go = (i: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setIdx(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);

  const coverEl = cover;
  const metaEl = <div className="min-w-0" style={{ textShadow: '0 1px 16px rgba(0,0,0,0.72)' }}>{meta}</div>;

  // ---- Variant renderers. Each is a full-width slide. `active` gates the
  //      content so only the visible slide mounts the interactive tree. ----

  // 1 & 4: cover + meta over the tiled backdrop. `auto` drops the min-height.
  const Overlay = ({ auto, active }: { auto: boolean; active: boolean }) => (
    <section className="relative w-full min-h-[60vh]" style={{ background: '#14100c' }}>
      {/* Tiled page-scan bg + dark scrim + reddish glow. */}
      <div className="absolute inset-0 overflow-hidden">
        {bgUrl ? <div className="absolute inset-0 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: `url(${bgUrl})` }} /> : null}
        <div className="absolute inset-0" style={{ background: 'rgba(16,12,8,0.72)' }} />
        <div className="hidden md:block absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(14,10,7,0.5) 0%, rgba(14,10,7,0.12) 60%, transparent 100%)' }} />
        <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 85% at 80% 16%, rgba(165,80,61,0.22) 0%, transparent 55%)' }} />
      </div>
      {active && (
        <div className={`relative max-w-[var(--container-wide)] mx-auto px-5 md:px-12 ${auto ? '' : 'min-h-[66vh] md:min-h-0'} pt-10 md:pt-16 pb-10 md:pb-16 grid gap-4 md:gap-14 items-start md:items-center grid-cols-[1fr_2fr] md:grid-cols-[auto_minmax(0,1fr)]`}>
          {coverEl}
          {metaEl}
        </div>
      )}
    </section>
  );

  // 2 & 3: a clean band of the bg image, a sudden gradient to dark, then the
  // cover + meta on the dark. `mirror` puts the cover on the right.
  const Letterboxd = ({ mirror, active }: { mirror: boolean; active: boolean }) => (
    <section className="relative w-full" style={{ background: '#14100c' }}>
      {/* Clean top band of the page-scan bg (nothing overlaps it yet), then a
          strong, sudden gradient down into the dark base colour. */}
      <div className="relative h-[34vh] sm:h-[38vh] md:h-[44vh] overflow-hidden">
        {bgUrl ? <div className="absolute inset-0 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: `url(${bgUrl})` }} /> : null}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(20,16,12,0) 40%, rgba(20,16,12,0.55) 68%, rgba(20,16,12,0.92) 86%, #14100c 100%)' }} />
        <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 70% at 78% 20%, rgba(165,80,61,0.20) 0%, transparent 55%)' }} />
      </div>
      {/* Cover + meta on the dark base, pulled up so the cover straddles the
          gradient (the Letterboxd poster overlap). */}
      {active ? (
        <div className="relative max-w-[var(--container-wide)] mx-auto px-5 md:px-12 pb-10 md:pb-14 -mt-16 sm:-mt-20 md:-mt-28">
          <div className={`flex ${mirror ? 'flex-row-reverse' : ''} items-end gap-4 md:gap-10`}>
            <div className="flex-shrink-0 [&_img]:!w-auto [&_img]:!h-auto [&_img]:!max-h-[200px] md:[&_img]:!max-h-[320px] [&_img]:!max-w-[40vw]">
              {coverEl}
            </div>
            <div className="min-w-0 flex-1 pb-1">{metaEl}</div>
          </div>
        </div>
      ) : (
        <div className="h-[26vh]" />
      )}
    </section>
  );

  const variants: Array<{ key: string; label: string; render: (active: boolean) => ReactNode }> = [
    { key: 'overlay', label: 'Overlay', render: (a) => <Overlay auto={false} active={a} /> },
    { key: 'letterboxd', label: 'Letterboxd', render: (a) => <Letterboxd mirror={false} active={a} /> },
    { key: 'letterboxd-r', label: 'Letterboxd · mirrored', render: (a) => <Letterboxd mirror={true} active={a} /> },
    { key: 'overlay-auto', label: 'Overlay · auto height', render: (a) => <Overlay auto={true} active={a} /> },
  ];

  return (
    <div className="relative w-full max-w-full overflow-x-clip">
      <div
        ref={scrollerRef}
        className="flex w-full max-w-full overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden"
      >
        {variants.map((v, i) => (
          <div key={v.key} className="w-full flex-shrink-0 snap-center">
            {v.render(i === idx)}
          </div>
        ))}
      </div>

      {/* Variant chooser: current label + dots. Sits over the bottom of the hero. */}
      <div className="absolute bottom-3 md:bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-3 py-1.5 rounded-full" style={{ background: 'rgba(12,9,6,0.66)', border: '1px solid rgba(245,240,232,0.16)', backdropFilter: 'blur(4px)' }}>
        <span className="text-[11px] md:text-[12px] font-medium tabular-nums" style={{ color: 'rgba(245,240,232,0.9)' }}>
          {idx + 1}/{variants.length} · {variants[idx]?.label}
        </span>
        <span className="flex items-center gap-1.5">
          {variants.map((v, i) => (
            <button
              key={v.key}
              type="button"
              aria-label={`Show ${v.label} hero`}
              onClick={() => go(i)}
              className="rounded-full transition-all"
              style={{
                width: i === idx ? 18 : 7,
                height: 7,
                background: i === idx ? '#d98a72' : 'rgba(245,240,232,0.42)',
              }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}
