/**
 * Gallery sort orders — one definition shared by /api/gallery and the merged
 * default browse (gallery-merge.ts), so a sort means the same thing everywhere.
 *
 * PRIOR ART: none — looked in src/lib/gallery-scope.ts (filters only, no order),
 * src/lib/gallery-merge.ts (one hard-coded quality sort) and the route's own
 * inline sortOrder; nothing modelled more than one order or null placement.
 *
 * Some orders are SEGMENTED: a Mongo sort can't put nulls last, so "oldest
 * first" would open on ~1,500 undated plates. Each segment is its own indexed
 * query and pagination walks them in order, using memoized per-segment counts
 * to map a global offset onto (segment, skip).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// No static import of gallery-merge: this module is also imported by the
// client (GalleryClient reads RANDOM_SEEDS), and gallery-merge pulls in Node's
// crypto. findSorted loads it on the server only, when it needs the memo.

export const GALLERY_SORTS = ['quality', 'oldest', 'newest', 'book', 'recent', 'random'] as const;
export type GallerySort = (typeof GALLERY_SORTS)[number];

/** Number of distinct shuffles. Few enough that the CDN shares each one across readers. */
export const RANDOM_SEEDS = 64;

export function parseGallerySort(v: string | null | undefined): GallerySort {
  return (GALLERY_SORTS as readonly string[]).includes(v ?? '') ? (v as GallerySort) : 'quality';
}

export function parseSeed(v: string | null | undefined): number {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) ? ((n % RANDOM_SEEDS) + RANDOM_SEEDS) % RANDOM_SEEDS : 0;
}

/** Seed → 2-hex-char dhash start point, spread evenly over 00..fc. */
export function seedToDhashStart(seed: number): string {
  return ((seed * 256) / RANDOM_SEEDS).toString(16).padStart(2, '0');
}

interface Segment { filter: Record<string, unknown>; sort: Record<string, 1 | -1> }

// Every order ends in a unique-enough tail so offset pagination is stable.
const QUALITY = { gallery_quality: -1, book_rank: 1, book_year: 1, book_id: 1, page_number: 1 } as const;

/**
 * The segments for a sort. Each non-null segment's sort is backed by an index
 * on gallery_images (see the PR / scripts that create them); null segments are
 * small (undated ~1.5k, unfingerprinted plates) and sorted in memory.
 */
export function gallerySegments(sort: GallerySort, seed = 0): Segment[] {
  switch (sort) {
    case 'oldest':
      // Within a year, book_rank first spreads books out (every book's best
      // plate from 1550 before any book's second), as the quality order does.
      return [
        { filter: { book_year: { $ne: null } }, sort: { book_year: 1, book_rank: 1, book_id: 1, page_number: 1 } },
        { filter: { book_year: null }, sort: { book_rank: 1, book_id: 1, page_number: 1 } },
      ];
    case 'newest':
      // Descending already puts null last in Mongo's order.
      return [{ filter: {}, sort: { book_year: -1, book_rank: 1, book_id: 1, page_number: 1 } }];
    case 'book':
      // Flip through each book in page order; books oldest first.
      return [
        { filter: { book_year: { $ne: null } }, sort: { book_year: 1, book_id: 1, page_number: 1, detection_index: 1 } },
        { filter: { book_year: null }, sort: { book_id: 1, page_number: 1, detection_index: 1 } },
      ];
    case 'recent':
      // book ids are Mongo ObjectIds whose first 4 bytes are the import time,
      // so book_id descending = most recently imported book first. gallery_images
      // has no "added" date of its own (updated_at is rewritten by sweeps).
      // ~1% of books carry UUID ids with no time in them; they land arbitrarily.
      return [{ filter: {}, sort: { book_id: -1, page_number: 1, detection_index: 1 } }];
    case 'random': {
      // A stable shuffle: walk the perceptual hash from a seeded start point and
      // wrap. dhash is uncorrelated with book, year and type (measured: a
      // 48-plate page spans 43 books, 7 types, 1350-1950). Rows without a
      // dhash come last. `$lt` on a string never matches null, so the three
      // segments are disjoint.
      const start = seedToDhashStart(seed);
      return [
        { filter: { dhash: { $gte: start } }, sort: { dhash: 1, id: 1 } },
        { filter: { dhash: { $lt: start } }, sort: { dhash: 1, id: 1 } },
        { filter: { dhash: null }, sort: { book_rank: 1, book_id: 1, page_number: 1 } },
      ];
    }
    case 'quality':
    default:
      return [{ filter: {}, sort: { ...QUALITY } }];
  }
}

/**
 * The single-stage sort a SEARCH pipeline uses when the reader picks an order
 * other than relevance. Search results are small, so null placement is not
 * segmented here; random falls back to relevance (null).
 */
export function searchSortStage(sort: GallerySort): Record<string, 1 | -1> | null {
  switch (sort) {
    case 'oldest': return { book_year: 1, book_rank: 1, book_id: 1, page_number: 1 };
    case 'newest': return { book_year: -1, book_rank: 1, book_id: 1, page_number: 1 };
    case 'book': return { book_year: 1, book_id: 1, page_number: 1, detection_index: 1 };
    case 'recent': return { book_id: -1, page_number: 1, detection_index: 1 };
    default: return null; // quality → relevance for a search; random → relevance
  }
}

interface FindableCollection {
  find(filter: Record<string, unknown>, opts?: Record<string, unknown>): {
    sort(s: Record<string, 1 | -1>): { skip(n: number): { limit(n: number): { toArray(): Promise<any[]> } } };
  };
  countDocuments(filter: Record<string, unknown>, opts?: Record<string, unknown>): Promise<number>;
}

/**
 * Fetch `limit` rows at global `skip` across a sort's segments.
 * A failed segment count THROWS (the route answers 500, uncached) rather than
 * guessing, because a wrong count would silently skip or repeat rows.
 */
export async function findSorted(
  coll: FindableCollection,
  baseFilter: Record<string, unknown>,
  sort: GallerySort,
  seed: number,
  skip: number,
  limit: number,
  projection: Record<string, unknown> = { _id: 0 },
): Promise<any[]> {
  const segments = gallerySegments(sort, seed);
  const withSeg = (s: Segment) => (Object.keys(s.filter).length ? { $and: [baseFilter, s.filter] } : baseFilter);

  if (segments.length === 1) {
    return coll.find(withSeg(segments[0]), { projection }).sort(segments[0].sort).skip(skip).limit(limit).toArray();
  }

  const { galleryMemo, filterKey } = await import('@/lib/gallery-merge');
  const out: any[] = [];
  let remainingSkip = skip;
  for (const seg of segments) {
    if (out.length >= limit) break;
    const f = withSeg(seg);
    const n = await galleryMemo(filterKey('seg-count', f), () => coll.countDocuments(f, { maxTimeMS: 8000 }));
    if (remainingSkip >= n) { remainingSkip -= n; continue; }
    const rows = await coll.find(f, { projection }).sort(seg.sort).skip(remainingSkip).limit(limit - out.length).toArray();
    out.push(...rows);
    remainingSkip = 0;
  }
  return out;
}

/** Artwork order in the merged browse, matching the plate order's intent. */
export function artworkSort(sort: GallerySort): Record<string, 1 | -1> {
  switch (sort) {
    case 'newest': return { year: -1, title: 1 };
    case 'recent': return { created_at: -1, title: 1 };
    case 'random': return { title: 1 }; // rotated by seed, see artworkRotation
    default: return { year: 1, title: 1 };
  }
}

/** For 'random', where in the (title-ordered) artwork list this seed starts. */
export function artworkRotation(sort: GallerySort, seed: number, total: number): number {
  if (sort !== 'random' || total <= 0) return 0;
  return Math.floor((seed / RANDOM_SEEDS) * total);
}
