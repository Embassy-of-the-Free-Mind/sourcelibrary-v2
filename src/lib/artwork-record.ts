/**
 * Is this `books` record an artwork rather than a text?
 *
 * Artworks live in the SAME Mongo `books` collection as texts (24,912 of
 * 110,016 docs on 2026-08-30), so every surface that lists "books" has to make
 * this call, and until now each one made it differently: /author/[name] carried
 * a private copy of the rule, /artist/[slug] keyed off `resource_type` alone,
 * and search never made the distinction at all — so the 97 live artwork records
 * rendered as book cards linking to /book/.
 *
 * The rule, in order:
 *
 *   1. `content_type` set to anything other than 'artwork' → NOT an artwork.
 *      An explicit label always beats an inferred one. This carve-out is what
 *      keeps a digitized papyrus text tagged `resource_type: 'papyrus_fragment'`
 *      out of /artwork/, and it is load-bearing for one live record today:
 *      "Babad Tanah Djawi lan Tanah-Tanah ing Sakiwa-Tengenipoen"
 *      (id 6a197add50f34ce9f2ea4a0d) is a real Javanese chronicle carrying
 *      content_type:'text' + resource_type:'text'. Any filter written as
 *      "resource_type is not null" deletes it from the library.
 *   2. `content_type === 'artwork'` → artwork.
 *   3. No `content_type` at all, but a `resource_type` → artwork. 6 records rely
 *      on this (painting ×2, print ×2, fresco, object); they predate the
 *      content_type backfill.
 *
 * Keep this in step with the SQL predicate in `NON_ARTWORK_FILTERS` below and
 * with scripts/workers/sync-books-catalog.mjs, which nulls `resource_type` on
 * anything explicitly labelled a book.
 */
export function isArtworkRecord(record: {
  content_type?: string | null;
  resource_type?: string | null;
}): boolean {
  if (record.content_type && record.content_type !== 'artwork') return false;
  return record.content_type === 'artwork' || !!record.resource_type;
}

/**
 * The same rule as a pair of PostgREST `or` filters for `books_catalog`, for
 * callers that must exclude artworks in the query rather than after it.
 *
 * Apply BOTH — supabase-js sends each `.or()` as its own `or=` param and
 * PostgREST ANDs them together:
 *
 *   for (const f of NON_ARTWORK_FILTERS) query = query.or(f);
 *
 * Together they express
 *   NOT (content_type = 'artwork' OR (content_type IS NULL AND resource_type IS NOT NULL))
 *
 * A plain `.not('content_type','eq','artwork')` will NOT do: SQL's three-valued
 * logic drops every row where content_type IS NULL, which is 19,432 of the
 * 31,731 live books.
 *
 * Measured 2026-08-30: 31,731 live rows → 31,635 with these applied (96
 * artworks removed, the Babad chronicle kept).
 */
export const NON_ARTWORK_FILTERS = [
  'content_type.is.null,content_type.neq.artwork',
  'content_type.not.is.null,resource_type.is.null',
] as const;

/**
 * `resource_type` values that name a medium or physical form — the only ones
 * worth showing as a type chip. The field is overloaded: roughly half its
 * values are subject matter ('religious', 'mythological', 'allegory',
 * 'genre-scene', 'anatomical') rather than a kind of thing, and a chip reading
 * "religious" tells a reader nothing about what they are looking at.
 */
const MEDIUM_RESOURCE_TYPES = new Set([
  'print', 'painting', 'drawing', 'object', 'sculpture', 'fresco',
  'photograph', 'manuscript', 'manuscript-illumination', 'map', 'emblem',
  'illustration', 'document', 'ritual-object',
]);

/**
 * Label for an artwork's type chip. Returns the medium when `resource_type`
 * names one, and the honest generic 'artwork' when it names a subject instead
 * (or names nothing at all) — never an empty chip, since the chip's job is to
 * say "this is not a book we hold".
 */
export function artworkTypeLabel(resourceType?: string | null): string {
  const value = (resourceType || '').trim().toLowerCase();
  if (!value || !MEDIUM_RESOURCE_TYPES.has(value)) return 'artwork';
  return value.replace(/-/g, ' ');
}
