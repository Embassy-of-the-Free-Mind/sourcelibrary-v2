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
 * 4. slug_aliases (old slugs after a rename — resolve, then 301 to canonical)
 *
 * The `matchedBySlug` flag tells the caller whether to 301 redirect
 * (if false and book has a slug, redirect to the slug URL). An alias match
 * returns matchedBySlug:false (book.slug !== the alias), so the caller
 * redirects the stale URL to the current canonical slug.
 *
 * If tenantId is provided, filters by that tenant for multi-tenant isolation.
 */
export async function findBookByIdOrSlug(
  db: Db,
  idOrSlug: string,
  projection?: Document,
  tenantId?: string
): Promise<BookLookupResult | null> {
  const opts = projection ? { projection } : undefined;

  // Single $or query instead of sequential lookups — saves 1-2 round trips
  // for id/ObjectId lookups (~200ms each with cross-region latency).
  const orConditions: Document[] = [
    { slug: idOrSlug },
    { id: idOrSlug },
    // Old slugs after a rename. Indexed by books_slug_aliases_idx — keep this
    // branch index-backed so the $or never degrades to a collection scan.
    { slug_aliases: idOrSlug },
  ];
  if (ObjectId.isValid(idOrSlug)) {
    try {
      orConditions.push({ _id: new ObjectId(idOrSlug) });
    } catch {
      // Invalid ObjectId format — skip
    }
  }

  const query: Document = { $or: orConditions };
  if (tenantId) query.tenantId = tenantId;

  const book = await db.collection('books').findOne(query, opts);
  if (!book) return null;

  const matchedBySlug = book.slug === idOrSlug;
  return { book, matchedBySlug };
}
