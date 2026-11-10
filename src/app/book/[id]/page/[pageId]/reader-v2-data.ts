import { notFound } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import { findBookForTenant } from '@/lib/tenant-catalog-books';
import { getTenantContext } from '@/lib/tenant-context';
import { isHiddenBook } from '@/lib/book-access';
import type { Book, Page } from '@/lib/types';
import { READER_PAGE_PROJECTION, withoutTextLayer } from '@/lib/reader-page-projection';
import { loadReaderTextLayers, applyReaderTextLayer } from '@/lib/reader-text-layer';
import { serveEnglishOriginalPage } from '@/lib/english-original-text';
import { readerPageListFilter, isReaderListedPage } from '@/lib/reader-pages';
import { meteredReaderEnabled, gateLeafText } from '@/lib/free-preview';

// Shared server loader for the v2 reader design previews (/v2a, /v2c).
// Mirrors the (reader)/page.tsx fetch: current page + book + nav page list.
// These routes exist to compare the two redesign variants against real
// content; they are noindex and additive — the production reader is untouched.

const BOOK_NAV_PROJECTION = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1,
  author: 1, published: 1, language: 1, doi: 1, chapters: 1,
  visible: 1, 'translation_state.english_original': 1, facing_translation: 1,
  // The metered reader's free sample is a share of the book (#4357).
  pages_count: 1,
};

export interface ReaderV2Data {
  book: Book;
  page: Page;
  pageList: Page[];
}

export async function getReaderV2Data(id: string, pageId: string): Promise<ReaderV2Data> {
  const ctx = await getTenantContext();
  const db = await getReadDb();

  // Same inclusion list as the production reader (reader-page-projection.ts),
  // so the previews render from the same field set.
  const fetchedPage = await db.collection('pages').findOne(
    { id: pageId },
    { projection: READER_PAGE_PROJECTION }
  );
  const currentPage = withoutTextLayer(fetchedPage); // #5942: the stored text layer never reaches the payload
  if (!currentPage) notFound();

  const [bookResult, navPages, textLayers] = await Promise.all([
    findBookForTenant(db, id, BOOK_NAV_PROJECTION, ctx),
    db.collection('pages')
      .find(readerPageListFilter(currentPage.book_id as string))
      .project({ _id: 0, id: 1, page_number: 1, split_from: 1, page_type: 1, display_photo: 1, archived_photo: 1, photo: 1 })
      .sort({ page_number: 1 })
      .maxTimeMS(15000)
      .toArray()
      .then(pages => pages.filter(isReaderListedPage))
      .catch(() => [{ id: pageId, page_number: currentPage.page_number }]),
    loadReaderTextLayers(db, [fetchedPage]), // the notes layer, as the production reader reads it (#7965)
  ]);

  if (!bookResult) notFound();
  const book = bookResult.book as unknown as Book;

  // Design previews follow the same visibility gate as the public reader.
  if (isHiddenBook(book as unknown as object)) notFound();

  const scopedBookId = (book.id || (book as unknown as { _id?: { toString(): string } })._id?.toString()) as string;
  if ((currentPage.book_id as string) !== scopedBookId) notFound();

  // The metered reader (#4357) holds on this preview route exactly as on the
  // production reader: past the free sample the page goes out without its
  // text. Tenant reading rooms are exempt there, so they are here.
  const servedPage = serveEnglishOriginalPage(JSON.parse(JSON.stringify(currentPage)) as Page, book);
  const meteringApplies = meteredReaderEnabled() && !(ctx?.id || ctx?.isEmbedded);
  const page = gateLeafText(servedPage, (book as unknown as { pages_count?: number }).pages_count, meteringApplies);

  return {
    book,
    // English edition, English leaf: the transcription is the text (#7100).
    // The notes layer goes on last; a stripped page no longer matches it.
    page: applyReaderTextLayer(page, textLayers),
    pageList: JSON.parse(JSON.stringify(navPages)) as Page[],
  };
}
