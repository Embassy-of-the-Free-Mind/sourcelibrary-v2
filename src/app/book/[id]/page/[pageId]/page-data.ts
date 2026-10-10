import { cache } from 'react';
import { getReadDb } from '@/lib/mongodb';
import { findBookForTenant } from '@/lib/tenant-catalog-books';
import { Book, Page } from '@/lib/types';

// Shared book+page lookup for the reader segment's shells.
//
// Three server components read it per request — the segment layout's
// generateMetadata, the layout shell's existence gate, and the (reader) group
// layout's visibility gate — so it lives in its own module and is `cache()`d,
// making all three share one round trip. Keep it here rather than exporting it
// from a layout.tsx: importing a value out of a layout module drags that
// module's route exports along with it.

// Only the fields the shells need — metadata, existence, visibility. Skip
// index, reading_summary, etc.
export const BOOK_META_PROJECTION = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1, localized: 1, author: 1, published: 1, language: 1,
  // `visible` powers the (reader) group's hidden-book gate (isHiddenBook).
  visible: 1,
  // Gates whether a LOCALIZED reader URL may exist for this book at all — see
  // the redirect in layout.tsx. Always projected, so its absence is an answer.
  pages_translated_es: 1,
};
export const PAGE_META_PROJECTION = {
  _id: 0, id: 1, book_id: 1, page_number: 1, photo: 1,
  'translation.data': 1, 'ocr.data': 1, seo_indexable: 1,
  // An archived split parent (negative page_number) names its leaves here;
  // the reader redirects to the first one (#5842).
  split_into: 1,
};

/**
 * The leaf an archived split parent should redirect to, or null (#5842).
 *
 * Splitting a photo into one page per leaf (scripts/split-pecha.mjs, the
 * split-book flow) keeps the parent with `page_number: -n` and
 * `split_into: [leafIds]`. The parent's URL still resolves, but the reader's
 * page list drops negative pages, so it opened on the book's FIRST page —
 * every shortlink, quote or citation made against the photo landed on the
 * wrong text. Its first leaf is where that text now lives.
 *
 * Follows a re-split leaf (itself archived with its own split_into) a few
 * hops, and only answers with a leaf that exists in the same book, so a
 * dangling id falls back to rendering the parent as before.
 */
export const getSplitLeafId = cache(async function getSplitLeafId(bookId: string, firstLeafId: string): Promise<string | null> {
  try {
    const db = await getReadDb();
    let leafId = firstLeafId;
    for (let hop = 0; hop < 3; hop++) {
      const leaf = await db.collection('pages').findOne(
        { id: leafId, book_id: bookId },
        { projection: { _id: 0, id: 1, page_number: 1, split_into: 1 } },
      );
      if (!leaf) return null;
      if (!isArchivedSplit(leaf)) return leaf.id as string;
      leafId = leaf.split_into[0];
    }
    return null;
  } catch {
    return null;
  }
});

export function isArchivedSplit<T extends object>(page: T | null | undefined): page is T & { page_number: number; split_into: string[] } {
  const p = page as { page_number?: unknown; split_into?: unknown } | null | undefined;
  return !!p
    && typeof p.page_number === 'number' && p.page_number < 0
    && Array.isArray(p.split_into) && typeof p.split_into[0] === 'string';
}

export const getPageData = cache(async function getPageData(bookId: string, pageId: string, tenantId?: string, tenantSlug?: string): Promise<{ book: Book | null; page: Page | null }> {
  try {
    const db = await getReadDb();
    const [bookResult, page] = await Promise.all([
      findBookForTenant(db, bookId, BOOK_META_PROJECTION, { id: tenantId, slug: tenantSlug }),
      db.collection('pages').findOne({ id: pageId }, { projection: PAGE_META_PROJECTION }),
    ]);

    const book = (bookResult?.book ?? null) as unknown as Book | null;
    if (book && page) {
      const scopedBookId = (book.id || (book as any)._id?.toString()) as string;
      if ((page as any).book_id && (page as any).book_id !== scopedBookId) {
        return { book: null, page: null };
      }
    }

    return {
      book,
      page: page as unknown as Page | null,
    };
  } catch {
    return { book: null, page: null };
  }
});
