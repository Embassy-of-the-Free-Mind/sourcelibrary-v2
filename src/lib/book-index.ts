/**
 * Book index data access layer.
 *
 * The book "index" (TOC, summaries, entities, vocabulary) was originally stored
 * inline on book documents, bloating them to 100KB-2.6MB and causing slow
 * collection scans on Atlas. This module reads from the dedicated `book_indexes`
 * collection, with a fallback to the legacy `book.index` field for unmigrated docs.
 */

import { getReadDb } from '@/lib/mongodb';

export interface BookIndexData {
  entries?: Array<{ term: string; pages: number[]; type: 'vocab' | 'term' | 'keyword' }>;
  pageSummaries?: Array<{ page: number; summary: string }>;
  sectionSummaries?: Array<{ title: string; startPage: number; endPage: number; summary: string }>;
  bookSummary?: { brief?: string; detailed?: string; abstract?: string };
  people?: Array<{ name: string; role?: string }>;
  places?: Array<{ name: string }>;
  concepts?: Array<{ name: string }>;
  generatedAt?: Date;
  pagesCovered?: number;
  totalPages?: number;
}

/**
 * Fetch the index data for a book. Checks `book_indexes` first,
 * falls back to inline `book.index` for unmigrated documents.
 */
export async function getBookIndex(bookId: string): Promise<BookIndexData | null> {
  const db = await getReadDb();

  // Try the dedicated collection first
  const doc = await db.collection('book_indexes').findOne(
    { book_id: bookId },
    { maxTimeMS: 5000 }
  );
  if (doc) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _id, book_id, ...indexData } = doc;
    return indexData as BookIndexData;
  }

  // Fallback: read from inline book.index (legacy)
  const book = await db.collection('books').findOne(
    { id: bookId },
    { projection: { index: 1 }, maxTimeMS: 5000 }
  );
  return (book?.index as BookIndexData) || null;
}
