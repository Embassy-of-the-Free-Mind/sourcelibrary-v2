import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// /api/books/[id]/search asks the keyword page service for a LIVE book (#2049),
// and Atlas for everything else. The service holds only live books, and this
// route admits a hidden one for an editor, so a hidden book answered from the
// service would come back empty rather than wrong — the failure a caller cannot
// see. Fails if the service is asked for a book it does not hold, if a service
// failure loses the keyword leg instead of falling back, or if the served pages
// stop reaching the response.

const state = vi.hoisted(() => ({
  book: null as Record<string, unknown> | null,
  mode: 'serve' as 'off' | 'shadow' | 'serve',
  serveFails: false,
  aggregateCalls: 0,
  serveCalls: [] as Array<Record<string, unknown>>,
  logged: [] as Array<Record<string, unknown>>,
}));

const page = (n: number, text: string, score: number) => ({
  id: `p${n}`, book_id: 'bk', page_number: n, searchScore: score,
  translation: { data: text }, ocr: { data: '' },
  highlights: [{ path: 'translation.data', texts: [{ type: 'hit', value: 'mercury' }] }],
});
const ATLAS = [page(7, 'atlas found mercury here', 3)];
const SERVED = [page(12, 'the service found mercury', 9), page(30, 'mercury again', 4)];

vi.mock('@/lib/mongodb', () => ({
  getDb: async () => ({
    collection: (name: string) => name === 'books'
      ? { findOne: async () => state.book }
      : {
        aggregate: () => { state.aggregateCalls++; return { toArray: async () => ATLAS }; },
        find: () => ({ limit: () => ({ toArray: async () => [] }), toArray: async () => [] }),
      },
  }),
}));
vi.mock('@/lib/keyword-search', () => ({
  keywordSearchMode: () => state.mode,
  serveKeywordPages: async (_db: unknown, params: Record<string, unknown>) => {
    state.serveCalls.push(params);
    if (state.serveFails) throw new Error('timeout after 1500 ms');
    return {
      r: { main: SERVED.map((p) => ({ page_id: p.id, book_id: 'bk', page_number: p.page_number, score: p.searchScore, src: 'main' })), variants: [], counts: null, extra: [], ms: {} },
      docs: SERVED,
      rollupDegraded: false,
    };
  },
}));
vi.mock('@/lib/semantic-search', () => ({ semanticPageSearchScoped: async () => [], lexicalPageSearchLang: async () => [] }));
vi.mock('@/lib/semantic-coverage', () => ({ semanticCoverage: async () => ({ status: 'full' }) }));
vi.mock('@/lib/search/name-variants', () => ({ expandPersonNames: async () => [] }));
vi.mock('@/lib/book-access', () => ({ isBookReadable: async () => true }));
vi.mock('@/lib/search-event-log', () => ({ logSearchEvent: (e: Record<string, unknown>) => state.logged.push(e) }));

const LIVE = { id: 'bk', visible: true, pages_count: 40, pages_translated: 40 };

async function search(q = 'mercury') {
  const { GET } = await import('@/app/api/books/[id]/search/route');
  const res = await GET(new NextRequest(`https://sourcelibrary.org/api/books/bk/search?q=${encodeURIComponent(q)}`), { params: Promise.resolve({ id: 'bk' }) });
  return res.json() as Promise<{ results: Array<{ pageNumber: number }>; total: number }>;
}

beforeEach(() => {
  Object.assign(state, { book: LIVE, mode: 'serve', serveFails: false, aggregateCalls: 0, serveCalls: [], logged: [] });
});

describe('within-book keyword leg: the service for a live book, Atlas otherwise (#2049)', () => {
  it('a live book is answered by the service, scoped to that one book, and Atlas is not asked', async () => {
    const body = await search();
    expect(state.serveCalls).toHaveLength(1);
    expect(state.serveCalls[0]).toMatchObject({ query: 'mercury', bookIds: ['bk'], rollup: null });
    expect(state.aggregateCalls).toBe(0);
    expect(body.results.map((r) => r.pageNumber)).toEqual([12, 30]);
    expect((state.logged[0].filters as Record<string, unknown>).keyword_lane).toBe('served');
  });

  it('a hidden book never reaches the service (it holds none), and Atlas answers', async () => {
    state.book = { ...LIVE, visible: false };
    const body = await search();
    expect(state.serveCalls).toHaveLength(0);
    expect(state.aggregateCalls).toBe(1);
    expect(body.results.map((r) => r.pageNumber)).toEqual([7]);
  });

  it.each([
    ['flagged hidden', { hidden: true }],
    ['with no pages', { pages_count: 0 }],
  ])('a book %s stays on Atlas', async (_label, patch) => {
    state.book = { ...LIVE, ...patch };
    await search();
    expect(state.serveCalls).toHaveLength(0);
    expect(state.aggregateCalls).toBe(1);
  });

  it('a service failure falls back to Atlas: the keyword leg is never lost', async () => {
    state.serveFails = true;
    const body = await search();
    expect(state.serveCalls).toHaveLength(1);
    expect(state.aggregateCalls).toBe(1);
    expect(body.results.map((r) => r.pageNumber)).toEqual([7]);
    expect((state.logged[0].filters as Record<string, unknown>).keyword_lane).toBe('fallback');
  });

  it('with the service off (shadow or unset), Atlas exactly as before', async () => {
    for (const mode of ['off', 'shadow'] as const) {
      state.mode = mode;
      await search();
    }
    expect(state.serveCalls).toHaveLength(0);
    expect(state.aggregateCalls).toBe(2);
    expect(state.logged.every((e) => !('keyword_lane' in (e.filters as Record<string, unknown>)))).toBe(true);
  });
});
