import { notFound } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import { findTenantBookByIdOrSlug } from '@/lib/tenant-book-lookup';
import type { Book, Page } from '@/lib/types';
import PageEditorClient from './PageEditorClient';
import EmbedNavigationReporter from '@/components/embed/EmbedNavigationReporter';

// ISR: 24h background revalidation. Pipeline also calls /api/admin/revalidate-book for immediate updates.
export const revalidate = 86400;

interface PageProps {
  params: Promise<{ tenant: string; id: string; pageId: string }>;
}

// Book projection: only fields needed by the reader
const BOOK_NAV_PROJECTION = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1,
  author: 1, published: 1, language: 1, doi: 1, chapters: 1,
  cdli_witnesses: 1, etcsl_id: 1,
};

export default async function PageEditorPage({ params }: PageProps) {
  const { tenant, id, pageId } = await params;
  const db = await getReadDb();

  // Step 1: Get current page (fast indexed lookup by id, gives us book_id for nav)
  const currentPage = await db.collection('pages').findOne(
    { id: pageId },
    { projection: { detected_images: 0 } }
  );

  if (!currentPage) {
    notFound();
  }

  // Step 2: Book lookup + nav pages in parallel (both can start now)
  const [bookResult, navPages] = await Promise.all([
    findTenantBookByIdOrSlug(db, tenant, id, BOOK_NAV_PROJECTION),
    db.collection('pages')
      .find({ book_id: currentPage.book_id as string, page_number: { $gte: 0 } })
      .project({ _id: 0, id: 1, page_number: 1, split_from: 1, page_type: 1 })
      .sort({ page_number: 1 })
      .maxTimeMS(15000)
      .toArray()
      .then(pages => pages.filter(p => p.page_type !== 'digitizer-insert' && p.page_type !== 'archived-spread' && (p.page_number == null || p.page_number >= 0)))
      .catch((err) => {
        console.error(`[page-nav] Failed to load page list for book ${currentPage.book_id}:`, err.message);
        return [{ id: pageId, page_number: currentPage.page_number }];
      }),
  ]);

  if (!bookResult) {
    notFound();
  }

  const book = bookResult.book as unknown as Book;
  const scopedBookId = (book.id || (book as any)._id?.toString()) as string;
  if ((currentPage.book_id as string) !== scopedBookId) {
    notFound();
  }

  // Serialize MongoDB objects (ObjectId, Date) to plain JS for client components
  const serializedPage = JSON.parse(JSON.stringify(currentPage)) as Page;
  const serializedNavPages = JSON.parse(JSON.stringify(navPages)) as Page[];

  return (
    <>
      <EmbedNavigationReporter book={book.slug || book.id} page={pageId} />
      <PageEditorClient
        initialBook={book}
        initialPage={serializedPage}
        initialPageList={serializedNavPages}
      />
    </>
  );
}
