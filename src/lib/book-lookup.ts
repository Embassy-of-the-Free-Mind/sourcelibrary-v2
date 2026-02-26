/**
 * Shared book lookup that resolves slug, id, or _id.
 * Used by all /book/[idOrSlug] routes for dual routing support.
 */

import { Db, ObjectId, Document } from 'mongodb';

export interface BookLookupResult {
  book: Document;
  /** True if the book was found by slug (no redirect needed) */
  matchedBySlug: boolean;
}

/**
 * Find a book by slug, id, or _id. Returns null if not found.
 *
 * Lookup order:
 * 1. slug (new SEO-friendly URLs)
 * 2. id (existing URLs, internal references)
 * 3. _id as ObjectId (legacy URLs)
 *
 * The `matchedBySlug` flag tells the caller whether to 301 redirect
 * (if false and book has a slug, redirect to the slug URL).
 */
export async function findBookByIdOrSlug(
  db: Db,
  idOrSlug: string,
  projection?: Document
): Promise<BookLookupResult | null> {
  const opts = projection ? { projection } : undefined;

  // 1. Try slug first (most common for new URLs)
  let book = await db.collection('books').findOne({ slug: idOrSlug }, opts);
  if (book) {
    return { book, matchedBySlug: true };
  }

  // 2. Try id field
  book = await db.collection('books').findOne({ id: idOrSlug }, opts);
  if (book) {
    return { book, matchedBySlug: false };
  }

  // 3. Try _id as ObjectId
  try {
    if (ObjectId.isValid(idOrSlug)) {
      book = await db.collection('books').findOne({ _id: new ObjectId(idOrSlug) }, opts);
      if (book) {
        return { book, matchedBySlug: false };
      }
    }
  } catch {
    // Invalid ObjectId format
  }

  return null;
}
