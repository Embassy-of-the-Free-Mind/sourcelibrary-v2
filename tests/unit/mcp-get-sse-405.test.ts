import { describe, it, expect, vi } from 'vitest';

// The route's POST is wrapped in withApiAuth, which pulls in next-auth; GET
// never touches it.
vi.mock('@/lib/api-auth', () => ({ withApiAuth: (h: unknown) => h }));

// #4753: MCP clients that got a 200 JSON banner to their SSE GET reconnected in
// a loop, 4.4M requests a week. The spec allows an event stream or 405.
describe('GET /api/mcp', () => {
  it('answers an SSE GET with 405, so the client stops reconnecting', async () => {
    const { GET } = await import('@/app/api/mcp/route');
    const res = await GET(new Request('https://sourcelibrary.org/api/mcp', {
      headers: { Accept: 'application/json, text/event-stream' },
    }));
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).not.toMatch(/GET/);
  });

  it('still shows the banner to a browser', async () => {
    const { GET } = await import('@/app/api/mcp/route');
    const res = await GET(new Request('https://sourcelibrary.org/api/mcp', {
      headers: { Accept: 'text/html,application/xhtml+xml' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('source-library');
    expect(Array.isArray(body.tools)).toBe(true);
  });
});
