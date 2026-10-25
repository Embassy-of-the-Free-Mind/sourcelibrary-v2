import { describe, it, expect, vi, beforeEach } from 'vitest';

// #4307: get_quote, get_quotes and get_book_text used to fetch
// https://sourcelibrary.org/api/books/<id>/{quote,text} with no identity, so
// the route's page budget charged ONE anonymous pool shared by every MCP user,
// and a keyed caller was refused once strangers had spent it. They now run the
// route body in-process as the caller. These tests pin that the caller's
// identity and IP reach the route, and that nothing goes over the wire.

vi.mock('@/lib/api-auth', () => ({ withApiAuth: (h: (...a: unknown[]) => unknown) => (req: unknown) => h(req, {}, IDENTITY) }));
vi.mock('@/lib/mcp-usage', () => ({ logMcpToolCall: vi.fn(), logMcpInitialize: vi.fn() }));
vi.mock('@/lib/api-usage', () => ({ getPagesServedLast24h: vi.fn(async () => 0), logApiUsage: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  getClientIp: (r: Request) => r.headers.get('x-forwarded-for') || 'unknown',
  peekRateLimit: () => ({ count: 0, limit: 60, remaining: 60, resetAt: 0 }),
}));

const IDENTITY = { kind: 'apikey', apiKeyId: 'k1', userId: 'u1', apiKeyTier: 'free' } as const;
const CALLER_IP = '198.51.100.7';

const routed: Array<{ route: string; id: string; url: string; xff: string | null; identity: unknown }> = [];

const { makeHandler } = vi.hoisted(() => ({
  makeHandler: (routeName: string, body: (url: URL) => { status: number; text: string; type: string }) =>
    async (req: Request, ctx: { params: Promise<{ id: string }> }, identity?: unknown) => {
      routed.push({ route: routeName, id: (await ctx.params).id, url: req.url, xff: req.headers.get('x-forwarded-for'), identity: identity ?? null });
      const b = body(new URL(req.url));
      return new Response(b.text, { status: b.status, headers: { 'Content-Type': b.type } });
    },
}));

vi.mock('@/app/api/books/[id]/quote/route', () => {
  const handler = makeHandler('quote', (u) => u.searchParams.get('page') === '999'
    ? { status: 429, text: JSON.stringify({ error: 'Daily page budget reached' }), type: 'application/json' }
    : {
      status: 200,
      type: 'application/json',
      text: JSON.stringify({
        citation_link: 'https://sourcelibrary.org/q/abc',
        quote: { translation: `Page ${u.searchParams.get('page')} text.`, original: 'Textus.', page: Number(u.searchParams.get('page')), book_id: 'b1' },
        citation: { locator: `p. ${u.searchParams.get('page')}`, short_url: 'https://sourcelibrary.org/q/abc' },
      }),
    });
  return { GET: Object.assign(() => { throw new Error('the gated route must not run in-process'); }, { handler }) };
});
vi.mock('@/app/api/books/[id]/text/route', () => {
  const handler = makeHandler('text', (u) => u.searchParams.get('format') === 'plain'
    ? { status: 200, text: '[Page 1]\nPlain text.', type: 'text/plain' }
    : { status: 200, text: JSON.stringify({ book_id: 'b1', pages_returned: 1, truncated: false, pages: [{ page: 1, text: 'One.' }] }), type: 'application/json' });
  return { GET: Object.assign(() => { throw new Error('the gated route must not run in-process'); }, { handler }) };
});

const fetched: string[] = [];
vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
  fetched.push(String(input));
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
}));

beforeEach(async () => {
  routed.length = 0;
  fetched.length = 0;
  delete process.env.MCP_INPROCESS;
  (await import('@/lib/mcp-inprocess')).clearInProcessCache();
});

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const { POST } = await import('@/app/api/mcp/route');
  const res = await (POST as unknown as (r: Request) => Promise<Response>)(new Request('https://sourcelibrary.org/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'x-forwarded-for': CALLER_IP },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }));
  return res.text();
}

const apiFetches = () => fetched.filter((u) => u.startsWith('https://sourcelibrary.org/api/books/'));

describe('text tools run in-process as the caller (#4307)', () => {
  it('get_quote reaches the quote route with the caller identity and IP, not over HTTP', async () => {
    const out = await callTool('get_quote', { book_id: 'b1', page: 12 });
    expect(out).toContain('Page 12 text.');
    expect(routed).toEqual([expect.objectContaining({ route: 'quote', id: 'b1', xff: CALLER_IP, identity: IDENTITY })]);
    expect(apiFetches()).toEqual([]);
  });

  it('get_quotes sends every page in-process as the caller', async () => {
    await callTool('get_quotes', { book_id: 'b1', pages: [3, 4] });
    expect(routed.map((r) => [r.route, new URL(r.url).searchParams.get('page'), r.identity])).toEqual([
      ['quote', '3', IDENTITY],
      ['quote', '4', IDENTITY],
    ]);
    expect(apiFetches()).toEqual([]);
  });

  it('get_book_text json and plain both run in-process as the caller', async () => {
    await callTool('get_book_text', { book_id: 'b1', from: 1, to: 1 });
    const plain = await callTool('get_book_text', { book_id: 'b1', from: 1, to: 1, format: 'plain' });
    expect(plain).toContain('Plain text.');
    expect(routed.map((r) => [r.route, r.identity])).toEqual([['text', IDENTITY], ['text', IDENTITY]]);
    expect(apiFetches()).toEqual([]);
  });

  it('a 429 from the route still classifies as rate_limited', async () => {
    const out = await callTool('get_quote', { book_id: 'b1', page: 999 });
    expect(out).toContain('rate_limited');
  });

  it('MCP_INPROCESS=0 sends the quote back over HTTP', async () => {
    process.env.MCP_INPROCESS = '0';
    await callTool('get_quote', { book_id: 'b1', page: 5 });
    expect(routed).toEqual([]);
    expect(apiFetches()).toEqual([expect.stringContaining('/api/books/b1/quote?page=5')]);
  });
});
