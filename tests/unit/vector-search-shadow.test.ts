import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The page-vector service beside match_semantic (#6821). What must hold:
//   - off unless URL + TOKEN + MODE are all set: no reader request reaches l7a by accident;
//   - shadow returns the RPC's rows, never the service's, and never waits for the service;
//   - serve returns the service's rows hydrated, and falls back to the RPC on ANY failure,
//     including `complete: false` (the service could not fill the page under its filter);
//   - the language-keyed store (textLang ≠ en) never reaches the service: it holds no such vectors.

const rpc = vi.fn();
const inFn = vi.fn();
const from = vi.fn(() => ({ select: () => ({ in: (...a: unknown[]) => inFn(...a) }) }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => (from as any)(...a) } }));
vi.mock('@/lib/supabase-admin', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

const SVC = 'http://vectors.test:3458';
const rpcRow = (id: string, sim = 0.8) => ({
  page_id: id, book_id: 'b1', page_number: 1, translation: `text ${id}`, book_title: 'T', book_author: 'A',
  book_language: 'Latin', book_year: 1600, similarity: sim,
});

let svcHandler: (body: any, init: RequestInit) => Promise<Response>;
const svcCalls: { body: any; init: RequestInit }[] = [];

function jsonResponse(obj: unknown, status = 200): Response {
  return { ok: status === 200, status, json: async () => obj } as unknown as Response;
}

beforeEach(() => {
  rpc.mockReset(); inFn.mockReset(); from.mockClear(); svcCalls.length = 0;
  vi.resetModules();
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.VECTOR_SEARCH_URL = SVC;
  process.env.VECTOR_SEARCH_TOKEN = 'tok';
  delete process.env.VECTOR_SEARCH_MODE;
  svcHandler = async () => jsonResponse({ rows: [], ms: 1, path: 'hnsw', complete: true });
  global.fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (String(url).startsWith(SVC)) {
      const body = JSON.parse(String(init.body));
      svcCalls.push({ body, init });
      return svcHandler(body, init);
    }
    return jsonResponse({ embeddings: [{ values: Array(768).fill(0.01) }] });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  delete process.env.VECTOR_SEARCH_URL; delete process.env.VECTOR_SEARCH_TOKEN; delete process.env.VECTOR_SEARCH_MODE;
});

const global_ = { scope: { kind: 'global' as const } };

describe('vectorSearchMode', () => {
  it('is off unless URL, token and mode are all set', async () => {
    const { vectorSearchMode } = await import('@/lib/vector-search');
    expect(vectorSearchMode()).toBe('off'); // no MODE
    process.env.VECTOR_SEARCH_MODE = 'shadow';
    expect(vectorSearchMode()).toBe('shadow');
    delete process.env.VECTOR_SEARCH_TOKEN;
    expect(vectorSearchMode()).toBe('off');
    process.env.VECTOR_SEARCH_TOKEN = 'tok'; process.env.VECTOR_SEARCH_MODE = 'bogus';
    expect(vectorSearchMode()).toBe('off');
  });
});

describe('overlapAtK', () => {
  it('divides by the longer list, so a short list counts against it', async () => {
    const { overlapAtK } = await import('@/lib/vector-search');
    const a = [{ page_id: 'p1' }, { page_id: 'p2' }];
    const b = [{ page_id: 'p1' }, { page_id: 'p2' }, { page_id: 'p3' }, { page_id: 'p4' }];
    expect(overlapAtK(a, b, 10)).toBe(0.5);
    expect(overlapAtK(b, b, 2)).toBe(1);
    expect(overlapAtK([], [], 5)).toBeNull();
  });
});

describe('semanticPageSearchGlobal, VECTOR_SEARCH_MODE=off', () => {
  it('never calls the service, even with a sink', async () => {
    const { semanticPageSearchGlobal } = await import('@/lib/semantic-search');
    rpc.mockResolvedValue({ data: [rpcRow('p1')], error: null });
    const sink = {};
    const rows = await semanticPageSearchGlobal('q', 5, { ...global_, vectorShadow: sink });
    expect(rows.map((r) => r.page_id)).toEqual(['p1']);
    expect(svcCalls).toHaveLength(0);
    expect((sink as any).result).toBeUndefined();
  });
});

describe('semanticPageSearchGlobal, VECTOR_SEARCH_MODE=shadow', () => {
  beforeEach(() => { process.env.VECTOR_SEARCH_MODE = 'shadow'; });

  it('returns the RPC rows and records the comparison', async () => {
    const { semanticPageSearchGlobal } = await import('@/lib/semantic-search');
    rpc.mockResolvedValue({ data: [rpcRow('p1'), rpcRow('p2'), rpcRow('p3'), rpcRow('p4')], error: null });
    svcHandler = async () => jsonResponse({ rows: [{ page_id: 'p1', book_id: 'b1', page_number: 1, similarity: 0.8 }, { page_id: 'p9', book_id: 'b9', page_number: 2, similarity: 0.7 }, { page_id: 'p3', book_id: 'b1', page_number: 3, similarity: 0.6 }, { page_id: 'p2', book_id: 'b1', page_number: 4, similarity: 0.5 }], ms: 9.4, path: 'exact', complete: true });
    const sink: { result?: Promise<any> } = {};
    const rows = await semanticPageSearchGlobal('q', 4, { ...global_, languages: ['Latin'], yearMax: 1600, vectorShadow: sink });
    expect(rows.map((r) => r.page_id)).toEqual(['p1', 'p2', 'p3', 'p4']); // the RPC's, not the service's
    const s = await sink.result;
    expect(s).toMatchObject({ k: 4, rpc_n: 4, svc_n: 4, overlap_at_k: 0.75, filtered: true, svc_path: 'exact', svc_complete: true, svc_server_ms: 9.4 });
    expect(typeof s.rpc_ms).toBe('number');
    expect(typeof s.svc_ms).toBe('number');
    // Same question as the RPC: expanded language names, the RPC's threshold, Bearer auth.
    expect(svcCalls[0].body).toMatchObject({ k: 4, threshold: 0.3, filter_languages: ['Latin', 'la'], year_max: 1600, year_min: null });
    expect((svcCalls[0].init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('does not ask the service for text (the comparison reads page ids only)', async () => {
    const { semanticPageSearchGlobal } = await import('@/lib/semantic-search');
    rpc.mockResolvedValue({ data: [rpcRow('p1')], error: null });
    const sink: { result?: Promise<unknown> } = {};
    await semanticPageSearchGlobal('q', 5, { ...global_, vectorShadow: sink } as any);
    await sink.result;
    expect(svcCalls).toHaveLength(1);
    expect(svcCalls[0].body.with_text).toBeUndefined();
  });

  it('does not wait for a service that never answers', async () => {
    const { semanticPageSearchGlobal } = await import('@/lib/semantic-search');
    rpc.mockResolvedValue({ data: [rpcRow('p1')], error: null });
    svcHandler = () => new Promise(() => {}); // ignores its abort signal: the worst case
    const sink: { result?: Promise<any> } = {};
    const rows = await semanticPageSearchGlobal('q', 5, { ...global_, vectorShadow: sink });
    expect(rows.map((r) => r.page_id)).toEqual(['p1']);
    expect(sink.result).toBeInstanceOf(Promise);
  });

  it('records a service error and still returns the RPC rows', async () => {
    const { semanticPageSearchGlobal } = await import('@/lib/semantic-search');
    rpc.mockResolvedValue({ data: [rpcRow('p1')], error: null });
    svcHandler = async () => jsonResponse({ error: 'unauthorized' }, 401);
    const sink: { result?: Promise<any> } = {};
    const rows = await semanticPageSearchGlobal('q', 5, { ...global_, vectorShadow: sink });
    expect(rows).toHaveLength(1);
    expect(await sink.result).toMatchObject({ svc_ms: null, svc_n: null, overlap_at_k: null, svc_error: expect.stringContaining('HTTP 401') });
  });

  it('makes no service call without a sink (nowhere to record it)', async () => {
    const { semanticPageSearchGlobal } = await import('@/lib/semantic-search');
    rpc.mockResolvedValue({ data: [rpcRow('p1')], error: null });
    await semanticPageSearchGlobal('q', 5, global_);
    expect(svcCalls).toHaveLength(0);
  });

  it('leaves the language-keyed store alone', async () => {
    const { semanticPageSearchGlobal } = await import('@/lib/semantic-search');
    rpc.mockResolvedValue({ data: [], error: null });
    const sink = {};
    await semanticPageSearchGlobal('q', 5, { ...global_, textLang: 'es', vectorShadow: sink });
    expect(svcCalls).toHaveLength(0);
    expect(rpc.mock.calls[0][0]).toBe('match_page_texts');
  });
});

describe('semanticPageSearchGlobal, VECTOR_SEARCH_MODE=serve', () => {
  beforeEach(() => { process.env.VECTOR_SEARCH_MODE = 'serve'; });

  it('serves the service rows in service order, hydrated by primary key, without the RPC', async () => {
    const { semanticPageSearchGlobal } = await import('@/lib/semantic-search');
    svcHandler = async () => jsonResponse({ rows: [{ page_id: 'p2', book_id: 'b1', page_number: 2, similarity: 0.9 }, { page_id: 'gone', book_id: 'b1', page_number: 5, similarity: 0.85 }, { page_id: 'p1', book_id: 'b1', page_number: 1, similarity: 0.7 }], ms: 3, complete: true });
    inFn.mockResolvedValue({ data: [rpcRow('p1', 0.1), rpcRow('p2', 0.1)], error: null });
    const rows = await semanticPageSearchGlobal('q', 5, global_);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith('page_translations');
    expect(inFn).toHaveBeenCalledWith('page_id', ['p2', 'gone', 'p1']);
    // Order and scores are the service's; a row missing from page_translations is dropped.
    expect(rows.map((r) => [r.page_id, r.score])).toEqual([['p2', 0.9], ['p1', 0.7]]);
    expect(rows[0].snippet).toBe('text p2');
  });

  const svcRow = (id: string, sim: number) => ({
    page_id: id, book_id: 'b1', page_number: 3, similarity: sim, translation: `svc text ${id}`,
    book_title: 'T', book_author: null, book_language: 'Latin', book_year: 1600,
  });

  it('asks for with_text and skips Supabase when the service sent every column (#6843)', async () => {
    const { semanticPageSearchGlobal } = await import('@/lib/semantic-search');
    svcHandler = async () => jsonResponse({ rows: [svcRow('p2', 0.9), svcRow('p1', 0.7)], ms: 3, complete: true });
    const rows = await semanticPageSearchGlobal('q', 5, global_);
    expect(svcCalls[0].body.with_text).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(rows.map((r) => [r.page_id, r.score])).toEqual([['p2', 0.9], ['p1', 0.7]]);
    expect(rows[0].snippet).toBe('svc text p2');
  });

  it('hydrates only the rows the service sent without text, keeping service order', async () => {
    const { semanticPageSearchGlobal } = await import('@/lib/semantic-search');
    svcHandler = async () => jsonResponse({
      rows: [svcRow('p2', 0.9), { page_id: 'p1', book_id: 'b1', page_number: 1, similarity: 0.8, book_language: 'Latin', book_year: 1600 }, svcRow('p3', 0.7)],
      ms: 3, complete: true,
    });
    inFn.mockResolvedValue({ data: [rpcRow('p1', 0.1)], error: null });
    const rows = await semanticPageSearchGlobal('q', 5, global_);
    expect(inFn).toHaveBeenCalledWith('page_id', ['p1']);
    expect(rows.map((r) => [r.page_id, r.score, r.snippet])).toEqual([['p2', 0.9, 'svc text p2'], ['p1', 0.8, 'text p1'], ['p3', 0.7, 'svc text p3']]);
  });

  for (const [name, setup] of [
    ['a timeout or network error', () => { svcHandler = async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); }; }],
    ['a non-200', () => { svcHandler = async () => jsonResponse({ error: 'x' }, 500); }],
    ['complete: false', () => { svcHandler = async () => jsonResponse({ rows: [{ page_id: 'p9', book_id: 'b', page_number: 1, similarity: 0.5 }], ms: 200, complete: false }); }],
    ['a hydration error', () => { svcHandler = async () => jsonResponse({ rows: [{ page_id: 'p9', book_id: 'b', page_number: 1, similarity: 0.5 }], ms: 2, complete: true }); inFn.mockResolvedValue({ data: null, error: { message: 'boom' } }); }],
  ] as const) {
    it(`falls back to match_semantic on ${name}`, async () => {
      const { semanticPageSearchGlobal } = await import('@/lib/semantic-search');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      setup();
      rpc.mockResolvedValue({ data: [rpcRow('p1')], error: null });
      const rows = await semanticPageSearchGlobal('q', 5, global_);
      expect(rpc.mock.calls[0][0]).toBe('match_semantic');
      expect(rows.map((r) => r.page_id)).toEqual(['p1']);
      warn.mockRestore();
    });
  }
});

// match_pages_in_books through the service's book_ids path (#2049). Serve mode only; anything the
// service cannot vouch for (error, complete: false, a service that ignored book_ids) goes to the RPC.
describe('semanticPageSearchScoped, VECTOR_SEARCH_MODE=serve', () => {
  const svcRow = (id: string, sim = 0.7) => ({ ...rpcRow(id, sim) });

  it('serves the service rows and sends the books, the threshold and k', async () => {
    process.env.VECTOR_SEARCH_MODE = 'serve';
    svcHandler = async () => jsonResponse({ rows: [svcRow('s1', 0.71), svcRow('s2', 0.6)], ms: 4, path: 'books', complete: true });
    const { semanticPageSearchScoped } = await import('@/lib/semantic-search');
    const out = await semanticPageSearchScoped('q', ['b1'], 10);
    expect(out.map((r) => r.page_id)).toEqual(['s1', 's2']);
    expect(out[0].score).toBe(0.71);
    expect(out[0].snippet).toBe('text s1');
    expect(svcCalls[0].body).toMatchObject({ book_ids: ['b1'], k: 10, threshold: 0.3, with_text: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('serves an empty answer as empty, without the RPC', async () => {
    process.env.VECTOR_SEARCH_MODE = 'serve';
    svcHandler = async () => jsonResponse({ rows: [], ms: 1, path: 'books', complete: true });
    const { semanticPageSearchScoped } = await import('@/lib/semantic-search');
    expect(await semanticPageSearchScoped('q', ['b1'], 10)).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['an HTTP error', async () => jsonResponse({ error: 'x' }, 500)],
    ['complete: false', async () => jsonResponse({ rows: [], ms: 1, path: 'books', complete: false })],
    ['a service that ignored book_ids', async () => jsonResponse({ rows: [svcRow('elsewhere')], ms: 1, path: 'hnsw', complete: true })],
  ])('falls back to match_pages_in_books on %s', async (_label, h) => {
    process.env.VECTOR_SEARCH_MODE = 'serve';
    svcHandler = h as typeof svcHandler;
    rpc.mockResolvedValue({ data: [rpcRow('r1')], error: null });
    const { semanticPageSearchScoped } = await import('@/lib/semantic-search');
    const out = await semanticPageSearchScoped('q', ['b1'], 10);
    expect(out.map((r) => r.page_id)).toEqual(['r1']);
    expect(rpc).toHaveBeenCalledWith('match_pages_in_books', expect.objectContaining({ book_ids: ['b1'], match_count: 10 }));
  });

  it('never asks the service in shadow mode, for more than 50 books, or for another text language', async () => {
    rpc.mockResolvedValue({ data: [rpcRow('r1')], error: null });
    const { semanticPageSearchScoped } = await import('@/lib/semantic-search');
    process.env.VECTOR_SEARCH_MODE = 'shadow';
    await semanticPageSearchScoped('q', ['b1'], 10);
    process.env.VECTOR_SEARCH_MODE = 'serve';
    await semanticPageSearchScoped('q', Array.from({ length: 51 }, (_, i) => `b${i}`), 10);
    await semanticPageSearchScoped('q', ['b1'], 10, { textLang: 'es' });
    expect(svcCalls).toHaveLength(0);
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});
