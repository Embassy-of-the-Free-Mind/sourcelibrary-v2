/**
 * Numbers for the gallery's stats band: images, the books they come from,
 * standalone artworks, when they were printed, and what kind of image they are.
 *
 * Counted with the same filters /api/gallery serves rows with, path for path:
 *  - the unfiltered browse (and the Artworks view) uses mergedBrowseFilters,
 *    plates and artworks both;
 *  - a text search uses the Atlas lane's own $search + $match stages;
 *  - every other filter uses galleryFilter + narrowingMatch.
 * What a search's extra lanes add (title artworks, the book-context and CLIP
 * fallbacks, a handful of images at most) is not counted: the band shows what
 * these filters hold, exactly, rather than mixing in lanes it cannot reproduce.
 */

import { PRINTED_BUCKETS } from '@/lib/catalog/filters';
import { mergedBrowseFilters } from '@/lib/gallery-merge';
import { galleryFilter } from '@/lib/gallery-scope';
import { queryTerms } from '@/lib/search-grounding';

/** A search too broad to count in time; the route answers 422 and the band shows the grid's own total. */
export class TooBroadError extends Error {
  constructor() { super('search too broad to count'); }
}

/** Words that match nearly every description on their own. */
const SMALL_WORDS = new Set(['a', 'an', 'and', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 'or', 'as', 'is', 'et', 'de', 'la', 'le', 'der', 'die', 'das', 'und', 'von']);
import {
  parseGalleryNarrowing, narrowingMatch, galleryMinQuality, resolveGalleryBookIds, intersectBookIds,
  gallerySearchStage, gallerySearchMatch,
} from '@/lib/gallery-query';

export interface GalleryStats {
  /** Images the breakdowns count: plates plus artworks. */
  total: number;
  /** Book plates, and the distinct books they come from. */
  plates: number;
  books: number;
  /** Standalone artworks in the set. */
  artworks: number;
  /** Half-centuries from 1400 to 1899, with an open bucket either side. Ignores the year filter, so the chart shows where the selection sits. */
  printed: { from: number | null; to: number | null; count: number }[];
  yearFirst: number | null;
  yearLast: number | null;
  /** Kind of image (woodcut, engraving, diagram…), largest first. */
  kinds: { value: string; count: number }[];
}

export interface GalleryStatsContext {
  tenantId: string | null;
  /** The tenant's books as a condition on gallery_images.book_id (the Atlas lane's scope), or null when global. */
  tenantBooks: Record<string, unknown>[] | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { collection: (name: string) => any };

type Facets = { total: number; books: number; kinds: Map<string, number>; buckets: Map<number, number>; first: number | null; last: number | null };

/** Years later than this are data errors (an artwork dated 6000), not printing dates. */
const lastPlausibleYear = () => new Date().getUTCFullYear();
/** $bucket boundaries matching PRINTED_BUCKETS: everything before 1400, each half-century, 1900 on. */
const boundaries = () => [-100_000, ...PRINTED_BUCKETS.slice(1).map(([from]) => from as number), lastPlausibleYear() + 1];

function facetStages(yearField: string, kindField: string, bookField: string | null, withCounts: boolean) {
  const dated = { $match: { [yearField]: { $type: 'number', $lte: lastPlausibleYear() } } };
  return {
    $facet: {
      ...(withCounts ? {
        total: [{ $count: 'n' }],
        ...(bookField ? { books: [{ $group: { _id: `$${bookField}` } }, { $count: 'n' }] } : {}),
        kinds: [{ $group: { _id: `$${kindField}`, n: { $sum: 1 } } }],
      } : {}),
      years: [dated, { $bucket: { groupBy: `$${yearField}`, boundaries: boundaries(), default: 'other', output: { n: { $sum: 1 } } } }],
      span: [dated, { $group: { _id: null, a: { $min: `$${yearField}` }, b: { $max: `$${yearField}` } } }],
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readFacets(r: any): Facets {
  const kinds = new Map<string, number>();
  for (const k of r?.kinds ?? []) if (k._id) kinds.set(String(k._id), k.n);
  const buckets = new Map<number, number>();
  for (const y of r?.years ?? []) if (typeof y._id === 'number') buckets.set(y._id, y.n);
  return {
    total: r?.total?.[0]?.n ?? 0,
    books: r?.books?.[0]?.n ?? 0,
    kinds,
    buckets,
    first: r?.span?.[0]?.a ?? null,
    last: r?.span?.[0]?.b ?? null,
  };
}

const EMPTY: Facets = { total: 0, books: 0, kinds: new Map(), buckets: new Map(), first: null, last: null };
const OPTS = { allowDiskUse: true, maxTimeMS: 20_000 };

/** The plates and artworks one set of gallery parameters serves, as facets. */
async function setFacets(db: Db, sp: URLSearchParams, ctx: GalleryStatsContext, withCounts: boolean): Promise<{ plates: Facets; artworks: Facets }> {
  const narrowing = parseGalleryNarrowing(sp);
  const minQuality = galleryMinQuality(sp);
  const maxPerBook = parseInt(sp.get('maxPerBook') || '1000');
  const bookId = sp.get('bookId') || sp.get('book');
  const searchQuery = sp.get('q');
  const collectionSlug = sp.get('collection');
  const libraryFilter = sp.get('library');
  const source = sp.get('source') || 'all';
  const plateStages = facetStages('book_year', 'type', 'book_id', withCounts);
  const gi = db.collection('gallery_images');

  // Same test as /api/gallery's merged browse.
  const isPlainBrowse = !bookId && !searchQuery && !collectionSlug && !libraryFilter
    && !narrowing.subjectFilter && !narrowing.figureFilter && !narrowing.symbolFilter && !narrowing.iconclassFilter;
  if (isPlainBrowse && (source === 'all' || source === 'artwork')) {
    const f = mergedBrowseFilters({
      tenantId: ctx.tenantId, source, imageType: narrowing.imageType, minQuality, maxPerBook,
      yearStart: narrowing.yearStart, yearEnd: narrowing.yearEnd, qualityExplicit: sp.get('minQuality') !== null,
    });
    const [plates, artworks] = await Promise.all([
      source === 'artwork' ? Promise.resolve([null]) : gi.aggregate([{ $match: f.illus }, plateStages], OPTS).toArray(),
      db.collection('books').aggregate([{ $match: f.art }, facetStages('year', 'resource_type', null, withCounts)], OPTS).toArray(),
    ]);
    return { plates: source === 'artwork' ? EMPTY : readFacets(plates[0]), artworks: readFacets(artworks[0]) };
  }

  const { collectionBookIds, libraryBookIds } = await resolveGalleryBookIds(db, ctx.tenantId, collectionSlug, libraryFilter);
  const bookIds = intersectBookIds(collectionBookIds, libraryBookIds);

  if (searchQuery) {
    const qTerms = queryTerms(searchQuery);
    // A query with no checkable words returns nothing on the gallery, so it counts nothing.
    if (!qTerms?.judgeable) return { plates: EMPTY, artworks: EMPTY };
    // Only small words ("the", "of the"): every description matches, the count
    // takes ~19 s, and the grid's own lane gives up at 8 s with a short estimate.
    // No numbers rather than numbers that disagree; the band shows the grid's.
    if (qTerms.terms.every((t) => SMALL_WORDS.has(t))) throw new TooBroadError();
    const r = await gi.aggregate([
      gallerySearchStage(qTerms.terms, minQuality),
      gallerySearchMatch({ tenantBooks: ctx.tenantBooks, bookId, bookIds, maxPerBook, narrowing }),
      plateStages,
      // The grid's Atlas lane gives up at 8 s; so does this, or a query of
      // small words ("the": ~150,000 matches) counted for 18 s and disagreed
      // with the grid's own fallback total. A failed count shows the grid's.
    ], { ...OPTS, maxTimeMS: 8000 }).toArray();
    return { plates: readFacets(r[0]), artworks: EMPTY };
  }

  const filter = {
    ...galleryFilter({ bookId: bookId || undefined, bookIds: bookIds || undefined, minQuality, maxPerBook }, { tenantId: ctx.tenantId }),
    ...narrowingMatch(narrowing, { iconclass: true }),
  };
  const r = await gi.aggregate([{ $match: filter }, plateStages], OPTS).toArray();
  return { plates: readFacets(r[0]), artworks: EMPTY };
}

export async function computeGalleryStats(db: Db, sp: URLSearchParams, ctx: GalleryStatsContext): Promise<GalleryStats> {
  const hasYears = sp.has('yearStart') || sp.has('yearEnd');
  const unYeared = new URLSearchParams(sp);
  unYeared.delete('yearStart');
  unYeared.delete('yearEnd');
  const [main, span] = await Promise.all([
    setFacets(db, sp, ctx, true),
    hasYears ? setFacets(db, unYeared, ctx, false) : Promise.resolve(null),
  ]);
  const when = span ?? main;

  const kinds = new Map(main.plates.kinds);
  for (const [k, n] of main.artworks.kinds) kinds.set(k, (kinds.get(k) || 0) + n);
  const firsts = [when.plates.first, when.artworks.first].filter((y): y is number => y != null);
  const lasts = [when.plates.last, when.artworks.last].filter((y): y is number => y != null);

  return {
    total: main.plates.total + main.artworks.total,
    plates: main.plates.total,
    books: main.plates.books,
    artworks: main.artworks.total,
    printed: PRINTED_BUCKETS.map(([from, to]) => {
      const key = from ?? -100_000;
      return { from, to, count: (when.plates.buckets.get(key) || 0) + (when.artworks.buckets.get(key) || 0) };
    }),
    yearFirst: firsts.length ? Math.min(...firsts) : null,
    yearLast: lasts.length ? Math.max(...lasts) : null,
    kinds: [...kinds].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
  };
}

/** The parameters that change the counted set, in a stable order: the cache key. */
export const GALLERY_STATS_PARAMS = [
  'q', 'topic', 'subject', 'figure', 'symbol', 'iconclass', 'type', 'library', 'collection', 'bookId', 'book',
  'yearStart', 'yearEnd', 'minQuality', 'includeArchive', 'maxPerBook', 'source',
] as const;

export function galleryStatsKey(sp: URLSearchParams): string {
  return GALLERY_STATS_PARAMS.map((k) => `${k}=${sp.get(k) ?? ''}`).join('&');
}
