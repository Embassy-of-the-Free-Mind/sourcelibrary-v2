'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Heart, BookOpen, FileText, ArrowRight, Loader2 } from 'lucide-react';
import { likes as likesApi } from '@/lib/api-client';
import { useIdentity } from '@/hooks/useIdentity';
import type { Book, Page } from '@/lib/types';
import { CapsLabel } from './ReaderV2Bits';

// ─── Save ──────────────────────────────────────────────────────────────────
// This is the reader's whole "save" surface, and it exists to be honest about
// what saving means on this site: there is no per-page collection or reading
// list to file into, only likes. Liking a page (or the book) is a like row in
// Mongo keyed to a visitor identity — session id if signed in, a
// localStorage-generated id otherwise (useIdentity/src/hooks/useIdentity.ts)
// — and it works fully anonymously; the API never requires a session
// (src/app/api/[tenant]/likes/route.ts). Liking a page also cascades to like
// its book server-side, but the book stays a separate like target you can
// toggle on its own (e.g. to save the book without this one page, or after
// already unliking the page), so both rows are offered. `/favorites` is the
// one place all of it collects — "My Likes" there is powered by the same
// `likes.getMine` call this panel primes on mount — so it's linked at the
// bottom rather than reimplemented here.
//
// What this deliberately does NOT offer: a "save to a list/collection" row.
// `collections` (src/lib/api-client/collections.ts) are curated editorial
// pages (`/api/collections`), not user-owned folders, and there is no API
// that lets a signed-in reader file a page into one. Reading history
// (`readingHistory` in src/lib/api-client/reading-history.ts) is automatic —
// it records every page view via `sendBeacon` from useReaderV2 and silently
// no-ops for anonymous visitors server-side — so it is not a save action a
// reader takes and has no button here either. If either of those grows a
// real "add this page" endpoint later, this panel is where it belongs.

interface SavePanelProps {
  page: Page;
  book: Book;
  url: string;
}

type LikeState = { liked: boolean; count: number };

const ROW = 'w-full text-left px-4 min-h-[56px] py-2.5 flex items-center justify-between gap-3 border-b transition-colors hover:bg-[var(--bg-white)]';
/** Discrete action button, matching the reader's other panels (e.g. "Read
 *  this section →" in the Guide panel, the format buttons in Downloads). */
const ACTION_BTN = 'inline-flex items-center gap-2 h-9 px-3 border font-sans text-[12.5px] transition-opacity hover:opacity-85';
const ACTION_BTN_STYLE = {
  background: 'var(--text-primary)',
  color: 'var(--bg-cream)',
  borderColor: 'var(--text-primary)',
} as const;

// `url` isn't consumed yet — every save action here is identified by
// page.id/book.id, not the URL — but it's kept in the props so this panel's
// call signature matches the reader's other drawer panels (SharePanel,
// DownloadsPanel), and so a future "copy link" row can reuse it without a
// prop-shape change.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- see note above
export default function SavePanel({ page, book, url }: SavePanelProps) {
  const identity = useIdentity();

  const [pageLike, setPageLike] = useState<LikeState>({ liked: false, count: 0 });
  const [bookLike, setBookLike] = useState<LikeState>({ liked: false, count: 0 });
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [pageBusy, setPageBusy] = useState(false);
  const [bookBusy, setBookBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch both like states in one batch call, same shape as SharePanel /
  // LikeButton use. Skipped while identity is still resolving so an
  // anonymous visitor's freshly-minted id isn't fetched before it exists.
  useEffect(() => {
    if (identity.loading || !identity.id) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatusLoaded(false);
    likesApi.getStatus(
      JSON.stringify([{ type: 'page', id: page.id }, { type: 'book', id: book.id }]),
      identity.id
    ).then(data => {
      if (cancelled) return;
      const row = data.results?.[`page:${page.id}`];
      const brow = data.results?.[`book:${book.id}`];
      if (row) setPageLike(row);
      if (brow) setBookLike(brow);
    }).catch(() => {
      // Cosmetic only — the buttons still work, they just start from 0/unliked.
    }).finally(() => {
      if (!cancelled) setStatusLoaded(true);
    });
    return () => { cancelled = true; };
  }, [page.id, book.id, identity.id, identity.loading]);

  const toggle = (
    target: 'page' | 'book',
    id: string,
    state: LikeState,
    setState: (s: LikeState) => void,
    setBusy: (b: boolean) => void,
  ) => {
    if (!identity.id || pageBusy || bookBusy) return;
    setError(null);
    setBusy(true);
    const next = !state.liked;
    const optimistic = { liked: next, count: Math.max(0, state.count + (next ? 1 : -1)) };
    setState(optimistic);

    likesApi.toggle(target, id, identity.id)
      .then(res => {
        setState({ liked: res.liked, count: res.count });
        // Liking a page cascades a like onto its book server-side — reflect
        // that here too so the book row doesn't read stale until reopened.
        if (target === 'page' && res.cascade?.book_id === book.id) {
          setBookLike({ liked: res.cascade.book_liked, count: res.cascade.book_count });
        }
      })
      .catch(() => {
        setState(state); // revert
        setError('Save failed. Try again.');
      })
      .finally(() => setBusy(false));
  };

  const showSignInNudge = !identity.loading && identity.type === 'anonymous';

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pt-2 pb-6" style={{ overscrollBehavior: 'contain' }}>
      {showSignInNudge && (
        <div className="px-4 pt-1 pb-3">
          <p className="font-sans text-[12px] leading-relaxed mb-2" style={{ color: 'var(--text-faint)' }}>
            Saves work without an account, on this device only.
          </p>
          <Link href="/auth/signin" className={ACTION_BTN} style={ACTION_BTN_STYLE}>
            Sign in to keep them everywhere
          </Link>
        </div>
      )}


      <button
        type="button"
        onClick={() => toggle('page', page.id, pageLike, setPageLike, setPageBusy)}
        disabled={!identity.id || pageBusy}
        className={ROW}
        style={{ borderColor: 'var(--border-light)' }}
      >
        <span className="flex items-center gap-2.5 font-sans text-[13.5px]" style={{ color: 'var(--text-primary)' }}>
          {!statusLoaded ? (
            <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
          ) : (
            <Heart
              size={16}
              fill={pageLike.liked ? 'var(--accent-rust)' : 'none'}
              style={{ color: pageLike.liked ? 'var(--accent-rust)' : 'var(--text-muted)' }}
            />
          )}
          {pageLike.liked ? 'Saved to your library' : 'Save this page'}
        </span>
        {pageLike.count > 0 && (
          <span className="font-sans text-[12px] tabular-nums" style={{ color: 'var(--text-faint)' }}>{pageLike.count}</span>
        )}
      </button>

      <button
        type="button"
        onClick={() => toggle('book', book.id, bookLike, setBookLike, setBookBusy)}
        disabled={!identity.id || bookBusy}
        className={ROW}
        style={{ borderColor: 'var(--border-light)' }}
      >
        <span className="flex items-center gap-2.5 font-sans text-[13.5px]" style={{ color: 'var(--text-primary)' }}>
          {!statusLoaded ? (
            <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
          ) : (
            <BookOpen
              size={16}
              fill={bookLike.liked ? 'var(--accent-rust)' : 'none'}
              style={{ color: bookLike.liked ? 'var(--accent-rust)' : 'var(--text-muted)' }}
            />
          )}
          {bookLike.liked ? `Saved “${book.display_title || book.title}”` : 'Save the whole book'}
        </span>
        {bookLike.count > 0 && (
          <span className="font-sans text-[12px] tabular-nums" style={{ color: 'var(--text-faint)' }}>{bookLike.count}</span>
        )}
      </button>

      {error && (
        <p className="px-4 pt-2 font-sans text-[12px]" style={{ color: 'var(--status-error)' }}>{error}</p>
      )}

      <CapsLabel className="block px-4 pt-5 pb-2" style={{ color: 'var(--text-faint)' }}>Your library</CapsLabel>
      <Link href="/favorites" className={ROW} style={{ borderColor: 'var(--border-light)' }}>
        <span className="flex items-center gap-2.5 font-sans text-[13.5px]" style={{ color: 'var(--text-primary)' }}>
          <FileText size={16} style={{ color: 'var(--text-muted)' }} />
          Everything you’ve saved
        </span>
        <ArrowRight size={14} style={{ color: 'var(--text-faint)' }} />
      </Link>
    </div>
  );
}
