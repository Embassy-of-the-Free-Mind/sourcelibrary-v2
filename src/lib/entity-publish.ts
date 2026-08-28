import type { Db } from 'mongodb';

/**
 * The published tier of the entity layer (#4321).
 *
 * An entity page is PUBLISHED — indexable, sitemap-eligible, worth linking
 * from prose — when it has both:
 *
 *   - reach:    appears in >= 3 books (a cross-corpus claim needs three
 *               witnesses; the 2-book case is the "Triple Anatomy" pathology
 *               where co-occurrence is just the union of two books' indexes)
 *   - identity: an external anchor — a Wikidata link or a description. This
 *               is what separates *Ptolemy* from *Axis*: the offline
 *               enrichment does not deliberately match a common noun used in
 *               its ordinary sense.
 *
 * This is a read-side predicate over existing fields — deliberately not a
 * stored flag, so no bulk `entities` write can exist, no sweep can be
 * clobbered by another session, and the tier is reversible by editing this
 * one function. Below-the-line pages keep rendering (a URL we have shown a
 * reader must not 404); they are noindexed and internal surfaces stop
 * linking to them.
 *
 * Keep `isPublishedEntity` and `PUBLISHED_ENTITY_FILTER` semantically in
 * step — one gates on a fetched doc, the other inside a Mongo query, and a
 * guard that only normalizes one side is inert (see
 * tests/unit/entity-publish.test.ts, which pins both).
 */
export const PUBLISHED_ENTITY_MIN_BOOKS = 3;

export interface EntityPublishFields {
  book_count?: number | null;
  wikidata_id?: string | null;
  description?: string | null;
}

export function isPublishedEntity(entity: EntityPublishFields): boolean {
  // Strict `!== ''` (no trim) so this stays exactly expressible as the Mongo
  // filter below — a guard must normalize BOTH sides, and $ne can't trim.
  const reach = (entity.book_count ?? 0) >= PUBLISHED_ENTITY_MIN_BOOKS;
  const identity =
    (typeof entity.wikidata_id === 'string' && entity.wikidata_id !== '') ||
    (typeof entity.description === 'string' && entity.description !== '');
  return reach && identity;
}

/**
 * The same tier as a Mongo filter fragment, for gating link lookups.
 * Note: this reads the stored `book_count`, which on legacy rows can
 * overcount duplicated `books[]` entries; the page itself decides noindex
 * from the deduped count (the citable surface gets the accurate value, the
 * link side an indexed approximation).
 */
export const PUBLISHED_ENTITY_FILTER = {
  book_count: { $gte: PUBLISHED_ENTITY_MIN_BOOKS },
  $or: [
    { wikidata_id: { $type: 'string', $ne: '' } },
    { description: { $type: 'string', $ne: '' } },
  ],
} as const;

/**
 * Which of these index terms name a published entity? One indexed `$in`
 * read; matches on exact `name` only (the extractors create entities under
 * the index term verbatim, so the alias fallback the encyclopedia page has
 * is not needed for gating links built from a book's own index).
 */
export async function filterPublishedEntityTerms(
  db: Db,
  terms: string[],
): Promise<Set<string>> {
  const unique = [...new Set(terms.filter(Boolean))];
  if (unique.length === 0) return new Set();
  const docs = await db
    .collection('entities')
    .find(
      { name: { $in: unique }, ...PUBLISHED_ENTITY_FILTER },
      { projection: { _id: 0, name: 1 }, maxTimeMS: 15000 },
    )
    .toArray();
  return new Set(docs.map((d) => d.name as string));
}
