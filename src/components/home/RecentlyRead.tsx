'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useStableSession } from '@/hooks/useStableSession';
import { readingHistory } from '@/lib/api-client';
import BookSlider, { type MiniBook } from '@/components/BookSlider';

/**
 * "Recently looked at" — a personalized slider drawn from the signed-in reader's
 * reading history, shown just under the collections grid on the homepage.
 *
 * Each book appears ONCE (deduped by book, keeping the most recent view — the
 * history API returns multiple page-view rows per book) and renders with the
 * standard site-wide book card, so it matches every other book grid/slider.
 *
 * Renders nothing for anonymous users or when there's no history yet, so the
 * homepage is unchanged for logged-out visitors.
 */
export default function RecentlyRead() {
  const { data: session, status } = useStableSession();
  const [books, setBooks] = useState<MiniBook[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    // Over-fetch: the history has one row per page-view, so many rows share a
    // book. Dedupe down to one card per book, newest first (API sorts by
    // updated_at desc), capped at 15.
    readingHistory
      .list({ limit: 60 })
      .then((res) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const unique: MiniBook[] = [];
        for (const entry of res.entries) {
          if (seen.has(entry.book_id)) continue;
          seen.add(entry.book_id);
          unique.push(entry.book as unknown as MiniBook);
          if (unique.length >= 15) break;
        }
        setBooks(unique);
      })
      .catch(() => { /* silent — the widget just stays hidden */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [status]);

  // Hidden entirely for anonymous users and until we have something to show.
  if (!session || !loaded || books.length === 0) return null;

  return <RecentlyReadSlider books={books} />;
}

/**
 * Presentational slider — pure function of `books`. Split out from the data/auth
 * wrapper so it can be rendered in isolation (and previewed with sample data)
 * without a live session. Uses the shared BookSlider so the cards and slider
 * mechanics match the rest of the site.
 */
export function RecentlyReadSlider({ books }: { books: MiniBook[] }) {
  return (
    <section className="bg-[#f3ede6] pb-16 md:pb-24 -mt-4">
      <div className="px-6 md:px-12 max-w-[1500px] mx-auto">
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <h2 className="text-2xl md:text-3xl text-primary font-display">Recently looked at</h2>
            <p className="text-muted mt-1 text-sm">Pick up where you left off.</p>
          </div>
          <Link
            href="/reading-history"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-rust hover:text-accent-rust/80 transition-colors"
          >
            See all
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <BookSlider books={books} />
      </div>
    </section>
  );
}
