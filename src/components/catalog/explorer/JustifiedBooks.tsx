'use client';

import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';
import { getBookCardUrl, getBookThumbnailUrl } from '@/lib/utils';
import { coverFrame, framedAspect } from '@/lib/framed-image';
import { usablePageFrame } from '@/lib/page-frame';

/** Width over height of the cover this card will draw. */
function coverAspect(book: CollectionBook): number {
  const url = getBookCardUrl(book) || getBookThumbnailUrl(book, 'display');
  const frame = coverFrame(book, url);
  const ar = frame ? framedAspect(frame) : usablePageFrame(book.thumbnail_frame)?.ar;
  // A scan with no measured shape reads as a typical octavo page.
  return ar && ar > 0.45 && ar < 1.6 ? ar : 0.72;
}

/**
 * Books in rows of one height, every cover at its own proportions — a folio
 * wide, a duodecimo narrow, nothing cropped to a uniform box.
 *
 * Pure CSS (each card grows in proportion to its aspect ratio from a basis of
 * row-height × aspect), so it renders on the server exactly as it hydrates and
 * needs no measuring. The filler at the end keeps the last row from
 * stretching its few covers across the page.
 */
export default function JustifiedBooks({ books, priorityCount = 6 }: { books: CollectionBook[]; priorityCount?: number }) {
  const items = books.map((book, i) => {
    const ar = coverAspect(book);
    return {
      key: (book.bookId || book.id || book.slug || String(i)) + ':' + i,
      book,
      ar,
      style: { flex: `${ar} 1 calc(var(--row-h) * ${ar})`, maxWidth: `calc(var(--row-h) * ${ar} * 1.7)` },
      priority: i < priorityCount,
    };
  });
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-6 [--row-h:150px] sm:[--row-h:200px] lg:[--row-h:230px]">
      {items.map((it) => (
        <div key={it.key} className="min-w-0" style={it.style}>
          <CollectionBookCard book={it.book} coverAspect={it.ar} priority={it.priority} />
        </div>
      ))}
      <div aria-hidden className="h-0" style={{ flex: '1000 1 0' }} />
    </div>
  );
}
