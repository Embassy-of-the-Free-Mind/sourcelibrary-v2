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
 * 4. slug_aliases — ONLY on a miss (old slugs after a rename), so the common
 *    hot path stays a single indexed lookup. See note below.
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
  if (book) {
    const matchedBySlug = book.slug === idOrSlug;
    return { book, matchedBySlug };
  }

  // Miss path only: the slug/id/_id lookup found nothing, so this might be an
  // OLD slug from a rename. Resolve via slug_aliases (indexed by
  // books_slug_aliases_idx) and let the caller 301 to the canonical slug.
  // Kept OUT of the $or above so it never touches the common hot path — it
  // runs solely on a would-be 404, where one extra indexed findOne is free.
  const aliasQuery: Document = { slug_aliases: idOrSlug };
  if (tenantId) aliasQuery.tenantId = tenantId;
  const aliased = await db.collection('books').findOne(aliasQuery, opts);
  if (!aliased) return null;

  // Matched by alias, not the canonical slug → caller redirects to aliased.slug.
  return { book: aliased, matchedBySlug: false };
}
