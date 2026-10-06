import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level guard for #5905. Runs the real /api/search handler over a fake
// corpus, so it fails if the roll-up is unwired, if passages are dropped again
// when title matches fill the window, or if the evidence rung is removed.

const state = vi.hoisted(() => ({
  bookLaneIds: [] as string[],
  aggregates: [] as any[][],
  logged: [] as any[],
}));

/** 25 title-matching books (b0…b24), and 4 books that only print the name on their pages. */
const BOOKS = [
  ...Array.from({ length: 25 }, (_, i) => ({
    id: `b${i}`, title: `Drebbel treatise ${i}`, author: 'Drebbel', language: 'Latin',
    published: String(1600 + i), pages_count: 100, visible: true,
  })),
  { id: 'old-mention', title: 'An old miscellany', author: 'Anon', language: 'Latin', published: '1650', pages_count: 300, visible: true },
  { id: 'study', title: 'Oud Holland 1904', author: 'Various', language: 'Dutch', published: '1904', pages_count: 400, visible: true },
  { id: 'letters', title: 'Collected letters', author: 'Huygens', language: 'French', published: '1700', pages_count: 500, visible: true },
  { id: 'hidden-one', title: 'Suppressed', author: 'Anon', language: 'Latin', published: '1600', pages_count: 50, visible: true, hidden: true },
];
const page = (book_id: string, n: number) => ({
  id: `${book_id}:${n}`, book_id, page_number: n,
  translation: { data: `… Cornelis Drebbel of Alkmaar, page ${n} …` }, ocr: { data: '' },
});

function cursor(rows: any[]) {
  let n = Infinity;
  const c: any = {
    project: () => c, maxTimeMS: () => c,
    limit: (k: number) => { n = k; return c; },
    toArray: async () => rows.slice(0, n),
  };
  return c;
}
const db = {
  collection: (name: string) => name === 'books'
    ? { find: (filter: any) => cursor(BOOKS.filter(b => filter.id.$in.includes(b.id) && !(filter.hidden?.$ne === true && (b as any).hidden))) }
    : {
        find: () => cursor([]),
        aggregate: (pipeline: any[]) => {
          state.aggregates.push(pipeline);
          const first = pipeline[0];
          if (first.$searchMeta) {
            // Pages printing the name, per book. `study` has the most by far.
            return cursor([{ facet: { book: { buckets: [
              { _id: 'study', count: 51 }, { _id: 'hidden-one', count: 30 },
              { _id: 'letters', count: 6 }, { _id: 'old-mention', count: 1 },
            ] } } }]);
          }
          const one = first.$search.compound.filter?.find((f: any) => f.equals?.path === 'book_id');
          if (one) return cursor([page(one.equals.value, 272)]);
          // The lane's own best pages: all in ONE book, the passing mention.
          return cursor([page('old-mention', 12)]);
        },
      },
};

vi.mock('@/lib/api-auth', () => ({ withApiAuth: (h: any) => (req: any, ctx: any) => h(req, ctx, null) }));
vi.mock('@/lib/mongodb', () => ({ getReadDb: async () => db, getDb: async () => db }));
vi.mock('@/lib/books-catalog', () => ({ searchBookIds: async () => state.bookLaneIds }));
vi.mock('@/lib/semantic-search', () => ({
  semanticBookSearch: async () => [],
  semanticPageSearchGlobal: async () => [],
  lexicalPageSearchLang: async () => [],
}));
vi.mock('@/lib/search/work-fanout', () => ({ fetchWorkFanouts: async () => new Map() }));
vi.mock('@/lib/search-log', () => ({ logSearchQuery: (x: any) => { state.logged.push(x); } }));
vi.mock('@/lib/search-event-log', () => ({ logSearchEvent: () => {} }));

async function search(params: string) {
  const { GET } = await import('@/app/api/search/route');
  const res = await (GET as any)(new NextRequest(`http://localhost/api/search?${params}`), { params: Promise.resolve({}) });
  return res.json();
}
const rollupQueries = () => state.aggregates.filter(p => p[0].$searchMeta).length;

beforeEach(() => {
  state.bookLaneIds = [];
  state.aggregates = [];
  state.logged = [];
});

describe('/api/search page-lane roll-up (#5905)', () => {
  it('adds the books that print the name on the most pages, each with a passage', async () => {
    const body = await search('q=Drebbel');
    const passages = body.results.filter((r: any) => r.type === 'page');
    // The lane's 25 best pages named one book; the roll-up reaches the others.
    expect(passages.map((r: any) => r.book_id).sort()).toEqual(['letters', 'old-mention', 'study']);
    expect(passages.find((r: any) => r.book_id === 'study')).toMatchObject({ page_number: 272 });
    expect(passages.find((r: any) => r.book_id === 'study').snippet).toContain('Drebbel');
  });

  it('orders passages by how many pages of the book print the name, not by age', async () => {
    const body = await search('q=Drebbel');
    // old-mention is the oldest (1650) and Latin; before the evidence rung it led.
    expect(body.results.map((r: any) => r.book_id)).toEqual(['study', 'letters', 'old-mention']);
  });

  it('does not add a hidden book, however many pages match', async () => {
    const body = await search('q=Drebbel');
    expect(body.results.some((r: any) => r.book_id === 'hidden-one')).toBe(false);
  });

  it('keeps passages when title matches fill the window', async () => {
    state.bookLaneIds = BOOKS.slice(0, 25).map(b => b.id);
    const body = await search('q=Drebbel&limit=20');
    // 20 book rows used to switch the page lane's results off entirely.
    expect(body.total).toBe(23);
    expect(body.results.every((r: any) => r.type === 'book')).toBe(true); // books still lead
    const next = await search('q=Drebbel&limit=20&offset=20');
    expect(next.results.map((r: any) => r.book_id)).toEqual(['study', 'letters', 'old-mention']);
  });

  it('does not leak its ranking transient into the response', async () => {
    const body = await search('q=Drebbel');
    for (const r of body.results) expect(Object.keys(r).filter(k => k.startsWith('_'))).toEqual([]);
  });

  it('leaves pages_only (the MCP passage contract) and book_id searches alone', async () => {
    const pagesOnly = await search('q=Drebbel&pages_only=true');
    expect(rollupQueries()).toBe(0);
    expect(pagesOnly.results.map((r: any) => r.book_id)).toEqual(['old-mention']);
    await search('q=Drebbel&book_id=study');
    expect(rollupQueries()).toBe(0);
  });

  it('abstains for a query it cannot count, and still returns the lane\'s pages', async () => {
    const body = await search(`q=${encodeURIComponent('of the')}`);
    expect(rollupQueries()).toBe(0);
    expect(body.results.map((r: any) => r.book_id)).toEqual(['old-mention']);
  });

  it('logs which lanes degraded, so the rate can be counted', async () => {
    await search('q=Drebbel');
    expect(state.logged.at(-1).degraded_lanes).toEqual([]);
  });
});
