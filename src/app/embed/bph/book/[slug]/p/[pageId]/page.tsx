import { notFound } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import type { Book, Page } from '@/lib/types';
import EmbedPageReaderWrapper from './EmbedPageReaderWrapper';
import EmbedNavigationReporter from '@/components/embed/EmbedNavigationReporter';

export const revalidate = 86400;
export const preferredRegion = 'fra1';
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

const BOOK_NAV_PROJECTION = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1,
  author: 1, published: 1, language: 1, doi: 1, chapters: 1,
  cdli_witnesses: 1, etcsl_id: 1,
};

/**
 * BPH embed page reader — self-contained data fetching.
 * Uses a local wrapper with next/dynamic to lazy-load PageEditorClient,
 * avoiding build-time chunk resolution failures in the embed route tree.
 */
export default async function EmbedPageRoute({ params }: { params: Promise<{ slug: string; pageId: string }> }) {
  const { slug, pageId } = await params;
  const db = await getReadDb();

  const currentPage = await db.collection('pages').findOne(
    { id: pageId },
    { projection: { detected_images: 0 } }
  );
  if (!currentPage) notFound();

  const [bookResult, navPages] = await Promise.all([
    findBookByIdOrSlug(db, slug, BOOK_NAV_PROJECTION),
    db.collection('pages')
      .find({ book_id: currentPage.book_id as string, page_number: { $gte: 0 } })
      .project({ _id: 0, id: 1, page_number: 1, split_from: 1, page_type: 1 })
      .sort({ page_number: 1 })
      .maxTimeMS(15000)
      .toArray()
      .then(pages => pages.filter(p => p.page_type !== 'digitizer-insert' && p.page_type !== 'archived-spread' && (p.page_number == null || p.page_number >= 0)))
      .catch(() => [{ id: pageId, page_number: currentPage.page_number }]),
  ]);

  if (!bookResult) notFound();

  const book = bookResult.book as unknown as Book;
  const scopedBookId = (book.id || (book as any)._id?.toString()) as string;
  if ((currentPage.book_id as string) !== scopedBookId) notFound();

  const serializedPage = JSON.parse(JSON.stringify(currentPage)) as Page;
  const serializedNavPages = JSON.parse(JSON.stringify(navPages)) as Page[];

  return (
    <>
      <EmbedNavigationReporter book={book.slug || book.id} page={pageId} />
      <EmbedPageReaderWrapper
        book={book}
        page={serializedPage}
        pageList={serializedNavPages}
      />
    </>
  );
}
