'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';

export interface MiniBook {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author?: string;
  year?: number;
  language?: string;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  is_first_translation?: boolean;
  ft_disposition?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  image_display?: string;
  image_thumb?: string;
}

/**
 * Horizontal book slider. Arrows advance ONE item at a time and dim at the
 * ends. Desktop 5-up / tablet 3-up / mobile ~1.5 native scroll-snap (arrows
 * hidden). Card width is set in CSS via the responsive flex-basis so exactly
 * that many fit; recompute is the browser's. Extracted from the Mycology
 * "First translations" slider so it can be reused on the homepage and beyond.
 */
export default function BookSlider({ books }: { books: MiniBook[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState(0);
  const [perView, setPerView] = useState(5);

  const measure = useCallback(() => {
    const w = window.innerWidth;
    setPerView(w < 640 ? 1 : w < 1024 ? 3 : 5);
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const step = useCallback((dir: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>('[data-card]');
    if (!card) return;
    const gap = parseFloat(getComputedStyle(track).columnGap || '16') || 16;
    const delta = (card.offsetWidth + gap) * dir;
    track.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

  const onScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>('[data-card]');
    if (!card) return;
    const gap = parseFloat(getComputedStyle(track).columnGap || '16') || 16;
    const idx = Math.round(track.scrollLeft / (card.offsetWidth + gap));
    setStart(Math.max(0, Math.min(idx, Math.max(0, books.length - 1))));
  }, [books.length]);

  const atStart = start <= 0;
  const atEnd = start >= books.length - perView;

  return (
    <div>
      <div className="flex items-center justify-end gap-3 mb-3">
        <div className="hidden sm:flex items-center gap-1.5">
          <button type="button" onClick={() => step(-1)} disabled={atStart} aria-label="Previous"
            className="w-9 h-9 inline-flex items-center justify-center rounded-full border border-border-medium bg-white text-primary shadow-sm hover:border-accent-rust hover:text-accent-rust disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => step(1)} disabled={atEnd} aria-label="Next"
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
        {books.map((b) => (
          <div
            key={b.id}
            data-card
            className="snap-start shrink-0 basis-[66%] sm:basis-[calc((100%-2rem)/3)] lg:basis-[calc((100%-4rem)/5)]"
          >
            <CollectionBookCard book={b as unknown as CollectionBook} />
          </div>
        ))}
      </div>
    </div>
  );
}
