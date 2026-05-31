import { ObjectId } from 'mongodb';

/**
 * Canonical author thesaurus read-path resolver (GitHub #2250, step 2.5 of #2179).
 *
 * The `authors` collection is a built-but-orphaned authority file: one doc per
 * canonical person, with `variant_slugs[]` (every URL form that should resolve
 * to this person), `variants[]` (every author-string form), and `entity_ids[]`
 * (the legacy `entities` ids merged into this person). Until now NOTHING on the
 * site read it — `/author/[slug]` resolved via the per-string `author_slugs`
 * cache, so one person had many URLs (Athanasius Kircher had 8).
 *
 * This module resolves an incoming slug to its ONE canonical author and the full
 * deduplicated book set, signalling a 301 when the requested slug is a non-
 * canonical variant. It is gated behind AUTHOR_THESAURUS_READPATH — when off,
 * callers fall back to the legacy entity/string path unchanged.
 *
 * Book matching is deliberately a UNION of two keys:
 *   - author_entity_id ∈ entity_ids   (books already linked to a merged entity)
 *   - author ∈ variants               (books with the right author STRING but no
 *                                       entity link — ~2,278 live books today)
 * The second arm is why the migration fixes the "cheaply linkable" tail for free
 * at read time: a book authored "John Calvin" with no entity_id still lands on
 * the canonical John Calvin page because "John Calvin" is one of his variants.
 */

export const AUTHOR_THESAURUS_READPATH =
  process.env.AUTHOR_THESAURUS_READPATH === '1' ||
  process.env.AUTHOR_THESAURUS_READPATH === 'true';

/** NFD-strip + lowercase, matching how variants/variant_slugs were built. */
function norm(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export interface AuthorThesaurusDoc {
  _id: string;            // canonical slug
  canonical_name: string;
  slug: string;
  variants?: string[];
  variant_slugs?: string[];
  entity_ids?: string[];
  viaf_id?: string;
  wikidata_id?: string;
  book_count?: number;
}

export interface AuthorEntityEnrichment {
  _id: ObjectId;
  name?: string;
  canonical_name?: string;
  description?: string;
  aliases?: string[];
  viaf_id?: string;
  wikidata_id?: string;
  wikipedia_url?: string;
  wikidata_birth_date?: string;
  wikidata_death_date?: string;
  portrait_url?: string;
}

export interface ResolvedAuthor {
  /** The canonical author doc. */
  doc: AuthorThesaurusDoc;
  /** Canonical URL slug. If this differs from the requested slug, 301 to it. */
  canonicalSlug: string;
  /** Display name (entity canonical_name wins, else thesaurus canonical_name). */
  canonicalName: string;
  /** Legacy entity doc for description/portrait/life-date enrichment (or null). */
  entity: AuthorEntityEnrichment | null;
  /** Raw book docs (caller projects/partitions). */
  books: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const ENTITY_PROJECTION = {
  name: 1, canonical_name: 1, description: 1, aliases: 1,
  viaf_id: 1, wikidata_id: 1, wikipedia_url: 1,
  wikidata_birth_date: 1, wikidata_death_date: 1, portrait_url: 1,
};

/**
 * Resolve an incoming author slug to its canonical author via the `authors`
 * thesaurus. Returns null when the slug maps to no canonical person (caller
 * should fall back to the legacy path or notFound()).
 *
 * @param db        a read DB handle (getReadDb()).
 * @param slug      the requested /author/[slug] segment (already hyphen-normalized).
 * @param bookProjection  projection for the returned book docs.
 */
export async function resolveCanonicalAuthor(
  db: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  slug: string,
  bookProjection: Record<string, number>,
): Promise<ResolvedAuthor | null> {
  const authors = db.collection('authors');

  // 1. Direct hit: the slug is a known canonical slug or variant slug.
  let doc: AuthorThesaurusDoc | null = await authors.findOne({
    $or: [{ _id: slug }, { variant_slugs: slug }, { slug }],
  });

  // 2. Indirect: the slug is a stale/title-contaminated cache entry not present
  //    as a variant_slug (e.g. `kircher-mundus`). Resolve the cache name string
  //    to a canonical author by matching its normalized form against variants.
  if (!doc) {
    const config = await db.collection('system_config').findOne(
      { _id: 'author_slugs' },
      { projection: { slugs: 1 } },
    );
    const cachedName: string | undefined = config?.slugs?.[slug];
    if (cachedName) {
      const n = norm(cachedName);
      // Pull candidate docs whose variants include this name (normalized compare
      // in JS — variants store original case/diacritics).
      const candidates: AuthorThesaurusDoc[] = await authors
        .find({ variants: { $exists: true, $ne: [] } }, {
          projection: { canonical_name: 1, slug: 1, variants: 1, variant_slugs: 1, entity_ids: 1, viaf_id: 1, wikidata_id: 1, book_count: 1 },
        })
        .toArray();
      doc = candidates.find(d => (d.variants || []).some(v => norm(v) === n)) || null;
    }
  }

  if (!doc) return null;

  const canonicalSlug = doc.slug || doc._id;

  // 3. Fetch the full deduplicated book set: linked-by-entity UNION matched-by-name.
  const entityIds = (doc.entity_ids || []).filter(Boolean);
  const variants = (doc.variants || []).filter(Boolean);
  const orClauses: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (entityIds.length) orClauses.push({ author_entity_id: { $in: entityIds } });
  if (variants.length) orClauses.push({ author: { $in: variants } });
  // Safety net: a doc with neither (shouldn't happen) matches by canonical_name.
  if (orClauses.length === 0) orClauses.push({ author: doc.canonical_name });

  const books = await db.collection('books')
    .find({ visible: true, $or: orClauses }, { projection: bookProjection })
    .sort({ year: 1, title: 1 })
    .toArray();

  // 4. Entity enrichment (description/portrait/dates) from the first linked entity.
  let entity: AuthorEntityEnrichment | null = null;
  const enrichId = entityIds.find(id => ObjectId.isValid(id))
    || books.find((b: any) => b.author_entity_id && ObjectId.isValid(b.author_entity_id))?.author_entity_id; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (enrichId) {
    try {
      entity = await db.collection('entities').findOne(
        { _id: new ObjectId(enrichId) },
        { projection: ENTITY_PROJECTION },
      ) as AuthorEntityEnrichment | null;
    } catch { /* invalid ObjectId — leave entity null */ }
  }

  return {
    doc,
    canonicalSlug,
    canonicalName: entity?.canonical_name || entity?.name || doc.canonical_name,
    entity,
    books,
  };
}
