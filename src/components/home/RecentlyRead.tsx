'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, Clock, ArrowRight, BookOpen } from 'lucide-react';
import { useStableSession } from '@/hooks/useStableSession';
import { readingHistory, type ReadingHistoryEntry } from '@/lib/api-client';
import { bookUrl } from '@/lib/slugify';
import { getBookThumbnailUrl } from '@/lib/utils';

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * "Recently looked at" — a personalized horizontal slider drawn from the
 * signed-in reader's reading history, shown just under the collections grid on
 * the homepage. Each card links straight back to the last page they read so
 * they can pick up where they left off.
 *
 * Renders nothing for anonymous users or when there's no history yet, so the
 * homepage is unchanged for logged-out visitors. Slider mechanics mirror the
 * collection-page first-translations slider (arrows step one card, scroll-snap
 * on mobile).
 */
export default function RecentlyRead() {
  const { data: session, status } = useStableSession();
  const [entries, setEntries] = useState<ReadingHistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    readingHistory
      .list({ limit: 15 })
      .then((res) => {
        if (!cancelled) setEntries(res.entries);
      })
      .catch(() => { /* silent — the widget just stays hidden */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [status]);

  // Hidden entirely for anonymous users and until we have something to show.
  if (!session || !loaded || entries.length === 0) return null;

  return <RecentlyReadSlider entries={entries} />;
}

/**
 * Presentational slider — pure function of `entries`. Split out from the
 * data/auth wrapper so it can be rendered in isolation (and previewed with
 * sample data) without a live session.
 */
export function RecentlyReadSlider({ entries }: { entries: ReadingHistoryEntry[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const updateArrows = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setAtStart(track.scrollLeft <= 1);
    setAtEnd(track.scrollLeft + track.clientWidth >= track.scrollWidth - 1);
  }, []);

  useEffect(() => {
    if (entries.length) updateArrows();
  }, [entries, updateArrows]);

  const step = useCallback((dir: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>('[data-card]');
    const gap = parseFloat(getComputedStyle(track).columnGap || '16') || 16;
    const delta = ((card?.offsetWidth || 160) + gap) * dir;
    track.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

  return (
    <section className="bg-[#f3ede6] pb-16 md:pb-24 -mt-4">
      <div className="px-6 md:px-12 max-w-[1500px] mx-auto">
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <h2 className="text-2xl md:text-3xl text-primary font-display">Recently looked at</h2>
            <p className="text-muted mt-1 text-sm">Pick up where you left off.</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => step(-1)}
                disabled={atStart}
                aria-label="Previous"
                className="w-9 h-9 inline-flex items-center justify-center rounded-full border border-border-medium bg-white text-primary shadow-sm cursor-pointer hover:border-accent-rust hover:text-accent-rust disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                disabled={atEnd}
                aria-label="Next"
                className="w-9 h-9 inline-flex items-center justify-center rounded-full border border-border-medium bg-white text-primary shadow-sm cursor-pointer hover:border-accent-rust hover:text-accent-rust disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <Link
              href="/reading-history"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-rust hover:text-accent-rust/80 transition-colors"
            >
              See all
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        <div
          ref={trackRef}
          onScroll={updateArrows}
          className="flex gap-4 overflow-x-auto scroll-smooth snap-x snap-mandatory [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden -mx-1 px-1"
        >
          {entries.map((entry, i) => (
            <RecentCard key={`${entry.book_id}-${entry.started_at}-${i}`} entry={entry} priority={i < 6} />
          ))}
        </div>
      </div>
    </section>
  );
}

function RecentCard({ entry, priority }: { entry: ReadingHistoryEntry; priority: boolean }) {
  const [imageError, setImageError] = useState(false);
  const book = entry.book;
  const title = book.display_title || book.title;
  const url = bookUrl({ slug: book.slug, id: book.id });
  const pageUrl = `${url}/page/${entry.last_page_id}`;
  const thumb = getBookThumbnailUrl(book, 'thumb');
  const progress = book.pages_count
    ? Math.min(100, Math.round((entry.last_page_number / book.pages_count) * 100))
    : 0;

  return (
    <Link
      href={pageUrl}
      data-card
      className="group snap-start shrink-0 basis-[42%] sm:basis-[calc((100%-3rem)/4)] lg:basis-[calc((100%-5rem)/6)] flex flex-col border border-border-light bg-white hover:border-accent-rust/40 hover:shadow-md transition-[border-color,box-shadow]"
    >
      {/* Cover */}
      <div className="relative aspect-[3/4] bg-warm overflow-hidden">
        {thumb && !imageError ? (
          <Image
            src={thumb}
            alt={title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 640px) 42vw, (max-width: 1024px) 25vw, 16vw"
            onError={() => setImageError(true)}
            loading={priority ? 'eager' : 'lazy'}
            unoptimized
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-border-medium">
            <BookOpen className="w-6 h-6" />
          </div>
        )}
        {/* Progress bar pinned to the bottom of the cover */}
        {book.pages_count ? (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
            <div className="h-full bg-accent-gold" style={{ width: `${progress}%` }} />
          </div>
        ) : null}
      </div>

      {/* Info */}
      <div className="flex flex-col flex-1 p-3">
        <h3 className="text-sm font-semibold text-primary group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug" style={{ fontFamily: 'var(--font-body)' }}>
          {title}
        </h3>
        {book.author && <p className="text-xs text-muted mt-0.5 line-clamp-1">{book.author}</p>}
        <div className="flex items-center justify-between gap-2 mt-auto pt-3 text-[11px] text-faint">
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {timeAgo(entry.updated_at)}
          </span>
          {book.pages_count ? <span>p. {entry.last_page_number}</span> : null}
        </div>
      </div>
    </Link>
  );
}
