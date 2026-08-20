import { cache } from 'react';
import { getReadDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
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
};

export const getPageData = cache(async function getPageData(bookId: string, pageId: string, tenantId?: string): Promise<{ book: Book | null; page: Page | null }> {
  try {
    const db = await getReadDb();
    const [bookResult, page] = await Promise.all([
      findBookByIdOrSlug(db, bookId, BOOK_META_PROJECTION, tenantId),
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
