import { describe, it, expect } from 'vitest';
import {
  GALLERY_SORTS, RANDOM_SEEDS, parseGallerySort, parseSeed, seedToDhashStart,
  gallerySegments, findSorted, searchSortStage, artworkRotation, type GallerySort,
} from '@/lib/gallery-sort';

// ---- in-memory collection that really filters, sorts, skips ----------------
type Row = Record<string, any>;

function matches(row: Row, f: Record<string, any>): boolean {
  return Object.entries(f).every(([k, cond]) => {
    if (k === '$and') return (cond as Record<string, any>[]).every(c => matches(row, c));
    const v = row[k];
    if (cond === null) return v === null || v === undefined;
    if (typeof cond === 'object') {
      return Object.entries(cond).every(([op, x]) => {
        if (op === '$ne') return x === null ? v !== null && v !== undefined : v !== x;
        // Mongo type bracketing: a string comparison never matches null/missing.
        if (v === null || v === undefined) return false;
        if (op === '$gte') return v >= (x as any);
        if (op === '$lt') return v < (x as any);
        throw new Error(`op ${op}`);
      });
    }
    return v === cond;
  });
}

function cmp(a: Row, b: Row, sort: Record<string, 1 | -1>): number {
  for (const [k, dir] of Object.entries(sort)) {
    const x = a[k] ?? null, y = b[k] ?? null;
    if (x === y) continue;
    // Mongo: null sorts before any number/string ascending.
    if (x === null) return -dir;
    if (y === null) return dir;
    return x < y ? -dir : dir;
  }
  return 0;
}

function fakeCollection(rows: Row[]) {
  let counts = 0;
  return {
    get counts() { return counts; },
    countDocuments: async (f: Record<string, any>) => { counts++; return rows.filter(r => matches(r, f)).length; },
    find: (f: Record<string, any>) => ({
      sort: (s: Record<string, 1 | -1>) => ({
        skip: (n: number) => ({
          limit: (m: number) => ({
            toArray: async () => rows.filter(r => matches(r, f)).sort((a, b) => cmp(a, b, s)).slice(n, n + m),
          }),
        }),
      }),
    }),
  };
}

// 90 rows: 3 books, some undated, some without a dhash.
const rows: Row[] = Array.from({ length: 90 }, (_, i) => ({
  id: `img-${String(i).padStart(3, '0')}`,
  book_id: `b${i % 3}`,
  book_year: i % 10 === 0 ? null : 1500 + (i % 3) * 20, // one year per book, like real data
  book_rank: Math.floor(i / 3) + 1,
  page_number: i,
  detection_index: 0,
  gallery_quality: [1, 0.95, 0.85][i % 3],
  dhash: i % 9 === 0 ? null : ((i * 2654435761) % 2 ** 32).toString(16).padStart(8, '0'),
}));

async function pageThrough(sort: GallerySort, seed: number, pageSize: number) {
  const coll = fakeCollection(rows);
  const seen: Row[] = [];
  for (let skip = 0; skip < rows.length + pageSize; skip += pageSize) {
    const page = await findSorted(coll as any, {}, sort, seed, skip, pageSize);
    if (page.length === 0) break;
    seen.push(...page);
  }
  return seen;
}

describe('findSorted pagination', () => {
  // The contract that matters most: paging never skips or repeats an image,
  // including across segment boundaries (dated → undated, hashed → unhashed).
  for (const sort of GALLERY_SORTS) {
    for (const pageSize of [7, 24]) {
      it(`${sort}: every image exactly once (page size ${pageSize})`, async () => {
        const seen = await pageThrough(sort, 37, pageSize);
        const ids = seen.map(r => r.id);
        expect(ids.length).toBe(rows.length);
        expect(new Set(ids).size).toBe(rows.length);
      });
    }
  }

  it('oldest: undated images come last, dated ones ascending', async () => {
    const seen = await pageThrough('oldest', 0, 24);
    const firstUndated = seen.findIndex(r => r.book_year === null);
    expect(firstUndated).toBe(seen.filter(r => r.book_year !== null).length);
    const years = seen.slice(0, firstUndated).map(r => r.book_year);
    expect(years).toEqual([...years].sort((a, b) => a - b));
  });

  it('book: each book reads in page order', async () => {
    const seen = await pageThrough('book', 0, 24);
    for (const b of ['b0', 'b1', 'b2']) {
      const pages = seen.filter(r => r.book_id === b && r.book_year !== null).map(r => r.page_number);
      // within a year, a book's pages are consecutive and ascending
      expect(pages).toEqual([...pages].sort((a, b2) => a - b2));
    }
  });

  it('random: different seeds start in different places; same seed is stable', async () => {
    const a = (await pageThrough('random', 5, 24)).map(r => r.id);
    const b = (await pageThrough('random', 50, 24)).map(r => r.id);
    const a2 = (await pageThrough('random', 5, 24)).map(r => r.id);
    expect(a).toEqual(a2);
    expect(a.slice(0, 10)).not.toEqual(b.slice(0, 10));
    // unhashed rows come after every hashed one
    const firstNull = a.findIndex(id => rows.find(r => r.id === id)!.dhash === null);
    expect(firstNull).toBe(rows.filter(r => r.dhash !== null).length);
  });

  it('single-segment sorts do not count', async () => {
    const coll = fakeCollection(rows);
    await findSorted(coll as any, {}, 'quality', 0, 48, 24);
    expect(coll.counts).toBe(0);
  });
});

describe('sort parsing', () => {
  it('falls back to quality for unknown or missing values', () => {
    expect(parseGallerySort(null)).toBe('quality');
    expect(parseGallerySort('popular')).toBe('quality');
    expect(parseGallerySort('oldest')).toBe('oldest');
  });

  it('clamps seeds into range', () => {
    expect(parseSeed('7')).toBe(7);
    expect(parseSeed(String(RANDOM_SEEDS + 3))).toBe(3);
    expect(parseSeed('-1')).toBe(RANDOM_SEEDS - 1);
    expect(parseSeed('x')).toBe(0);
  });

  it('spreads seed start points over the whole hash space', () => {
    expect(seedToDhashStart(0)).toBe('00');
    expect(seedToDhashStart(RANDOM_SEEDS - 1)).toBe('fc');
    const starts = new Set(Array.from({ length: RANDOM_SEEDS }, (_, s) => seedToDhashStart(s)));
    expect(starts.size).toBe(RANDOM_SEEDS);
  });

  it('search keeps relevance for the default and for random', () => {
    expect(searchSortStage('quality')).toBeNull();
    expect(searchSortStage('random')).toBeNull();
    expect(searchSortStage('oldest')).toMatchObject({ book_year: 1 });
  });

  it('random segments are disjoint and cover null dhash last', () => {
    const segs = gallerySegments('random', 10);
    expect(segs).toHaveLength(3);
    expect(segs[2].filter).toEqual({ dhash: null });
  });

  it('artwork rotation only applies to random', () => {
    expect(artworkRotation('quality', 30, 1000)).toBe(0);
    expect(artworkRotation('random', 32, 1000)).toBe(500);
    expect(artworkRotation('random', 5, 0)).toBe(0);
  });
});
