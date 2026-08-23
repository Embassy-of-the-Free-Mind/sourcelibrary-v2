'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { X } from 'lucide-react';
import { readingHistory } from '@/lib/api-client';
import { useLocale } from '@/lib/i18n';
import { getReaderStrings } from '@/lib/reader-strings';

// Offers to resume where a signed-in reader left off in THIS book, the first
// time they land on a page that isn't (near) their last-read one.
//
// Data reality this is built against (verified against the live `bookstore`
// database, 2026-08-22 — see the session report for the full trail):
//   - `GET /api/reading-history` (src/app/api/reading-history/route.ts) is the
//     only read endpoint. It lists reading_history rows for the signed-in
//     user across every book, sorted by `updated_at` desc, capped at 200 per
//     page server-side. There is NO `book_id` filter param — asking "what
//     page was I last on in book X" is not a query the API exposes directly,
//     so we fetch the most recent page of history and filter client-side for
//     `book_id === bookId`, taking the first (= most recent) match.
//   - This means a book the reader hasn't touched in a while, behind 200 more
//     recent *sessions* on OTHER books, won't surface here. That's a real
//     gap, not a bug in this component — inventing a `?book_id=` param on the
//     shared route was out of scope for this change (see task notes).
//   - `last_page_id` / `last_page_number` are written by the POST route's
//     session-collapse logic (30-minute gap = new session row), so they are
//     genuinely "last page touched," not "furthest page reached."
export interface ContinueReadingProps {
  bookId: string;
  /** The page currently on screen, by id. */
  currentPageId: string;
  /** The page currently on screen, by number — needed to suppress the prompt
   *  when the reader has merely turned a page or two past where they left off. */
  currentPageNumber: number;
  onGo: (pageId: string) => void;
}

interface LastRead {
  pageId: string;
  pageNumber: number;
}

// Landing within this many pages of where you left off doesn't need a prompt
// — you're already basically there.
const ADJACENT_PAGE_THRESHOLD = 1;

export function ContinueReading({ bookId, currentPageId, currentPageNumber, onGo }: ContinueReadingProps) {
  const { status } = useSession();
  const t = getReaderStrings(useLocale()).continueReading;
  const [lastRead, setLastRead] = useState<LastRead | null>(null);
  // Tracks which page-visit the prompt was dismissed on, so it stays hidden
  // for that page but can come back if the reader navigates elsewhere and
  // returns without having caught up to their last-read page.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (status !== 'authenticated' || fetchedRef.current) return;
    fetchedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const res = await readingHistory.list({ limit: 200 });
        const match = res.entries.find((e) => e.book_id === bookId);
        if (!cancelled && match) {
          setLastRead({ pageId: match.last_page_id, pageNumber: match.last_page_number });
        }
      } catch {
        // Enhancement only — fail silent, no history shown.
      }
    })();

    return () => { cancelled = true; };
  }, [status, bookId]);

  if (status !== 'authenticated' || !lastRead) return null;
  if (lastRead.pageId === currentPageId) return null;
  if (Math.abs(lastRead.pageNumber - currentPageNumber) <= ADJACENT_PAGE_THRESHOLD) return null;
  if (dismissedFor === currentPageId) return null;

  return (
    // Same shape as TraceStatusLine in Reader2C.tsx: absolutely placed over
    // the top of the reading pane so it never shoves the text down when it
    // appears or disappears.
    <div
      className="absolute left-0 right-0 top-0 z-20 px-4 py-1.5 flex items-center gap-3 border-b font-sans text-[11.5px] rv2-pop"
      style={{
        borderColor: 'var(--border-light)',
        background: 'color-mix(in srgb, var(--text-faint) 8%, var(--bg-white))',
        color: 'var(--text-secondary)',
      }}
      role="status"
    >
      <span className="flex-1 min-w-0">
        {t.leftOff(lastRead.pageNumber)}
      </span>
      <button
        type="button"
        onClick={() => onGo(lastRead.pageId)}
        className="font-medium underline decoration-1 underline-offset-2 hover:opacity-75 transition-opacity"
        style={{ color: 'var(--text-primary)' }}
      >
        {t.continueLabel}
      </button>
      <button
        type="button"
        onClick={() => setDismissedFor(currentPageId)}
        aria-label={t.dismiss}
        className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
        style={{ color: 'var(--text-muted)' }}
      >
        <X size={13} />
      </button>
    </div>
  );
}

export default ContinueReading;
