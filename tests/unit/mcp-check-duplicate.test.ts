import { describe, it, expect, vi, beforeEach } from 'vitest';

// The route's POST is wrapped in withApiAuth, which pulls in next-auth.
vi.mock('@/lib/api-auth', () => ({ withApiAuth: (h: unknown) => h }));

// #4250: "do you hold X?" had no answer on the hosted connector — list_books
// and search_library negatives were read as absence. check_duplicate proxies
// the public holdings route (#6019).
const calls: string[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ verdict: 'possible_same_edition', confidence: 'high', matches: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }));
});

async function rpc(body: unknown) {
  const { POST } = await import('@/app/api/mcp/route');
  const req = new Request('https://sourcelibrary.org/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const res = await (POST as unknown as (r: Request, c: unknown, i: unknown) => Promise<Response>)(req, {}, { kind: 'anon' });
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('data: '));
  return JSON.parse(line ? line.slice(6) : text);
}

describe('MCP check_duplicate', () => {
  it('is listed as a read-only tool', async () => {
    const out = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tool = out.result.tools.find((t: { name: string }) => t.name === 'check_duplicate');
    expect(tool).toBeTruthy();
    expect(tool.title).toBeTruthy();
    expect(tool.annotations.readOnlyHint).toBe(true);
  });

  it('passes title, author and year to the public holdings route', async () => {
    const out = await rpc({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'check_duplicate', arguments: { title: 'Musurgia universalis', author: 'Kircher', year: 1650 } },
    });
    const hit = calls.find((u) => u.includes('/api/books/check-duplicate'));
    expect(hit).toBeTruthy();
    const q = new URL(hit!).searchParams;
    expect(q.get('title')).toBe('Musurgia universalis');
    expect(q.get('author')).toBe('Kircher');
    expect(q.get('year')).toBe('1650');
    expect(JSON.stringify(out.result)).toContain('possible_same_edition');
  });

  it('refuses an empty query without calling the backend', async () => {
    const out = await rpc({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'check_duplicate', arguments: { title: 'x' } },
    });
    expect(calls.some((u) => u.includes('/api/books/check-duplicate'))).toBe(false);
    expect(JSON.stringify(out.result)).toMatch(/Provide a title/);
  });
});
