'use client';

import { Children, useRef, useState, useEffect, useCallback, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const ROUND =
  'w-9 h-9 inline-flex items-center justify-center rounded-full border border-border-medium bg-white text-primary shadow-sm hover:border-accent-rust hover:text-accent-rust disabled:opacity-30 disabled:cursor-not-allowed transition-colors';
const SQUARE =
  'w-11 h-11 inline-flex items-center justify-center border border-primary/25 bg-white text-primary hover:bg-primary hover:border-primary hover:text-white disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-primary disabled:hover:border-primary/25 disabled:cursor-not-allowed transition-colors';

/**
 * Generic horizontal scroll-snap slider with prev/next arrows that advance one
 * card at a time and dim at the ends. Card widths are set by the caller via each
 * child's flex-basis; the slider measures the first `[data-card]` to compute the
 * step and how many are in view. Children MUST each carry `data-card` and their
 * own `snap-start shrink-0 basis-…` classes.
 *
 * This is the shared engine behind both the book slider (5-up covers) and the
 * research-notes slider (wide 16:10 cards) — same behavior, different card width.
 *
 * `header` sits on the left of the arrow row (a section title), `action` just
 * before the arrows (an "All articles" button). `variant="square"` is the
 * articles style: larger square arrows that fill dark on hover, no red.
 */
export default function HorizontalSlider({
  children,
  ariaLabel,
  header,
  action,
  variant = 'round',
}: {
  children: ReactNode;
  ariaLabel?: string;
  header?: ReactNode;
  action?: ReactNode;
  variant?: 'round' | 'square';
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const count = Children.count(children);
  const [start, setStart] = useState(0);
  const [perView, setPerView] = useState(1);

  const measurePerView = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>('[data-card]');
    if (!card) return;
    const gap = parseFloat(getComputedStyle(track).columnGap || '16') || 16;
    setPerView(Math.max(1, Math.round(track.clientWidth / (card.offsetWidth + gap))));
  }, []);

  useEffect(() => {
    measurePerView();
    window.addEventListener('resize', measurePerView);
    return () => window.removeEventListener('resize', measurePerView);
  }, [measurePerView]);

  const step = useCallback((dir: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>('[data-card]');
    if (!card) return;
    const gap = parseFloat(getComputedStyle(track).columnGap || '16') || 16;
    track.scrollBy({ left: (card.offsetWidth + gap) * dir, behavior: 'smooth' });
  }, []);

  const onScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>('[data-card]');
    if (!card) return;
    const gap = parseFloat(getComputedStyle(track).columnGap || '16') || 16;
    const idx = Math.round(track.scrollLeft / (card.offsetWidth + gap));
    setStart(Math.max(0, Math.min(idx, Math.max(0, count - 1))));
  }, [count]);

  const atStart = start <= 0;
  const atEnd = start >= count - perView;

  return (
    <div>
      <div className={`flex ${header ? 'flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6 mb-8' : 'items-center justify-end gap-3 mb-3'}`}>
        {header && <div className="min-w-0">{header}</div>}
        <div className="flex items-center gap-3 shrink-0">
          {action}
          <div className={`hidden sm:flex items-center ${variant === 'square' ? 'gap-2' : 'gap-1.5'}`}>
            <button type="button" onClick={() => step(-1)} disabled={atStart} aria-label={`Previous${ariaLabel ? ` ${ariaLabel}` : ''}`}
              className={variant === 'square' ? SQUARE : ROUND}>
              <ChevronLeft className={variant === 'square' ? 'w-5 h-5' : 'w-4 h-4'} />
            </button>
            <button type="button" onClick={() => step(1)} disabled={atEnd} aria-label={`Next${ariaLabel ? ` ${ariaLabel}` : ''}`}
              className={variant === 'square' ? SQUARE : ROUND}>
              <ChevronRight className={variant === 'square' ? 'w-5 h-5' : 'w-4 h-4'} />
            </button>
          </div>
        </div>
      </div>
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="flex gap-4 overflow-x-auto scroll-smooth snap-x snap-mandatory [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden -mx-1 px-1"
      >
        {children}
      </div>
    </div>
  );
}
