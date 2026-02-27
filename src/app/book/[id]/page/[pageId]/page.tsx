import { notFound } from 'next/navigation';
import { getDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import type { Book, Page } from '@/lib/types';
import PageEditorClient from './PageEditorClient';

// ISR: rebuild at most every 2 minutes
export const revalidate = 120;

interface PageProps {
  params: Promise<{ id: string; pageId: string }>;
}

// Book projection: only fields needed by the reader
const BOOK_NAV_PROJECTION = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1,
  author: 1, published: 1, language: 1, doi: 1, chapters: 1,
};

export default async function PageEditorPage({ params }: PageProps) {
  const { id, pageId } = await params;
  const db = await getDb();

  // Parallel: book lookup + current page full data
  const [bookResult, currentPage] = await Promise.all([
    findBookByIdOrSlug(db, id, BOOK_NAV_PROJECTION),
    db.collection('pages').findOne(
      { id: pageId },
      { projection: { detected_images: 0 } }
    ),
  ]);

  if (!bookResult || !currentPage) {
    notFound();
  }

  const book = bookResult.book as unknown as Book;

  // Nav page list (lightweight — id + page_number only)
  const navPages = await db.collection('pages')
    .find({ book_id: book.id })
    .project({ _id: 0, id: 1, page_number: 1, split_from: 1 })
    .sort({ page_number: 1 })
    .toArray();

  return (
    <PageEditorClient
      initialBook={book}
      initialPage={currentPage as unknown as Page}
      initialPageList={navPages as unknown as Page[]}
    />
  );
}
