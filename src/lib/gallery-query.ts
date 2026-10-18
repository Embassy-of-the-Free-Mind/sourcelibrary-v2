/**
 * The pieces of /api/gallery's query that a second reader must reproduce
 * exactly: the URL's narrowing filters, the quality floor, the
 * library/collection book lists, and the Atlas Search stage. /api/gallery
 * builds its rows from these and /api/gallery/stats counts with them, so the
 * numbers above the grid describe the images in it (the same reason
 * src/lib/gallery-scope.ts exists).
 */

import { subjectStringsForTopic } from '@/lib/image-subject-map';
import { getPartnerByProvider, getProviderKeys } from '@/lib/library-partners';
import { termVariants, isNoSpaceTerm, EVIDENCE_WEIGHTS } from '@/lib/search-grounding';
import { galleryMemo } from '@/lib/gallery-merge';

/** The filters that narrow any gallery request, read from its URL. */
export interface GalleryNarrowing {
  imageType: string | null;
  /** `topic` is a browse-vocabulary id (#4856) and expands to every raw subject string mapped to it; `subject` is one raw string, matched exactly. */
  subjectFilter: string | { $in: string[] } | null;
  figureFilter: string | null;
  symbolFilter: string | null;
  iconclassFilter: string | null;
  yearStart: number | null;
  yearEnd: number | null;
}

export function parseGalleryNarrowing(sp: URLSearchParams): GalleryNarrowing {
  const topicParam = sp.get('topic');
  return {
    imageType: sp.get('type'),
    subjectFilter: topicParam ? { $in: subjectStringsForTopic(topicParam) } : sp.get('subject'),
    figureFilter: sp.get('figure'),
    symbolFilter: sp.get('symbol'),
    iconclassFilter: sp.get('iconclass'),
    yearStart: sp.get('yearStart') ? parseInt(sp.get('yearStart')!) : null,
    yearEnd: sp.get('yearEnd') ? parseInt(sp.get('yearEnd')!) : null,
  };
}

/**
 * The narrowing as Mongo conditions on gallery_images. The Atlas lane's $match
 * never applied iconclass, so it asks for it to be left out.
 */
export function narrowingMatch(n: GalleryNarrowing, opts: { iconclass: boolean }): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  if (n.imageType) m.type = n.imageType;
  if (n.subjectFilter) m['metadata.subjects'] = n.subjectFilter;
  if (n.figureFilter) m['metadata.figures'] = n.figureFilter;
  if (n.symbolFilter) m['metadata.symbols'] = n.symbolFilter;
  if (opts.iconclass && n.iconclassFilter) {
    // Prefix match: ?iconclass=49 matches 49E39, 49C11, etc.
    m['metadata.iconclass'] = { $regex: `^${n.iconclassFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` };
  }
  if (n.yearStart !== null || n.yearEnd !== null) {
    const y: Record<string, number> = {};
    if (n.yearStart !== null) y.$gte = n.yearStart;
    if (n.yearEnd !== null) y.$lte = n.yearEnd;
    m.book_year = y;
  }
  return m;
}

/** Quality thresholds: gallery quality by default, 0.5 with includeArchive, or an explicit minQuality. */
export function galleryMinQuality(sp: URLSearchParams): number {
  let minQuality = 0.7;
  if (sp.get('includeArchive') === 'true') minQuality = 0.5;
  if (sp.get('minQuality')) minQuality = parseFloat(sp.get('minQuality')!);
  return minQuality;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { collection: (name: string) => any };

/** A collection's and a library's book ids, as the gallery filters by them. Memoized; a failed lookup throws. */
export async function resolveGalleryBookIds(db: Db, tenantId: string | null, collectionSlug: string | null, libraryFilter: string | null): Promise<{
  collectionBookIds: string[] | null;
  libraryBookIds: string[] | null;
}> {
  let collectionBookIds: string[] | null = null;
  if (collectionSlug) {
    // Memoized: a failed lookup throws out of the route (500, uncached),
    // never caches an empty list. Hidden books are also excluded downstream
    // by gallery_images.book_visible, so a 10-min-old list can't leak one.
    collectionBookIds = await galleryMemo(`coll-ids:${tenantId || ''}:${collectionSlug}`, () =>
      db.collection('books').distinct('id', {
        ...(tenantId ? { tenantId } : {}),
        collections: collectionSlug,
        visible: true,
        pages_count: { $gt: 0 },
      }, { maxTimeMS: 10000 }) as Promise<string[]>);
  }

  let libraryBookIds: string[] | null = null;
  if (libraryFilter) {
    // A partner's books can sit under alias keys too (mdz/bsb, ndl_japan/ndl).
    const libraryPartner = getPartnerByProvider(libraryFilter);
    const providerKeys = libraryPartner ? getProviderKeys(libraryPartner) : [libraryFilter];
    libraryBookIds = await galleryMemo(`lib-ids:${tenantId || ''}:${libraryFilter}`, () =>
      db.collection('books').distinct('id', {
        ...(tenantId ? { tenantId } : {}),
        'image_source.provider': { $in: providerKeys },
        visible: true,
        pages_count: { $gt: 0 },
      }, { maxTimeMS: 10000 }) as Promise<string[]>);
  }
  return { collectionBookIds, libraryBookIds };
}

/** Both lists narrow: a book must be in the collection AND the library. */
export function intersectBookIds(collectionBookIds: string[] | null, libraryBookIds: string[] | null): string[] | null {
  return collectionBookIds && libraryBookIds
    ? collectionBookIds.filter(id => libraryBookIds.includes(id))
    : (collectionBookIds || libraryBookIds);
}

/**
 * Atlas Search over the gallery_search index (description, museum_description,
 * subjects, figures). Every query term must match (AND), each as a whole word or
 * its plural in some field — the same rule the grounding check applies, so this
 * lane is grounded by construction and its $count is the real total. No fuzzy
 * (edits turned "rose" into "rosy"/"rise") and no autocomplete (prefixes turned
 * "cat" into "cathedral"). Boosts are the grounding module's evidence weights,
 * so "Best match" ranks an image TAGGED with the term above one that mentions it.
 */
export function gallerySearchStage(terms: string[], minQuality: number) {
  return {
    $search: {
      index: 'gallery_search',
      compound: {
        must: terms.map(t => {
          const fields: [string, number][] = [
            ['metadata.subjects', EVIDENCE_WEIGHTS.tags],
            ['metadata.figures', EVIDENCE_WEIGHTS.tags],
            ['description', EVIDENCE_WEIGHTS.description],
            ['museum_description', EVIDENCE_WEIGHTS.secondary],
          ];
          // Scripts without word spaces: the standard analyzer splits them
          // per character, so a text match would OR the characters. Phrase
          // keeps them contiguous.
          return {
            compound: {
              should: fields.map(([path, boost]) => isNoSpaceTerm(t)
                ? { phrase: { query: t, path, score: { boost: { value: boost } } } }
                : { text: { query: termVariants(t), path, score: { boost: { value: boost } } } }),
              minimumShouldMatch: 1,
            },
          };
        }),
        filter: [
          { range: { path: 'gallery_quality', gte: minQuality } },
        ],
      },
    },
  };
}

/** The $match that follows gallerySearchStage: what the gallery serves, inside the request's scope and filters. */
export function gallerySearchMatch(opts: {
  tenantBooks: Record<string, unknown>[] | null;
  bookId: string | null;
  bookIds: string[] | null;
  maxPerBook: number;
  narrowing: GalleryNarrowing;
}) {
  const { tenantBooks, bookId, bookIds, maxPerBook, narrowing } = opts;
  return {
    $match: {
      book_visible: true,
      extracted_url: { $ne: null },
      image_url: { $ne: null },
      ...(tenantBooks ? { $and: tenantBooks } : {}),
      ...(!bookId && maxPerBook < 100 ? { book_rank: { $lte: maxPerBook } } : {}),
      ...(bookId ? { book_id: bookId } : {}),
      ...(bookIds ? { book_id: { $in: bookIds } } : {}),
      ...narrowingMatch(narrowing, { iconclass: false }),
    },
  };
}
