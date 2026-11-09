/**
 * The copy a reader should use instead of a book hidden as a same-edition
 * duplicate: follow `duplicate_of` until a visible, readable book (#8235).
 *
 * Why: a client that cached a book before it was hidden (Rik's Makepad app on
 * 2026-11-07: 28 "Book not found" on three such books, retried for ten hours)
 * gets a bare 404 and cannot recover. With the kept copy named, it can switch.
 * Measured 2026-11-08: 98 books hidden as same_edition_duplicate, 97 reach a
 * visible copy within two hops; one (a Martialis) ends at a hidden book.
 *
 * PRIOR ART: src/app/api/admin/edition-keepers/route.ts lists keepers for the
 * admin queue; src/app/api/search/route.ts carries duplicate_of to fold results.
 * Neither resolves a chain to the copy a reader can open, which is what an
 * error body needs.
 */
import type { Db } from 'mongodb';

export interface KeptEdition {
  id: string;
  slug?: string;
  title?: string;
  url: string;
  text_api: string;
}

const MAX_HOPS = 5;

export async function resolveKeptEdition(db: Db, duplicateOf: unknown): Promise<KeptEdition | null> {
  let next = typeof duplicateOf === 'string' && duplicateOf ? duplicateOf : null;
  const seen = new Set<string>();
  for (let hop = 0; next && hop < MAX_HOPS && !seen.has(next); hop++) {
    seen.add(next);
    const b = await db.collection('books').findOne(
      { id: next },
      { projection: { _id: 0, id: 1, slug: 1, title: 1, display_title: 1, visible: 1, pages_count: 1, duplicate_of: 1 }, maxTimeMS: 3000 },
    );
    if (!b) return null;
    if (b.visible === true && (b.pages_count ?? 0) > 0) {
      const path = b.slug || b.id;
      return {
        id: b.id,
        slug: b.slug,
        title: b.display_title || b.title,
        url: `https://sourcelibrary.org/book/${path}`,
        text_api: `https://sourcelibrary.org/api/books/${b.id}/text`,
      };
    }
    next = typeof b.duplicate_of === 'string' ? b.duplicate_of : null;
  }
  return null;
}
