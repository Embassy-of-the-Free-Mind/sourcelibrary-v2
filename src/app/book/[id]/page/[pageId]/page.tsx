import { notFound } from 'next/navigation';
import { getDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import type { Book, Page } from '@/lib/types';
import PageEditorClient from './PageEditorClient';

// ISR: rebuild at most every hour (content changes infrequently)
export const revalidate = 600;

interface PageProps {
  params: Promise<{ id: string; pageId: string }>;
}

// Book projection: only fields needed by the reader
const BOOK_NAV_PROJECTION = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1,
  author: 1, published: 1, language: 1, doi: 1, chapters: 1,
  cdli_witnesses: 1, etcsl_id: 1,
};

export default async function PageEditorPage({ params }: PageProps) {
  const { id, pageId } = await params;
  const db = await getDb();

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
    findBookByIdOrSlug(db, id, BOOK_NAV_PROJECTION),
    db.collection('pages')
      .find({ book_id: currentPage.book_id as string })
      .project({ _id: 0, id: 1, page_number: 1, split_from: 1, page_type: 1 })
      .sort({ page_number: 1 })
      .maxTimeMS(15000)
      .toArray()
      .then(pages => pages.filter(p => p.page_type !== 'digitizer-insert'))
      .catch((err) => {
        console.error(`[page-nav] Failed to load page list for book ${currentPage.book_id}:`, err.message);
        return [{ id: pageId, page_number: currentPage.page_number }];
      }),
  ]);

  if (!bookResult) {
    notFound();
  }

  const book = bookResult.book as unknown as Book;

  return (
    <PageEditorClient
      initialBook={book}
      initialPage={currentPage as unknown as Page}
      initialPageList={navPages as unknown as Page[]}
    />
  );
}
