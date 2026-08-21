'use client';

import { Children, useRef, useState, useEffect, useCallback, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Generic horizontal scroll-snap slider with prev/next arrows that advance one
 * card at a time and dim at the ends. Card widths are set by the caller via each
 * child's flex-basis; the slider measures the first `[data-card]` to compute the
 * step and how many are in view. Children MUST each carry `data-card` and their
 * own `snap-start shrink-0 basis-…` classes.
 *
 * This is the shared engine behind both the book slider (5-up covers) and the
 * research-notes slider (wide 16:10 cards) — same behavior, different card width.
 */
export default function HorizontalSlider({ children, ariaLabel }: { children: ReactNode; ariaLabel?: string }) {
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
      <div className="flex items-center justify-end gap-3 mb-3">
        <div className="hidden sm:flex items-center gap-1.5">
          <button type="button" onClick={() => step(-1)} disabled={atStart} aria-label={`Previous${ariaLabel ? ` ${ariaLabel}` : ''}`}
            className="w-9 h-9 inline-flex items-center justify-center rounded-full border border-border-medium bg-white text-primary shadow-sm hover:border-accent-rust hover:text-accent-rust disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => step(1)} disabled={atEnd} aria-label={`Next${ariaLabel ? ` ${ariaLabel}` : ''}`}
            className="w-9 h-9 inline-flex items-center justify-center rounded-full border border-border-medium bg-white text-primary shadow-sm hover:border-accent-rust hover:text-accent-rust disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
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
