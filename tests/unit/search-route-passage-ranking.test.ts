import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level guard for #3700. Runs the real /api/search handler over a fake
// corpus whose Atlas order is WRONG in the way the issue measured: the pages
// that scatter the query's words score highest, and the page that prints the
// sentence sits below them. Fails if the passage search stops reading a pool,
// stops re-ordering it, or stops saying how good each hit is.

const QUERY = 'to educate the mind without educating the heart';
const filler = (n: number) => Array.from({ length: n }, (_, i) => `filler${i}`).join(' ');

const state = vi.hoisted(() => ({ limits: [] as number[], semantic: [] as any[] }));

const BOOKS = [
  // Its TITLE carries two query words: under the book ladder its page led.
  { id: 'titled', title: 'How to educate the mind', author: 'A', language: 'English', published: '1900', pages_count: 100, visible: true },
  { id: 'scattered', title: 'Essays', author: 'B', language: 'English', published: '1850', pages_count: 100, visible: true },
  // A classified translation: the book search demotes these, the passage search must not.
  { id: 'verbatim', title: 'Sayings', author: 'C', language: 'English', published: '1910', pages_count: 100, visible: true, text_role: 'modern-translation' },
  { id: 'meaning', title: 'On schooling', author: 'D', language: 'English', published: '1890', pages_count: 100, visible: true },
];
/** In Atlas's order, best first. */
const PAGES = [
  { id: 'p1', book_id: 'titled', page_number: 5, searchScore: 40,
    translation: { data: `We educate the young. ${filler(60)} The mind is a mirror. ${filler(60)} The heart knows.` }, ocr: { data: '' } },
  { id: 'p2', book_id: 'scattered', page_number: 9, searchScore: 38,
    translation: { data: `Educating a child takes years. ${filler(80)} Without rest the mind tires and the heart sinks.` }, ocr: { data: '' } },
  { id: 'p3', book_id: 'verbatim', page_number: 77, searchScore: 30,
    translation: { data: `<meta>to educate the mind without educating the heart</meta>${filler(70)} He said that to educate the mind without educating the heart is no education at all. ${filler(70)}` }, ocr: { data: '' } },
];

function cursor(rows: any[]) {
  let n = Infinity;
  const c: any = { project: () => c, maxTimeMS: () => c, limit: (k: number) => { n = k; return c; }, toArray: async () => rows.slice(0, n) };
  return c;
}
const db = {
  collection: (name: string) => name === 'books'
    ? { find: (filter: any) => cursor(BOOKS.filter(b => filter.id.$in.includes(b.id))) }
    : {
        find: () => cursor([]),
        aggregate: (pipeline: any[]) => {
          state.limits.push(pipeline.find((s: any) => s.$limit !== undefined).$limit);
          return cursor(PAGES);
        },
      },
};

vi.mock('@/lib/api-auth', () => ({ withApiAuth: (h: any) => (req: any, ctx: any) => h(req, ctx, null) }));
vi.mock('@/lib/mongodb', () => ({ getReadDb: async () => db, getDb: async () => db }));
vi.mock('@/lib/books-catalog', () => ({ searchBookIds: async () => [] }));
vi.mock('@/lib/semantic-search', () => ({
  semanticBookSearch: async () => [],
  semanticPageSearchGlobal: async () => state.semantic,
  semanticPageSearchUntranslated: async () => ({ rows: [], state: 'off' }),
  getQueryEmbedding: async () => null,
  lexicalPageSearchLang: async () => [],
}));
vi.mock('@/lib/search/work-fanout', () => ({ fetchWorkFanouts: async () => new Map() }));
vi.mock('@/lib/search-log', () => ({ logSearchQuery: () => {} }));
vi.mock('@/lib/search-event-log', () => ({ logSearchEvent: () => {} }));
vi.mock('@/lib/search/canon-texts', () => ({ searchCanonTexts: async () => [] }));

async function search(params: string) {
  const { GET } = await import('@/app/api/search/route');
  const res = await (GET as any)(new NextRequest(`http://localhost/api/search?${params}`), { params: Promise.resolve({}) });
  return res.json();
}
const q = encodeURIComponent(QUERY);

beforeEach(() => { state.limits = []; state.semantic = []; });

describe('/api/search passage ranking (pages_only, #3700)', () => {
  it('puts the page that prints the sentence above pages that scatter its words', async () => {
    const body = await search(`q=${q}&pages_only=true&limit=10`);
    expect(body.results.map((r: any) => r.book_id)).toEqual(['verbatim', 'titled', 'scattered']);
  });

  it('says how much of the query each page prints together, on an absolute scale', async () => {
    const body = await search(`q=${q}&pages_only=true&limit=10`);
    const by = Object.fromEntries(body.results.map((r: any) => [r.book_id, r.phrase_match]));
    expect(by.verbatim).toBe(1);
    // Not normalised to the best result: with the verbatim page gone, the
    // scattered pages still score near zero rather than being stretched to 1.
    expect(by.titled).toBeLessThan(0.2);
    expect(by.scattered).toBeLessThan(0.2);
  });

  it('cuts the snippet at the sentence, and never from an editorial wrapper', async () => {
    const body = await search(`q=${q}&pages_only=true&limit=10`);
    const hit = body.results.find((r: any) => r.book_id === 'verbatim');
    expect(hit.snippet).toContain('He said that to educate the mind without educating the heart is no education');
    expect(hit.snippet).not.toContain('<meta>');
    expect(hit.snippet.startsWith('...')).toBe(true);
  });

  it('reads a pool larger than the page asked for, and deeper for a later page', async () => {
    await search(`q=${q}&pages_only=true&limit=10`);
    expect(state.limits[0]).toBe(150);
    state.limits = [];
    await search(`q=${q}&pages_only=true&limit=50&offset=150`);
    expect(state.limits[0]).toBe(200);
  });

  it('names the lane that found each passage', async () => {
    state.semantic = [
      { page_id: 'p3', book_id: 'verbatim', page_number: 77, snippet: 's', similarity: 0.8, book_title: 'Sayings' },
      { page_id: 'm1', book_id: 'meaning', page_number: 3, snippet: 'Schooling without kindness is hollow.', similarity: 0.7, book_title: 'On schooling' },
    ];
    const body = await search(`q=${q}&pages_only=true&limit=10`);
    const by = Object.fromEntries(body.results.map((r: any) => [r.book_id, r]));
    expect(by.verbatim.found_by).toBe('both');
    expect(by.titled.found_by).toBe('keyword');
    expect(by.meaning.found_by).toBe('semantic');
    expect(by.meaning.phrase_match).toBeUndefined();
    expect(body.results[0].book_id).toBe('verbatim');
  });

  it('ranks a two-word passage search by the passage, not by the book title', async () => {
    // One book has "the" and a near-match in its TITLE; the book ladder put its page first.
    const body = await search(`q=${encodeURIComponent('educating the')}&pages_only=true`);
    expect(body.ranking).toMatch(/^auto-rrf/);
    expect(body.results[0].book_id).toBe('verbatim');
  });

  it('leaves the site search (no pages_only) exactly as it was', async () => {
    const body = await search(`q=${q}`);
    expect(state.limits[0]).toBe(25);
    for (const r of body.results) {
      expect(r.phrase_match).toBeUndefined();
      expect(r.found_by).toBeUndefined();
    }
    // Atlas's own order.
    expect(body.results.filter((r: any) => r.type === 'page').map((r: any) => r.book_id)).toEqual(['titled', 'scattered', 'verbatim']);
  });

  it('does not leak a ranking transient into the response', async () => {
    const body = await search(`q=${q}&pages_only=true`);
    for (const r of body.results) expect(Object.keys(r).filter(k => k.startsWith('_'))).toEqual([]);
  });
});
