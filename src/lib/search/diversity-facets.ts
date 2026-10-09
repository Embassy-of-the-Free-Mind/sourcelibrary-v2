/**
 * The per-book facts the concept lanes re-rank on, read from Mongo.
 *
 * PRIOR ART: the slug / hidden lookups inline in src/app/api/search/semantic/route.ts
 * and src/lib/search/librarian-search.ts — each reads `books` by id for its own
 * fields; none reads `tradition`, `work_id` or `author_id`, and none is
 * shared. Kept apart from diversity.ts so that file stays free of a database
 * client.
 */
import { getDb } from '@/lib/mongodb';
import type { BookFacets } from '@/lib/search/diversity';

export interface LoadedBookFacets extends BookFacets {
  slug?: string | null;
  /** False for a book the public reader does not serve (hidden, or not visible). */
  live: boolean;
}

export interface BookFacetLookup {
  /** False when Mongo did not answer: callers then re-rank nothing and drop nothing. */
  ok: boolean;
  facets: Map<string, LoadedBookFacets>;
}

export async function loadBookFacets(bookIds: string[]): Promise<BookFacetLookup> {
  const ids = [...new Set(bookIds.filter(Boolean))];
  const facets = new Map<string, LoadedBookFacets>();
  if (ids.length === 0) return { ok: true, facets };
  try {
    const db = await getDb();
    const docs = await db.collection('books')
      .find(
        { id: { $in: ids } },
        { projection: { _id: 0, id: 1, slug: 1, tradition: 1, work_id: 1, author_id: 1, author: 1, visible: 1, hidden: 1 }, maxTimeMS: 3000 },
      )
      .toArray();
    for (const d of docs) {
      facets.set(d.id as string, {
        tradition: Array.isArray(d.tradition) ? d.tradition as string[] : null,
        work_id: (d.work_id as string) || null,
        author_id: (d.author_id as string) || null,
        author: (d.author as string) || null,
        slug: (d.slug as string) || null,
        live: d.visible !== false && d.hidden !== true,
      });
    }
    return { ok: true, facets };
  } catch {
    return { ok: false, facets };
  }
}
