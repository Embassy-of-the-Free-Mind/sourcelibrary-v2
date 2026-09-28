/**
 * Book index data access layer.
 *
 * The book "index" (TOC, summaries, entities, vocabulary) was originally stored
 * inline on book documents, bloating them to 100KB-2.6MB and causing slow
 * collection scans on Atlas. This module reads from the dedicated `book_indexes`
 * collection, with a fallback to the legacy `book.index` field for unmigrated docs.
 *
 * A `book_indexes` doc averages ~145 KB (#5184): `vocabulary` ~38 KB,
 * `keywords` ~20 KB, `people`/`concepts`/`places` ~6–8 KB each, `pageSummaries`
 * ~6 KB, `sectionSummaries` ~3 KB, `bookSummary` ~2 KB. Almost every request-path
 * consumer reads one or two of those. The old `{ projection: { _id: 0, book_id: 0 } }`
 * idiom shipped the whole doc on every book-detail render, chat turn and IIIF
 * manifest — so reads go through `getBookIndexFields()` with an explicit field
 * list, one named constant per call site (#4603: a projection can starve a
 * downstream branch, so the list is declared where the reads are).
 */

import type { Db } from 'mongodb';
import { getReadDb } from '@/lib/mongodb';

export interface BookIndexData {
  entries?: Array<{ term: string; pages: number[]; type: 'vocab' | 'term' | 'keyword' }>;
  pageSummaries?: Array<{ page: number; summary: string }>;
  sectionSummaries?: Array<{ title: string; startPage: number; endPage: number; summary: string }>;
  bookSummary?: { brief?: string; detailed?: string; abstract?: string };
  people?: Array<{ name: string; role?: string }>;
  places?: Array<{ name: string }>;
  concepts?: Array<{ name: string }>;
  keywords?: Array<{ term: string; pages?: number[] }>;
  vocabulary?: Array<{ term: string; pages?: number[] }>;
  generatedAt?: Date;
  pagesCovered?: number;
  totalPages?: number;
  method?: string;
}

/** Top-level keys of a `book_indexes` doc (measured 2026-09-26, 40-doc sample). */
export type BookIndexField = keyof BookIndexData;

/**
 * A field to include: a top-level key, or a dotted sub-path under one
 * (`'people.term'` keeps the array and its length, drops each entry's page list).
 */
export type BookIndexProjectionField = BookIndexField | `${BookIndexField}.${string}`;

/**
 * Read one book's index doc with an explicit inclusion list. `_id` and
 * `book_id` are never returned, so the result can be spread straight onto
 * `book.index` the way every call site does.
 *
 * Returns null when there is no doc OR the read fails — the same contract as
 * the `.catch(() => null)` every call site used to wrap the raw findOne in.
 * The index is enrichment, never the page's reason to exist; a failed read
 * must not 500 a book page.
 */
export async function getBookIndexFields(
  db: Db,
  bookId: string,
  fields: readonly BookIndexProjectionField[],
  opts: { tenantId?: string; maxTimeMS?: number } = {},
): Promise<Partial<BookIndexData> | null> {
  if (fields.length === 0) return null;
  const projection: Record<string, 0 | 1> = { _id: 0 };
  for (const f of fields) projection[f] = 1;
  const filter: Record<string, unknown> = { book_id: bookId };
  if (opts.tenantId) filter.tenantId = opts.tenantId;
  try {
    const doc = await db.collection('book_indexes').findOne(filter, {
      projection,
      maxTimeMS: opts.maxTimeMS ?? 5000,
    });
    return (doc as Partial<BookIndexData> | null) ?? null;
  } catch (err) {
    console.warn(`[book-index] read failed for ${bookId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Fetch the index data for a book. Checks `book_indexes` first,
 * falls back to inline `book.index` for unmigrated documents.
 *
 * Whole-document read — export/EPUB and index-regeneration callers that
 * genuinely consume every section. Request-path readers use
 * `getBookIndexFields()` with a field list instead.
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
