import { notFound } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { getTenantContext } from '@/lib/tenant-context';
import { isHiddenBook } from '@/lib/book-access';
import type { Book, Page } from '@/lib/types';

// Shared server loader for the v2 reader design previews (/v2a, /v2c).
// Mirrors the (reader)/page.tsx fetch: current page + book + nav page list.
// These routes exist to compare the two redesign variants against real
// content; they are noindex and additive — the production reader is untouched.

const BOOK_NAV_PROJECTION = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1,
  author: 1, published: 1, language: 1, doi: 1, chapters: 1,
  visible: 1,
};

export interface ReaderV2Data {
  book: Book;
  page: Page;
  pageList: Page[];
}

export async function getReaderV2Data(id: string, pageId: string): Promise<ReaderV2Data> {
  const ctx = await getTenantContext();
  const db = await getReadDb();

  const currentPage = await db.collection('pages').findOne(
    { id: pageId },
    { projection: { detected_images: 0 } }
  );
  if (!currentPage) notFound();

  const [bookResult, navPages] = await Promise.all([
    findBookByIdOrSlug(db, id, BOOK_NAV_PROJECTION, ctx?.id ?? undefined),
    db.collection('pages')
      .find({ book_id: currentPage.book_id as string, page_number: { $gte: 0 } })
      .project({ _id: 0, id: 1, page_number: 1, split_from: 1, page_type: 1, display_photo: 1, archived_photo: 1, photo: 1 })
      .sort({ page_number: 1 })
      .maxTimeMS(15000)
      .toArray()
      .then(pages => pages.filter(p => p.page_type !== 'digitizer-insert' && p.page_type !== 'archived-spread' && (p.page_number == null || p.page_number >= 0)))
      .catch(() => [{ id: pageId, page_number: currentPage.page_number }]),
  ]);

  if (!bookResult) notFound();
  const book = bookResult.book as unknown as Book;

  // Design previews follow the same visibility gate as the public reader.
  if (isHiddenBook(book as unknown as object)) notFound();

  const scopedBookId = (book.id || (book as unknown as { _id?: { toString(): string } })._id?.toString()) as string;
  if ((currentPage.book_id as string) !== scopedBookId) notFound();

  return {
    book,
    page: JSON.parse(JSON.stringify(currentPage)) as Page,
    pageList: JSON.parse(JSON.stringify(navPages)) as Page[],
  };
}
