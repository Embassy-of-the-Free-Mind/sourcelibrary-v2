import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level guard for #3699. Runs the real /api/books/[id]/search handler
// over a fake book. `score` used to be normalised against the book's own best
// hit, so a query the book cannot answer scored 1.0 on its nearest neighbour,
// exactly as the page that prints the sentence did. Fails if score goes back
// to being relative, or if the list stops being ordered within the book.

const BOOK = 'taylor';
const SENTENCE = 'the whole is not merely a heap but something besides its parts';
const NONSENSE = 'zebra pancake velocipede submarine trombone';
const filler = (n: number) => Array.from({ length: n }, (_, i) => `filler${i}`).join(' ');

const state = vi.hoisted(() => ({ keyword: [] as any[], semantic: [] as any[] }));

const P264 = {
  id: 'p264', page_number: 264, searchScore: 12,
  translation: { data: `${filler(40)} For of all such things as have many parts, and where the whole is not merely a heap, but is something beyond the parts, there is a cause. ${filler(40)}` },
  ocr: { data: '' }, highlights: [{ path: 'translation.data', texts: [{ type: 'hit', value: 'heap' }] }],
};
const P202 = {
  id: 'p202', page_number: 202, searchScore: 30,
  translation: { data: `"Part" is denominated in one way. ${filler(50)} The whole is said of that. ${filler(50)} Its parts are not besides it.` },
  ocr: { data: '' }, highlights: [{ path: 'translation.data', texts: [{ type: 'hit', value: 'parts' }] }],
};

/** The rest of Atlas's pool: pages printing a word or two of the query, as most of a 400-page pool does. */
const POOL = Array.from({ length: 40 }, (_, i) => ({
  id: `f${i}`, page_number: 300 + i, searchScore: 5,
  translation: { data: `${filler(30)} the whole of it is not ${filler(30)}` },
  ocr: { data: '' }, highlights: [{ path: 'translation.data', texts: [{ type: 'hit', value: 'whole' }] }],
}));

function cursor(rows: any[]) {
  const c: any = { project: () => c, limit: () => c, sort: () => c, toArray: async () => rows };
  return c;
}
const db = {
  collection: (name: string) => name === 'books'
    ? { findOne: async () => ({ id: BOOK, visible: true, pages_translated: 500 }) }
    : { aggregate: () => cursor(state.keyword), find: () => cursor([]) },
};

vi.mock('@/lib/mongodb', () => ({ getDb: async () => db }));
vi.mock('@/lib/atlas-search', () => ({ buildPageSearchStage: () => ({ $search: {} }), NON_CONTENT_PAGE_TYPES: [] }));
vi.mock('@/lib/search/name-variants', () => ({ expandPersonNames: async () => [] }));
vi.mock('@/lib/semantic-search', () => ({
  semanticPageSearchScoped: async () => state.semantic,
  lexicalPageSearchLang: async () => [],
}));
vi.mock('@/lib/tenant-context', () => ({ getTenantContextFromRequest: () => ({}) }));
vi.mock('@/lib/book-access', () => ({ isBookReadable: async () => true }));
vi.mock('@/lib/search-event-log', () => ({ logSearchEvent: () => {} }));
vi.mock('@/lib/semantic-coverage', () => ({ semanticCoverage: async () => ({ status: 'full' }) }));

async function search(q: string) {
  const { GET } = await import('@/app/api/books/[id]/search/route');
  const res = await GET(new NextRequest(`http://localhost/api/books/${BOOK}/search?q=${encodeURIComponent(q)}`), { params: Promise.resolve({ id: BOOK }) });
  return res.json();
}

const neighbour = (page_number: number, score: number) => ({
  page_id: `s${page_number}`, page_number, score,
  snippet: `A page about animals and principles, nothing to do with the query. ${filler(5)}`,
});

beforeEach(() => { state.keyword = []; state.semantic = []; });

describe('/api/books/[id]/search score is absolute (#3699)', () => {
  it('a query the book cannot answer scores its nearest neighbours by raw cosine, not 1.0', async () => {
    state.semantic = [neighbour(149, 0.52), neighbour(527, 0.51), neighbour(320, 0.49)];
    const body = await search(NONSENSE);
    expect(body.results).toHaveLength(3);
    for (const r of body.results) {
      expect(r.found_by).toBe('semantic');
      expect(r.score).toBe(r.similarity);
      expect(r.phrase_match).toBeUndefined();
    }
    expect(Math.max(...body.results.map((r: any) => r.score))).toBe(0.52);
  });

  it('the page that prints the sentence scores above the nonsense query\'s best', async () => {
    state.keyword = [P202, P264, ...POOL];
    state.semantic = [{ ...neighbour(202, 0.66), page_id: 'p202' }];
    const body = await search(SENTENCE);
    const p264 = body.results.find((r: any) => r.pageNumber === 264);
    expect(p264.found_by).toBe('keyword');
    expect(p264.phrase_match).toBeGreaterThan(0.5);
    expect(p264.score).toBe(p264.phrase_match);
    expect(p264.score).toBeGreaterThan(0.52);
  });

  it('keeps the within-book order, and a both-leg page carries both measures', async () => {
    state.keyword = [P202, P264, ...POOL];
    state.semantic = [{ ...neighbour(202, 0.66), page_id: 'p202' }];
    const body = await search(SENTENCE);
    // Atlas ranked p202 first (30 vs 12); the absolute score does not reorder.
    expect(body.results.slice(0, 2).map((r: any) => r.pageNumber)).toEqual([202, 264]);
    const p202 = body.results[0];
    expect(p202.found_by).toBe('both');
    expect(p202.similarity).toBe(0.66);
    expect(p202.phrase_match).toBeLessThan(0.2);
    expect(p202.score).toBe(0.66);
  });

  it('a one-word query the page prints scores 1', async () => {
    state.keyword = [P264];
    const body = await search('heap');
    expect(body.results[0].score).toBe(1);
    expect(body.results[0].phrase_match).toBeUndefined();
  });
});
