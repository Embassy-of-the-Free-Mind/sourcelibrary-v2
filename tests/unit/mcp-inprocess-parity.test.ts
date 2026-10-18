import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// #6853: the search tools stopped fetching https://sourcelibrary.org/api/search*
// and run the same route handlers in-process. The promise is that a caller
// cannot tell: for the same backend answer, the tool's text is byte-identical.
// Each query below runs both ways against ONE canned backend: the old way
// (MCP_INPROCESS=0, fetch) and the new way (the route handler, called in-process),
// and the two outputs are compared as strings.
// tests/smoke/mcp-inprocess-parity.test.ts does the same against two live deployments.

vi.mock('@/lib/api-auth', () => ({ withApiAuth: (h: (...a: unknown[]) => unknown) => (req: unknown) => h(req, {}, IDENTITY) }));
vi.mock('@/lib/mcp-usage', () => ({ logMcpToolCall: vi.fn(), logMcpInitialize: vi.fn() }));
vi.mock('@/lib/api-usage', () => ({ getPagesServedLast24h: vi.fn(async () => 0), logApiUsage: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  getClientIp: (r: Request) => r.headers.get('x-forwarded-for') || 'unknown',
  peekRateLimit: () => ({ count: 0, limit: 60, remaining: 60, resetAt: 0 }),
}));

const IDENTITY = { kind: 'apikey', apiKeyId: 'k1', userId: 'u1', apiKeyTier: 'free' } as const;
const CALLER_IP = '198.51.100.7';
const ZW = '​‌'; // provenance marks: stripped from snippets on the way out

/** A deterministic backend answer for a search URL, rich enough to exercise every mapping branch. */
function backend(url: string): { status: number; body: unknown; cacheControl: string } {
  const u = new URL(url);
  const q = u.searchParams.get('q') || '';
  if (q === 'server error please') return { status: 500, body: { error: 'Search failed', message: 'boom' }, cacheControl: 'public, s-maxage=10' };
  const n = (q.length % 5) + 3;
  // /books/<id>/search (search_within_book): its own body shape, and no Cache-Control, as the route sends.
  if (/^\/api\/books\/[^/]+\/search$/.test(u.pathname)) {
    return {
      status: 200,
      cacheControl: '',
      body: {
        query: q, lang: u.searchParams.get('lang') || 'en', total: n * 2, returned: n, ocrPages: 1, translationPages: n - 1,
        front_matter_results: q.includes('preface') ? 1 : 0,
        ...(q.includes('blind') ? { semantic_coverage: { status: 'none', embedded_pages: 0, translated_pages: 40, caveat: 'not embedded' } } : {}),
        results: Array.from({ length: n }, (_, i) => ({
          pageId: `p${i}`, pageNumber: i * 3 + 1, score: 1 - i / 10, found_by: i % 3 ? 'keyword' : 'both',
          matches: [{ field: i % 2 ? 'ocr' : 'translation', snippet: `${ZW}…${q} at ${i}…`, position: i }],
          ...(q.includes('preface') && i === n - 1 ? { is_front_matter: true, reason: 'roman-pagination' } : {}),
        })),
      },
    };
  }
  const semantic = u.pathname.endsWith('/semantic');
  const results = Array.from({ length: n }, (_, i) => semantic
    ? {
      book_id: `b${i}`, book_title: `${q} title ${i}`, book_author: i % 2 ? 'Ficino' : null, book_language: i % 3 ? 'Latin' : 'German',
      ...(i % 2 ? { tradition: ['hermetic'] } : {}), book_year: 1500 + i, page_number: i + 1, slug: i % 2 ? `slug-${i}` : undefined,
      snippet: i === 1 ? '   ' : `${ZW}${q} snippet ${i}`, snippet_type: i % 4 === 0 ? 'ocr' : undefined, score: 0.8 - i / 100,
    }
    : {
      book_id: `b${i}`, id: `b${i}`, type: i % 2 ? 'page' : 'book', title: `${q} t${i}`, display_title: i % 3 ? `${q} display ${i}` : undefined,
      author: 'Paracelsus', language: 'Latin', published: '1589', has_doi: i % 2 === 0, slug: i % 2 ? `s${i}` : undefined,
      ...(i % 2 ? { page_number: i * 7 } : {}), snippet: i === 2 ? '' : `${ZW}…${q} words ${i}…`, snippet_type: 'translation',
      ...(i % 3 === 0 ? { phrase_match: 0.5, found_by: ['page'] } : {}),
    });
  const partial = q.includes('partial');
  return {
    status: 200,
    body: {
      query: q, total: n * 4, results,
      ...(partial ? { partial: true, degraded_lanes: ['semantic_page'] } : {}),
      ...(semantic ? { lang: u.searchParams.get('lang') || 'en', diversity: u.searchParams.get('diversity') || 'tradition' } : {}),
      ...(q.includes('1600') ? { nearby: [{ id: 'n1', title: 'Near' }] } : {}),
    },
    cacheControl: partial ? 'no-store' : 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
  };
}

const fetched: string[] = [];
const routed: Array<{ url: string; ua: string | null; xff: string | null; identity: unknown }> = [];
const bookParams: string[] = [];

vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  fetched.push(url);
  const b = backend(url);
  return new Response(JSON.stringify(b.body), { status: b.status, headers: { 'Content-Type': 'application/json' } });
}));

const { route } = vi.hoisted(() => ({
  route: async (req: Request, _ctx: unknown, identity?: unknown) => {
    routed.push({ url: req.url, ua: req.headers.get('user-agent'), xff: req.headers.get('x-forwarded-for'), identity: identity ?? null });
    const b = backend(req.url);
    return new Response(JSON.stringify(b.body), { status: b.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': b.cacheControl } });
  },
}));
vi.mock('@/app/api/search/route', () => ({ GET: Object.assign(route, { handler: route }) }));
vi.mock('@/app/api/search/semantic/route', () => ({ GET: (req: Request) => route(req, undefined) }));
vi.mock('@/app/api/books/[id]/search/route', () => ({
  GET: async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    bookParams.push((await ctx.params).id);
    return route(req, undefined);
  },
}));

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const { POST } = await import('@/app/api/mcp/route');
  const res = await (POST as unknown as (r: Request) => Promise<Response>)(new Request('https://sourcelibrary.org/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'x-forwarded-for': CALLER_IP },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }));
  return res.text();
}

// Fixed queries across the four tools that moved in-process.
const QUERIES: Array<[string, Record<string, unknown>]> = [
  ['search_library', { query: 'Paracelsus', limit: 5 }],
  ['search_library', { query: 'emerald tablet', language: 'Latin', year_from: 1500, year_to: 1700, has_translation: true }],
  ['search_library', { query: 'harmony 1600', sort: 'date_asc', offset: 10 }],
  ['search_translations', { query: 'prima materia', limit: 4 }],
  ['search_translations', { query: 'daemon', lang: 'es', diversity: 'author', book_id: 'b9' }],
  ['search_translations', { query: 'partial lane timeout', languages: ['Latin', 'Greek'], exclude_languages: ['English'] }],
  ['search_concept', { query: 'the soul ascends through the planetary spheres', limit: 5 }],
  ['search_concept', { query: 'memory palace', year_from: 1400, year_to: 1650, max_per_book: 2, diversity: 'off' }],
  ['search_concept', { query: 'daemon', lang: 'de' }],
  ['search_translations', { query: 'server error please' }],
  ['search_within_book', { book_id: '6993831b84cf5845c644cde3', query: 'agency, judgment, externals' }],
  ['search_within_book', { book_id: '69ae95b87f0f0e8879510aaf', query: 'βούλει πλούσιόν τινα ποιῆσαι' }],
  ['search_within_book', { book_id: 'b7', query: 'translator preface', lang: 'fr' }],
  ['search_within_book', { book_id: 'b8', query: 'blind book' }],
  ['search_within_book', { book_id: 'b9', query: 'server error please' }],
];

describe('MCP search tools: in-process output is byte-identical to the HTTP self-call (#6853)', () => {
  beforeEach(async () => {
    fetched.length = 0;
    routed.length = 0;
    (await import('@/lib/mcp-inprocess')).clearInProcessCache();
  });
  afterAll(() => { delete process.env.MCP_INPROCESS; });

  for (const [tool, args] of QUERIES) {
    it(`${tool} ${JSON.stringify(args)}`, async () => {
      process.env.MCP_INPROCESS = '0';
      const old = await callTool(tool, args);
      expect(routed).toHaveLength(0);
      const oldUrls = [...fetched];
      expect(oldUrls).toHaveLength(1);

      delete process.env.MCP_INPROCESS;
      fetched.length = 0;
      const now = await callTool(tool, args);
      expect(fetched).toHaveLength(0);
      expect(routed.map((r) => r.url)).toEqual(oldUrls);
      expect(now).toBe(old);
    });
  }

  it('carries the caller downstream: identity as the handler argument, IP as x-forwarded-for, the MCP user agent', async () => {
    await callTool('search_library', { query: 'Paracelsus identity' });
    await callTool('search_concept', { query: 'Paracelsus identity' });
    expect(routed[0]).toMatchObject({ ua: expect.stringMatching(/^SourceLibrary-MCP\//), xff: CALLER_IP, identity: IDENTITY });
    // The semantic route takes no identity argument; search-log reads it from inprocess-caller.
    expect(routed[1]).toMatchObject({ ua: expect.stringMatching(/^SourceLibrary-MCP\//), xff: CALLER_IP });
  });

  it('search_within_book hands the route its book id as the dynamic segment, and never caches (the route sends no s-maxage)', async () => {
    bookParams.length = 0;
    await callTool('search_within_book', { book_id: '69ae95b87f0f0e8879510aaf', query: 'twice' });
    await callTool('search_within_book', { book_id: '69ae95b87f0f0e8879510aaf', query: 'twice' });
    expect(bookParams).toEqual(['69ae95b87f0f0e8879510aaf', '69ae95b87f0f0e8879510aaf']);
    expect(routed).toHaveLength(2);
    expect(routed[0]).toMatchObject({ ua: expect.stringMatching(/^SourceLibrary-MCP\//), xff: CALLER_IP });
    expect(fetched).toHaveLength(0);
  });

  it('a book_id the route could not be handed (a slash, a malformed %-escape) goes over HTTP, as before', async () => {
    const { inProcessEnabled } = await import('@/lib/mcp-inprocess');
    expect(inProcessEnabled('/books/abc/search')).toBe(true);
    expect(inProcessEnabled('/books/%E0%A4%A/search')).toBe(false);
    expect(inProcessEnabled('/books/a/b/search')).toBe(false);
  });

  it('answers a repeat from the 60 s cache, but never caches a no-store (partial) answer', async () => {
    const a = await callTool('search_concept', { query: 'repeat me' });
    const b = await callTool('search_concept', { query: 'repeat me' });
    expect(b).toBe(a);
    expect(routed).toHaveLength(1);

    await callTool('search_translations', { query: 'partial again' });
    await callTool('search_translations', { query: 'partial again' });
    expect(routed).toHaveLength(3);
  });

  it('gives concurrent identical calls one backend run', async () => {
    const [a, b] = await Promise.all([
      callTool('search_library', { query: 'together' }),
      callTool('search_library', { query: 'together' }),
    ]);
    expect(b).toBe(a);
    expect(routed).toHaveLength(1);
  });
});
