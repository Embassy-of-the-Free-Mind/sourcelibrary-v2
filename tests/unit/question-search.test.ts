import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Three translated pages from two books, one untranslated page, and lanes that
// return them. The Jev call is the global fetch, swapped per test.
const BOOKS = [
  { id: 'b1', slug: 'book-one', title: 'Book One', author: 'A', year: 1600, language: 'Latin' },
  { id: 'b2', slug: 'book-two', title: 'Book Two', author: 'B', year: 1700, language: 'German' },
];
const long = (s: string) => `${s} `.repeat(60);
const PAGES = [
  { book_id: 'b1', page_number: 1, translation: { data: long('page one') } },
  { book_id: 'b1', page_number: 2, translation: { data: long('page two') } },
  { book_id: 'b2', page_number: 3, translation: { data: long('page three') } },
  { book_id: 'b2', page_number: 4, ocr: { data: long('pagina quattuor') } },
];

vi.mock('@/lib/mongodb', () => ({
  getDb: async () => ({
    collection: (name: string) => ({
      aggregate: () => ({ toArray: async () => [{ book_id: 'b1', page_number: 2 }, { book_id: 'b2', page_number: 4 }] }),
      find: () => ({ toArray: async () => (name === 'books' ? BOOKS : PAGES) }),
    }),
  }),
}));
vi.mock('@/lib/semantic-search', () => ({
  semanticPageSearchGlobal: async () => [{ book_id: 'b1', page_number: 1 }, { book_id: 'b2', page_number: 3 }],
  semanticPageSearchUntranslated: async () => ({ rows: [], state: 'ok' }),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimitShared: async () => ({ allowed: true }) }));
vi.mock('@/lib/log-ai-usage', () => ({ logAiUsage: () => {} }));

import { questionSearch, keywordQuery } from '@/lib/search/question-search';

const jevReply = (w1: number, w2: number) => new Response(JSON.stringify({ answers: { w1: { noul: w1 }, w2: { noul: w2 } }, provider_metadata: { gateway: { marketCost: '0.00004' } } }), { status: 200 });

describe('questionSearch', () => {
  beforeEach(() => { process.env.VERCEL_OIDC_TOKEN = 'test-token'; });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.VERCEL_OIDC_TOKEN; });

  it('ranks translated pages by the Jev score and keeps untranslated pages apart', async () => {
    // Page three scores highest, page one lowest.
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      const state = JSON.parse(String(init.body)).state as string;
      return state.includes('page three') ? jevReply(0.9, 0.1) : state.includes('page two') ? jevReply(0.6, 0.4) : jevReply(0.2, 0.8);
    }));
    const r = await questionSearch('a passage where someone describes leaving their body');
    expect(r.reranked).toBe(true);
    expect(r.note).toBeUndefined();
    expect(r.passages.map(p => p.page_number)).toEqual([3, 2, 1]);
    expect(r.passages[0].score).toBeCloseTo(0.9);
    expect(r.untranslated.map(p => p.page_number)).toEqual([4]);
    expect(r.costUsd).toBeCloseTo(0.00012);
  });

  it('returns the un-reranked list with a note when Jev refuses the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 401 })));
    const r = await questionSearch('a passage where someone describes leaving their body');
    expect(r.reranked).toBe(false);
    expect(r.note).toMatch(/refused its credentials/);
    expect(r.passages.length).toBe(3);
    expect(r.passages.every(p => p.score === undefined)).toBe(true);
  });

  it('returns the un-reranked list with a note when there is no token', async () => {
    delete process.env.VERCEL_OIDC_TOKEN;
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const r = await questionSearch('a passage where someone describes leaving their body');
    expect(fetch).not.toHaveBeenCalled();
    expect(r.reranked).toBe(false);
    expect(r.note).toMatch(/not configured/);
    expect(r.passages.length).toBe(3);
  });
});

describe('keywordQuery', () => {
  it('drops function words but keeps a quoted phrase whole', () => {
    expect(keywordQuery('instructions for preparing a talisman at a particular hour of the planets'))
      .toBe('instructions preparing talisman particular hour planets');
    expect(keywordQuery('"the philosophers stone"')).toBe('"the philosophers stone"');
    expect(keywordQuery('the of')).toBe('the of');
  });
});
