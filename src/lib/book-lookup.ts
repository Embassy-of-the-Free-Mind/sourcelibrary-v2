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

/** A string with the shape of a `books.id`: a 24-hex ObjectId string, or a UUID (85 early books). */
const ID_SHAPED = /^(?:[a-f0-9]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** True when the string already has the shape of a book id, so it needs no lookup to become one. */
export function isBookIdShaped(ref: string): boolean {
  return ID_SHAPED.test(ref);
}

/**
 * The `books.id` behind whatever a caller used to name a book: the id itself,
 * or the slug from a book URL (`/book/<slug>`), current or renamed.
 *
 * Why: every link we hand out is `/book/<slug>`, so an assistant that has only
 * the link passes the slug as `book_id`. Routes that filter `pages.book_id` by
 * the caller's string then find nothing, and report "Book not found" or, worse,
 * an empty result that reads as "the book does not say that" (30 days to
 * 2026-11-12: 25 of the 76 distinct ids the connector answered "Book not
 * found" for were visible, readable books).
 *
 * An id-shaped string is returned as it came, with no query, so the usual call
 * costs nothing. Anything else is one indexed lookup on `slug`, then on
 * `slug_aliases`. A string that matches no book also comes back unchanged, so
 * the caller's own not-found path answers exactly as it did before.
 *
 * This resolves a NAME only. It says nothing about whether the book may be
 * read: the caller still runs its own visibility and tenant checks on the book
 * it then loads.
 */
export async function resolveBookRef(db: Db, ref: string): Promise<string> {
  if (!ref || ID_SHAPED.test(ref)) return ref;
  const opts = { projection: { _id: 0, id: 1 }, maxTimeMS: 3000 };
  const books = db.collection('books');
  const found = (await books.findOne({ slug: ref }, opts)) ?? (await books.findOne({ slug_aliases: ref }, opts));
  return typeof found?.id === 'string' && found.id ? found.id : ref;
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
