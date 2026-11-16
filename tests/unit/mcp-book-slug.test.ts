import { describe, it, expect, vi, beforeEach } from 'vitest';

// The connector's links are /book/<slug>, so a model passes the slug as
// `book_id`. Three tools hand `book_id` to a route that filters pages or
// pictures by the book's id, and build links from it: with a slug they
// answered "nothing found" (v2#8154). These fail if a slug reaches one of
// those routes unresolved, if a call by id starts paying for a lookup, or if
// the tool's links are built from the slug.

const ID = '69c79da6732b9d1f2b38170b';
const SLUG = 'de-perenni-philosophia-steuco';

const seen = vi.hoisted(() => ({
  dbOpens: 0,
  bookQueries: [] as Array<Record<string, unknown>>,
  routed: [] as Array<{ route: string; id?: string; url: string }>,
  dbFails: false,
}));

const fakeDb = {
  collection: () => ({
    findOne: async (f: Record<string, unknown>) => {
      if (seen.dbFails) throw new Error('DB connection timeout');
      seen.bookQueries.push(f);
      return f.slug === SLUG ? { id: ID } : null;
    },
  }),
};
vi.mock('@/lib/mongodb', () => ({ getDb: async () => fakeDb, getReadDb: async () => { seen.dbOpens++; return fakeDb; }, default: Promise.resolve({ db: () => fakeDb }) }));
vi.mock('@/lib/api-auth', () => ({ withApiAuth: (h: (...a: unknown[]) => unknown) => (req: unknown) => h(req, {}, { kind: 'anon' }) }));
vi.mock('@/lib/mcp-usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp-usage')>()),
  logMcpToolCall: vi.fn(),
  logMcpInitialize: vi.fn(),
}));
vi.mock('@/lib/api-usage', () => ({ getPagesServedLast24h: vi.fn(async () => 0), logApiUsage: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  getClientIp: (r: Request) => r.headers.get('x-forwarded-for') || 'unknown',
  peekRateLimit: () => ({ count: 0, limit: 60, remaining: 60, resetAt: 0 }),
}));

vi.mock('@/app/api/books/[id]/search/route', () => ({
  GET: async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    seen.routed.push({ route: 'book-search', id: (await ctx.params).id, url: req.url });
    return Response.json({ query: 'mercury', total: 1, returned: 1, lang: 'en', results: [{ pageNumber: 7, matches: [{ field: 'translation', snippet: 'mercury here' }] }] });
  },
}));
vi.mock('@/app/api/search/route', () => {
  const handler = async (req: Request) => {
    seen.routed.push({ route: 'search', url: req.url });
    return Response.json({ results: [], total: 0 });
  };
  return { GET: Object.assign(() => { throw new Error('the gated route must not run in-process'); }, { handler }) };
});
vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
  seen.routed.push({ route: 'http', url: String(input) });
  return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}));

beforeEach(async () => {
  Object.assign(seen, { dbOpens: 0, bookQueries: [], routed: [], dbFails: false });
  delete process.env.MCP_INPROCESS;
  (await import('@/lib/mcp-inprocess')).clearInProcessCache();
});

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const { POST } = await import('@/app/api/mcp/route');
  const res = await (POST as unknown as (r: Request) => Promise<Response>)(new Request('https://sourcelibrary.org/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'x-forwarded-for': '198.51.100.7' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }));
  return res.text();
}

describe('a slug in book_id is the book', () => {
  it('search_within_book searches the book by id and builds its links from the id', async () => {
    const out = await callTool('search_within_book', { book_id: SLUG, query: 'mercury' });
    expect(seen.routed.filter((r) => r.route === 'book-search').map((r) => r.id)).toEqual([ID]);
    // A short link encodes the book id; built from a slug it cannot be made.
    expect(out).toContain('sourcelibrary.org/q/');
    expect(out).toContain(`/book/${ID}?page=7`);
  });

  it('search_translations filters by the id', async () => {
    await callTool('search_translations', { book_id: SLUG, query: 'mercury' });
    const urls = seen.routed.filter((r) => r.route === 'search').map((r) => new URL(r.url).searchParams.get('book_id'));
    expect(urls).toEqual([ID]);
  });

  it('search_images filters by the id', async () => {
    await callTool('search_images', { book_id: SLUG, query: 'dragon' });
    const gallery = seen.routed.map((r) => new URL(r.url)).filter((u) => u.searchParams.has('bookId'));
    expect(gallery.length).toBeGreaterThan(0);
    expect(gallery.every((u) => u.searchParams.get('bookId') === ID)).toBe(true);
  });

  it('a call by id asks the database nothing, and opens no connection', async () => {
    await callTool('search_within_book', { book_id: ID, query: 'mercury' });
    await callTool('search_translations', { book_id: ID, query: 'mercury' });
    expect(seen.bookQueries).toEqual([]);
    expect(seen.dbOpens).toBe(0);
    expect(seen.routed.filter((r) => r.route === 'book-search').map((r) => r.id)).toEqual([ID]);
  });

  it('a slug that names no book goes through as sent, so the route answers as before', async () => {
    await callTool('search_within_book', { book_id: 'no-such-book', query: 'mercury' });
    expect(seen.routed.filter((r) => r.route === 'book-search').map((r) => r.id)).toEqual(['no-such-book']);
  });

  it('a failed lookup does not fail the tool', async () => {
    seen.dbFails = true;
    await callTool('search_within_book', { book_id: SLUG, query: 'mercury' });
    expect(seen.routed.filter((r) => r.route === 'book-search').map((r) => r.id)).toEqual([SLUG]);
  });
});
