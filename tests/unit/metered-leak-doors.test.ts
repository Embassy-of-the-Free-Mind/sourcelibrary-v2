import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The page-text doors found open in the METERED_READER flip audit (#4357,
 * 2026-11-10). Each serves a page's text in its own shape, outside
 * /api/pages/[id], and none called the metered gate:
 *
 *   - /api/pages/[id]/revisions and /revisions/[revisionId] (every past text)
 *   - /api/[tenant]/pages/[id]/revisions (any tenant slug, ANY page)
 *   - /api/pages/[id]/transliterate GET and its cached POST
 *   - /api/books/[id]/pages/[pageId]/alignment (word pairs, both languages)
 *   - /api/books/[id]/edition-page (an edition's translation)
 *   - /api/review/book-run, /api/review/translation-check/shift (walk a book)
 *   - /api/research/ocr-diff?work_id= (two editions' whole transcriptions)
 *   - the reader's facing leaf and the /v2c preview (ISR HTML)
 *
 * Real route modules over an in-memory Mongo; only the session and the paid
 * or unrelated libraries are mocked. The book has 100 pages, so pages 1–20
 * are the free sample. Negative control, run and restored: removing the gate
 * call from any one route turns its "deep page → 401" case red.
 */

type Doc = Record<string, unknown>;

const store: Record<string, Doc[]> = {};
function get(doc: Doc, path: string): unknown {
  return path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Doc)[k] : undefined), doc);
}
function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([k, cond]) => {
    const v = get(doc, k);
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && '$in' in (cond as Doc)) {
      return ((cond as Doc).$in as unknown[]).map(String).includes(String(v));
    }
    if (cond && typeof cond === 'object') return true;
    return v === cond;
  });
}
function cursor(docs: Doc[]) {
  const c = {
    project: () => c, sort: () => c, limit: () => c, skip: () => c, maxTimeMS: () => c,
    toArray: async () => docs.map((d) => structuredClone(d)),
  };
  return c;
}
const fakeDb = {
  collection: (name: string) => ({
    findOne: async (filter: Doc) => {
      const d = (store[name] || []).find((x) => matches(x, filter));
      return d ? structuredClone(d) : null;
    },
    find: (filter: Doc = {}) => cursor((store[name] || []).filter((x) => matches(x, filter))),
    countDocuments: async (filter: Doc = {}) => (store[name] || []).filter((x) => matches(x, filter)).length,
    insertOne: async () => ({}),
    aggregate: () => cursor([]),
  }),
};

const session = vi.hoisted(() => ({ user: null as null | { id: string } }));

vi.mock('@/lib/mongodb', () => ({
  getDb: async () => fakeDb,
  getReadDb: async () => fakeDb,
  default: Promise.resolve({ db: () => fakeDb }),
}));
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => (session.user ? { user: session.user } : null)) }));
vi.mock('@/lib/word-alignment', () => ({
  getOrCreateWordAlignment: async () => ({ status: 'ready', alignment: { version: 1, model: 'm', pairs: [['verbum', 'word']] } }),
}));
vi.mock('@/lib/edition-reader', () => ({
  getPageAtVersion: async () => ({ translation: 'EDITION TEXT', isCurrentVersion: true, edition: { version: '1.0.0' } }),
  getPagesAtVersion: async (_b: string, ids: string[]) =>
    new Map(ids.map((id) => [id, { translation: `EDITION TEXT ${id}`, isCurrentVersion: true, edition: { version: '1.0.0' } }])),
}));
vi.mock('@/lib/tenant-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenant-context')>()),
  resolveTenantId: async (slug: string) => ({ bph: 'tenant-bph', default: 'tenant-default' } as Record<string, string>)[slug] ?? null,
  getTenantContext: async () => null,
}));
vi.mock('@/lib/tenant-catalog-books', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenant-catalog-books')>()),
  findBookForTenant: async (db: typeof fakeDb, id: string) => {
    const book = await db.collection('books').findOne({ id });
    return book ? { book } : null;
  },
}));

const BOOK = { id: 'b1', slug: 'b1', title: 'Liber', language: 'Latin', visible: true, pages_count: 100 };
const BPH_BOOK = { id: 'bph1', title: 'Partner', language: 'Latin', visible: true, pages_count: 100, tenantId: 'tenant-bph' };
const page = (n: number, extra: Doc = {}): Doc => ({
  id: `p${n}`, book_id: 'b1', page_number: n,
  ocr: { data: `LATIN TEXT ${n}` }, translation: { data: `ENGLISH TEXT ${n}` },
  transliteration: { data: `TRANSLIT ${n}`, script: 'x', source_ocr_hash: 'h' },
  ...extra,
});

const FREE = 'p2';
const DEEP = 'p50';

beforeEach(() => {
  process.env.METERED_READER = '1';
  process.env.AUTH_SECRET ??= 'test-secret';
  session.user = null;
  store.books = [BOOK, BPH_BOOK];
  store.pages = [page(2), page(20), page(21), page(50), page(60, { seo_indexable: true }),
    { ...page(70), id: 'bph70', book_id: 'bph1', tenantId: 'tenant-bph' }];
  store.page_revisions = [
    { id: 'r-free', page_id: FREE, field: 'ocr', content: 'OLD LATIN 2' },
    { id: 'r-deep', page_id: DEEP, field: 'ocr', content: 'OLD LATIN 50' },
    { id: 'r-bph', page_id: 'bph70', field: 'ocr', content: 'OLD LATIN BPH' },
  ];
});
afterEach(() => { delete process.env.METERED_READER; });

const ANON_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const req = (url: string, init: { ua?: string; method?: string; body?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`https://sourcelibrary.org${url}`, {
    method: init.method || 'GET',
    headers: { 'user-agent': init.ua ?? ANON_CHROME, ...(init.headers || {}) },
    ...(init.body ? { body: init.body } : {}),
  });
const params = <T extends Doc>(p: T) => ({ params: Promise.resolve(p) });

describe('pageGateForRequest — the one-page wrapper over gatePagesForRequest', () => {
  it('gates a deep page for an anonymous caller, not a free, seo_indexable, or signed-in one', async () => {
    const { pageGateForRequest } = await import('@/lib/metered-gate');
    const p = (id: string) => store.pages.find((x) => x.id === id)!;
    expect(await pageGateForRequest(fakeDb as never, req('/x'), p(DEEP))).toMatchObject({ free_pages: 20, pages_count: 100 });
    expect(await pageGateForRequest(fakeDb as never, req('/x'), p(FREE))).toBeNull();
    expect(await pageGateForRequest(fakeDb as never, req('/x'), p('p60'))).toBeNull();
    // Our MCP server's NAME alone is walled (anyone can write it, #4357); its proof header is not.
    expect(await pageGateForRequest(fakeDb as never, req('/x', { ua: 'SourceLibrary-MCP/4.3' }), p(DEEP))).not.toBeNull();
    const { MCP_PROOF_HEADER, mintMcpProof } = await import('@/lib/mcp-self-proof');
    const proven = req('/x', { ua: 'SourceLibrary-MCP/4.3', headers: { [MCP_PROOF_HEADER]: mintMcpProof()! } });
    expect(await pageGateForRequest(fakeDb as never, proven, p(DEEP))).toBeNull();
    session.user = { id: 'u1' };
    expect(await pageGateForRequest(fakeDb as never, req('/x'), p(DEEP))).toBeNull();
  });

  it('is inert with the switch off', async () => {
    delete process.env.METERED_READER;
    const { pageGateForRequest } = await import('@/lib/metered-gate');
    expect(await pageGateForRequest(fakeDb as never, req('/x'), store.pages.find((x) => x.id === DEEP)!)).toBeNull();
  });
});

describe('gateLeafText — each leaf on its own page number', () => {
  it('page 20 of 100 keeps its text, its facing page 21 loses it', async () => {
    const { gateLeafText } = await import('@/lib/free-preview');
    const p20 = gateLeafText(page(20), 100, true) as Doc;
    const p21 = gateLeafText(page(21), 100, true) as Doc;
    expect(p20.translation).toBeTruthy();
    expect(p21.translation).toBeUndefined();
    expect(p21.ocr).toBeUndefined();
    expect(p21.gated).toBe(true);
    expect((gateLeafText(page(21), 100, false) as Doc).translation).toBeTruthy();
  });
});

describe('/api/pages/[id]/revisions', () => {
  it('deep page → 401 with no revision text; free page → its revisions', async () => {
    const { GET } = await import('@/app/api/pages/[id]/revisions/route');
    const deep = await GET(req(`/api/pages/${DEEP}/revisions?field=ocr`), params({ id: DEEP }));
    expect(deep.status).toBe(401);
    expect(await deep.text()).not.toContain('OLD LATIN 50');
    const free = await GET(req(`/api/pages/${FREE}/revisions?field=ocr`), params({ id: FREE }));
    expect(free.status).toBe(200);
    expect(await free.text()).toContain('OLD LATIN 2');
  });

  it('signed in → the deep page\'s revisions', async () => {
    session.user = { id: 'u1' };
    const { GET } = await import('@/app/api/pages/[id]/revisions/route');
    const res = await GET(req(`/api/pages/${DEEP}/revisions?field=ocr`), params({ id: DEEP }));
    expect(await res.text()).toContain('OLD LATIN 50');
  });

  it('a single revision follows the page IT names, whatever the URL says', async () => {
    const { GET } = await import('@/app/api/pages/[id]/revisions/[revisionId]/route');
    const res = await GET(req(`/api/pages/${FREE}/revisions/r-deep`), params({ id: FREE, revisionId: 'r-deep' }));
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('OLD LATIN 50');
    const ok = await GET(req(`/api/pages/${FREE}/revisions/r-free`), params({ id: FREE, revisionId: 'r-free' }));
    expect(ok.status).toBe(200);
  });

  it('[tenant] twin: a reading room is exempt for its own pages only', async () => {
    const { GET } = await import('@/app/api/[tenant]/pages/[id]/revisions/route');
    const foreign = await GET(req(`/api/bph/pages/${DEEP}/revisions?field=ocr`), params({ tenant: 'bph', id: DEEP }));
    expect(foreign.status).toBe(401);
    const own = await GET(req('/api/bph/pages/bph70/revisions?field=ocr'), params({ tenant: 'bph', id: 'bph70' }));
    expect(await own.text()).toContain('OLD LATIN BPH');
    const dflt = await GET(req(`/api/default/pages/${DEEP}/revisions?field=ocr`), params({ tenant: 'default', id: DEEP }));
    expect(dflt.status).toBe(401);
  });
});

describe('/api/pages/[id]/transliterate', () => {
  it('GET: deep page → 401, free page → the transliteration', async () => {
    const { GET } = await import('@/app/api/pages/[id]/transliterate/route');
    const deep = await GET(req(`/api/pages/${DEEP}/transliterate`), params({ id: DEEP }));
    expect(deep.status).toBe(401);
    expect(await deep.text()).not.toContain('TRANSLIT 50');
    const free = await GET(req(`/api/pages/${FREE}/transliterate`), params({ id: FREE }));
    expect(await free.text()).toContain('TRANSLIT 2');
  });

  it('POST on a deep page → 401 before any cache return or generation', async () => {
    const { POST } = await import('@/app/api/pages/[id]/transliterate/route');
    const res = await POST(req(`/api/pages/${DEEP}/transliterate`, { method: 'POST', body: '{}' }), params({ id: DEEP }));
    expect(res.status).toBe(401);
  });
});

describe('/api/books/[id]/pages/[pageId]/alignment', () => {
  it('deep page → 401; free page → the pairs', async () => {
    const { GET } = await import('@/app/api/books/[id]/pages/[pageId]/alignment/route');
    const deep = await GET(req(`/api/books/b1/pages/${DEEP}/alignment`), params({ id: 'b1', pageId: DEEP }));
    expect(deep.status).toBe(401);
    const free = await GET(req(`/api/books/b1/pages/${FREE}/alignment`), params({ id: 'b1', pageId: FREE }));
    expect(free.status).toBe(200);
    expect(await free.text()).toContain('verbum');
  });
});

describe('/api/books/[id]/edition-page', () => {
  it('single deep page → 401; batch → the deep page with no translation', async () => {
    const { GET } = await import('@/app/api/books/[id]/edition-page/route');
    const one = await GET(req(`/api/books/b1/edition-page?page_id=${DEEP}&v=1.0.0`), params({ id: 'b1' }));
    expect(one.status).toBe(401);
    const batch = await GET(req(`/api/books/b1/edition-page?page_id=${FREE},${DEEP}&v=1.0.0`), params({ id: 'b1' }));
    const body = await batch.json() as { pages: Array<{ page_id: string; translation: string | null; gated?: boolean }> };
    const by = new Map(body.pages.map((p) => [p.page_id, p]));
    expect(by.get(FREE)?.translation).toContain('EDITION TEXT');
    expect(by.get(DEEP)?.translation).toBeNull();
    expect(by.get(DEEP)?.gated).toBe(true);
  });
});

describe('whole-book walks: book-run, translation-check shift, ocr-diff', () => {
  it('an anonymous caller signs in first', async () => {
    const run = await (await import('@/app/api/review/book-run/route')).GET(req('/api/review/book-run?book=b1&after=40'));
    expect(run.status).toBe(401);
    const shift = await (await import('@/app/api/review/translation-check/shift/route')).GET(req('/api/review/translation-check/shift'));
    expect(shift.status).toBe(401);
    const diff = await (await import('@/app/api/research/ocr-diff/route')).GET(req('/api/research/ocr-diff?work_id=w1'));
    expect(diff.status).toBe(401);
  });

  it('our MCP server (a proven caller) is not walled; its name alone is', async () => {
    const { MCP_PROOF_HEADER, mintMcpProof } = await import('@/lib/mcp-self-proof');
    const { GET } = await import('@/app/api/research/ocr-diff/route');
    const proven = req('/api/research/ocr-diff?work_id=w1', { ua: 'SourceLibrary-MCP/4.3', headers: { [MCP_PROOF_HEADER]: mintMcpProof()! } });
    expect((await GET(proven)).status).not.toBe(401); // 400: the fixture has no editions of w1
    const forged = req('/api/research/ocr-diff?work_id=w1', { ua: 'SourceLibrary-MCP/4.3' });
    expect((await GET(forged)).status).toBe(401);
  });
});

describe('/book/[id]/page/[pageId]/v2c — the design-preview loader', () => {
  it('strips a deep page and keeps a free one', async () => {
    const { getReaderV2Data } = await import('@/app/book/[id]/page/[pageId]/reader-v2-data');
    const deep = await getReaderV2Data('b1', DEEP);
    expect(JSON.stringify(deep.page)).not.toContain('ENGLISH TEXT 50');
    expect((deep.page as unknown as Doc).gated).toBe(true);
    const free = await getReaderV2Data('b1', FREE);
    expect(JSON.stringify(free.page)).toContain('ENGLISH TEXT 2');
  });
});
