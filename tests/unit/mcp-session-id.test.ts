import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// withApiAuth pulls in next-auth; pass the handler through with an anonymous caller.
vi.mock('@/lib/api-auth', () => ({
  withApiAuth: (h: (req: unknown, ctx: unknown, identity: unknown) => Promise<Response>) =>
    (req: unknown) => h(req, {}, { kind: 'anon' }),
}));

const initializeBody = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'session-test', version: '1.0.0' },
  },
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://sourcelibrary.org/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('MCP session id', () => {
  beforeEach(() => vi.resetModules());

  it('issues an id on initialize, and the handshake still answers normally', async () => {
    const { POST } = await import('@/app/api/mcp/route');
    const res = await (POST as unknown as (r: NextRequest) => Promise<Response>)(post(initializeBody));
    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toMatch(/^[0-9a-f-]{36}$/);
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe('source-library');
  });

  it('accepts a later request carrying that id, and one with none (the server stays stateless)', async () => {
    const { POST } = await import('@/app/api/mcp/route');
    const call = POST as unknown as (r: NextRequest) => Promise<Response>;
    const list = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
    const version = { 'mcp-protocol-version': '2025-06-18' };

    const withId = await call(post(list, { ...version, 'mcp-session-id': 'a-session-id-from-a-restart' }));
    expect(withId.status).toBe(200);
    expect(withId.headers.get('mcp-session-id')).toBeNull();

    const withoutId = await call(post(list, version));
    expect(withoutId.status).toBe(200);
    expect((await withoutId.json()).result.tools.length).toBeGreaterThan(0);
  });
});

describe('a real MCP client against the route', () => {
  it('echoes the id on later requests, and closing cleanly survives our 405 on DELETE', async () => {
    const { POST, DELETE } = await import('@/app/api/mcp/route');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

    const seen: Array<{ method: string; session: string | null }> = [];
    const fetchIntoRoute: typeof fetch = async (input, init) => {
      const req = new Request(input as string, init);
      seen.push({ method: req.method, session: req.headers.get('mcp-session-id') });
      if (req.method === 'POST') return (POST as unknown as (r: Request) => Promise<Response>)(req);
      if (req.method === 'DELETE') return DELETE();
      return new Response(null, { status: 405 });
    };

    const transport = new StreamableHTTPClientTransport(new URL('https://sourcelibrary.org/api/mcp'), { fetch: fetchIntoRoute });
    const client = new Client({ name: 'session-test', version: '1.0.0' });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);

    const issued = transport.sessionId;
    expect(issued).toMatch(/^[0-9a-f-]{36}$/);
    const posts = seen.filter((r) => r.method === 'POST');
    expect(posts[0].session).toBeNull();
    expect(posts.slice(1).length).toBeGreaterThan(0);
    expect(posts.slice(1).every((r) => r.session === issued)).toBe(true);

    await expect(transport.terminateSession()).resolves.toBeUndefined();
    await client.close();
  });
});

describe('readMcpSessionId', () => {
  it('drops a value that is not shaped like an id, so junk never reaches the log', async () => {
    const { readMcpSessionId } = await import('@/lib/mcp-usage');
    const read = (v: string) => readMcpSessionId(new Headers({ 'mcp-session-id': v }));
    expect(read('abcd1234-ef')).toBe('abcd1234-ef');
    expect(read('short')).toBeNull();
    expect(read('has spaces in it')).toBeNull();
    expect(read('x'.repeat(129))).toBeNull();
    expect(readMcpSessionId(new Headers())).toBeNull();
  });
});

describe('countToolResults', () => {
  it('tells an empty result from a result whose shape says nothing', async () => {
    const { countToolResults } = await import('@/lib/mcp-usage');
    expect(countToolResults({ total_matches: 0, passages: [] })).toBe(0);
    expect(countToolResults({ total: 12, returned: 5 })).toBe(12);
    expect(countToolResults({ images: [{}, {}] })).toBe(2);
    expect(countToolResults({ title: 'A book' })).toBeNull();
    expect(countToolResults('plain text')).toBeNull();
    expect(countToolResults(null)).toBeNull();
  });
});
