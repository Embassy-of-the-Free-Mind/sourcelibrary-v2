import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  keywordSearchMode, callKeywordLane, recallOf, buildKeywordShadow, synthesizeHighlights, hydrateKeywordRows,
  type KeywordLaneResult,
} from '@/lib/keyword-search';

// The keyword page service beside the Atlas page lane (#6852). What must hold:
//   - off unless URL + TOKEN + MODE are all set: no reader request reaches the service by accident;
//   - the shadow's recall is measured against what readers get today — Atlas's pages of LIVE books,
//     since the route drops hidden books at its join — and a service failure is recorded, not thrown;
//   - serve hydrates from Mongo and drops a page the index still holds but Mongo no longer serves
//     (gone, renumbered to ≤ 0, retyped as non-content, moved book): the read-side check the delta needs.

const SVC = 'http://keywords.test:3460';
function jsonResponse(obj: unknown, status = 200): Response {
  return { ok: status === 200, status, json: async () => obj } as unknown as Response;
}

beforeEach(() => {
  process.env.KEYWORD_SEARCH_URL = SVC;
  process.env.KEYWORD_SEARCH_TOKEN = 'tok';
  delete process.env.KEYWORD_SEARCH_MODE;
});
afterEach(() => {
  delete process.env.KEYWORD_SEARCH_URL; delete process.env.KEYWORD_SEARCH_TOKEN; delete process.env.KEYWORD_SEARCH_MODE;
  vi.restoreAllMocks();
});

describe('keywordSearchMode', () => {
  it('is off without a mode, without a URL or without a token', () => {
    expect(keywordSearchMode()).toBe('off');
    process.env.KEYWORD_SEARCH_MODE = 'shadow';
    expect(keywordSearchMode()).toBe('shadow');
    delete process.env.KEYWORD_SEARCH_TOKEN;
    expect(keywordSearchMode()).toBe('off');
    process.env.KEYWORD_SEARCH_TOKEN = 'tok'; process.env.KEYWORD_SEARCH_MODE = 'serve';
    expect(keywordSearchMode()).toBe('serve');
    process.env.KEYWORD_SEARCH_MODE = 'on';
    expect(keywordSearchMode()).toBe('off');
  });
});

describe('callKeywordLane', () => {
  it('posts the lane in the service names with the Bearer token', async () => {
    const calls: any[] = [];
    global.fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init, body: JSON.parse(String(init.body)) });
      return jsonResponse({ main: [], variants: [], counts: null, extra: [], ms: {} });
    }) as unknown as typeof fetch;
    await callKeywordLane({ query: 'Drebbel', k: 25, variants: ['Drebelius'], topicWords: [], rollup: { terms: ['Drebbel'], buckets: 200, maxBooks: 30 } });
    expect(calls[0].url).toBe(`${SVC}/lane`);
    expect((calls[0].init.headers as any).authorization).toBe('Bearer tok');
    expect(calls[0].body).toMatchObject({ query: 'Drebbel', k: 25, book_ids: null, variants: ['Drebelius'], variant_k: 10, rollup: { terms: ['Drebbel'], buckets: 200, max_books: 30 } });
  });
  it('passes an empty allow-list through as empty (never as "no filter")', async () => {
    let body: any;
    global.fetch = vi.fn(async (_u: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return jsonResponse({ main: [], variants: [], counts: null, extra: [], ms: {} }); }) as unknown as typeof fetch;
    await callKeywordLane({ query: 'x y', k: 25, bookIds: [] });
    expect(body.book_ids).toEqual([]);
  });
  it('throws on a non-200 and on a malformed body', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ error: 'x' }, 500)) as unknown as typeof fetch;
    await expect(callKeywordLane({ query: 'ab', k: 5 })).rejects.toThrow(/HTTP 500/);
    global.fetch = vi.fn(async () => jsonResponse({ rows: [] })) as unknown as typeof fetch;
    await expect(callKeywordLane({ query: 'ab', k: 5 })).rejects.toThrow(/malformed/);
  });
});

describe('recallOf / buildKeywordShadow', () => {
  it('recall is the share of the Atlas list the service returns; null for an empty Atlas list', () => {
    expect(recallOf(['a', 'b', 'c', 'd'], ['b', 'd', 'x'])).toBe(0.5);
    expect(recallOf([], ['x'])).toBeNull();
    expect(recallOf(['a', 'b', 'c'], ['c', 'a'], 2)).toBe(0.5);
  });
  const row = (b: string, n: number, src: 'main' | 'variant' | 'rollup' = 'main') => ({ page_id: `${b}-${n}`, book_id: b, page_number: n, score: 1, src });
  const svc: KeywordLaneResult = {
    main: [row('b1', 1), row('b2', 4)], variants: [row('b3', 9, 'variant')], counts: [{ book_id: 'b1', pages: 5 }, { book_id: 'b4', pages: 2 }],
    extra: [row('b4', 2, 'rollup')], ms: { total: 12 }, server_ms: 14,
  };
  it("confines Atlas's side to live books before comparing", () => {
    const atlas = {
      main: [{ book_id: 'b1', page_number: 1 }, { book_id: 'hidden', page_number: 1 }, { book_id: 'b2', page_number: 5 }],
      lane: [{ book_id: 'b1', page_number: 1 }, { book_id: 'hidden', page_number: 1 }, { book_id: 'b3', page_number: 9 }],
      counts: [{ book_id: 'hidden', pages: 50 }, { book_id: 'b1', pages: 5 }, { book_id: 'b4', pages: 2 }],
      ms: 1300,
    };
    const s = buildKeywordShadow({ ok: true, r: svc, ms: 20 }, atlas, new Set(['b1', 'b2', 'b3', 'b4']), 25, { filtered: false, variants: true });
    expect(s).toMatchObject({ atlas_ms: 1300, svc_ms: 20, svc_server_ms: 14, k: 25, atlas_n: 2, svc_n: 2, recall_main: 0.5, recall_lane: 1, recall_counts_30: 1, variants: true });
  });
  it('records a service failure without throwing', () => {
    const s = buildKeywordShadow({ ok: false, error: '[keyword-search] timeout after 1500 ms', ms: 1501 }, { main: [], lane: [], counts: null, ms: 900 }, new Set(), 25, { filtered: true, variants: false });
    expect(s).toMatchObject({ svc_n: null, recall_main: null, svc_error: '[keyword-search] timeout after 1500 ms', filtered: true });
  });
  it('an Atlas failure leaves nothing to compare', () => {
    const s = buildKeywordShadow({ ok: true, r: svc, ms: 20 }, { main: [], lane: [], counts: null, ms: 8000, failed: true }, new Set(['b1']), 25, { filtered: false, variants: false });
    expect(s).toMatchObject({ atlas_failed: true, recall_main: null, recall_lane: null, svc_n: 2 });
  });
});

describe('synthesizeHighlights', () => {
  it('prefers the translation, falls back to the OCR, and returns undefined when no word is found', () => {
    expect(synthesizeHighlights({ translation: { data: 'The Furnace of Drebbel' }, ocr: { data: 'Drebbel' } }, ['drebbel'])?.[0])
      .toEqual({ path: 'translation.data', texts: [{ value: 'Drebbel', type: 'hit' }] });
    expect(synthesizeHighlights({ translation: { data: 'a furnace' }, ocr: { data: 'fornax Drebelii' } }, ['Drebelii', 'Drebbel'])?.[0].path).toBe('ocr.data');
    expect(synthesizeHighlights({ translation: { data: 'nothing' }, ocr: { data: '' } }, ['drebbel'])).toBeUndefined();
  });
});

describe('hydrateKeywordRows', () => {
  it('keeps service order and drops pages Mongo no longer serves', async () => {
    const docs = [
      { id: 'p1', book_id: 'b1', page_number: 3, page_type: 'text', translation: { data: 'alchemy here' }, ocr: { data: '' } },
      { id: 'p2', book_id: 'b1', page_number: 0, translation: { data: 'alchemy' } },                 // renumbered: hidden
      { id: 'p3', book_id: 'b9', page_number: 2, translation: { data: 'alchemy' } },                 // moved book
      { id: 'p4', book_id: 'b2', page_number: 1, page_type: 'title-page', translation: { data: 'alchemy' } },
      { id: 'p6', book_id: 'b3', page_number: 7, ocr: { data: 'Alchemia' } },
    ];
    const find = vi.fn(() => ({ maxTimeMS: () => ({ toArray: async () => docs }) }));
    const db = { collection: () => ({ find }) } as any;
    const rows = ['p6', 'p1', 'p2', 'p3', 'p4', 'p5'].map((id, i) => ({ page_id: id, book_id: id === 'p6' ? 'b3' : id === 'p4' ? 'b2' : 'b1', page_number: 1, score: 10 - i, src: 'main' as const }));
    const out = await hydrateKeywordRows(db, rows, { query: 'alchemy' });
    expect(out.map(d => d.id)).toEqual(['p6', 'p1']);
    expect(out[1]).toMatchObject({ page_number: 3, searchScore: 9, highlights: [{ path: 'translation.data' }] });
    expect(out[0].highlights).toBeUndefined(); // "alchemia" does not contain "alchemy"
  });
});
