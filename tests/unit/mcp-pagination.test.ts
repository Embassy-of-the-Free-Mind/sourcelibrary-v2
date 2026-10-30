import { describe, it, expect, vi } from 'vitest';
import { pageEnvelope, parseOffset } from '@/lib/mcp-pagination';

// The route's POST is wrapped in withApiAuth, which pulls in next-auth.
vi.mock('@/lib/api-auth', () => ({ withApiAuth: (h: (...a: unknown[]) => unknown) => (req: unknown) => h(req, {}, { tier: 'anonymous' }) }));
vi.mock('@/lib/mcp-usage', () => ({ logMcpToolCall: vi.fn(), logMcpInitialize: vi.fn() }));
vi.mock('@/lib/api-usage', () => ({ getPagesServedLast24h: vi.fn(async () => 0), logApiUsage: vi.fn() }));

// #7624: a list cut at the tool's limit, returned without saying so, reads as the whole holding.
// A 100-row Vives listing hid the 1555 Opera past the cut; an MCP agent had to sort list_books
// both ways to see all 82 Kircher records because the tool declared no offset.

describe('pageEnvelope', () => {
  it('says a page short of the total is truncated and names the next offset', () => {
    const e = pageEnvelope({ total: 382, returned: 50, offset: 0, limit: 50 });
    expect(e).toMatchObject({ total: 382, returned: 50, offset: 0, next_offset: 50, truncated: true });
    expect(e.truncation_note).toMatch(/NOT the full set/);
    expect(e.truncation_note).toMatch(/offset=50/);
  });

  it('says the last page is not truncated', () => {
    const e = pageEnvelope({ total: 382, returned: 32, offset: 350, limit: 50 });
    expect(e).toMatchObject({ next_offset: null, truncated: false });
    expect(e.truncation_note).toBeUndefined();
  });

  it('treats a full page with no known total as "there may be more", never as the end', () => {
    expect(pageEnvelope({ total: null, returned: 100, offset: 0, limit: 100 })).toMatchObject({ truncated: true, next_offset: 100 });
    expect(pageEnvelope({ total: null, returned: 7, offset: 0, limit: 100 })).toMatchObject({ truncated: false });
  });

  it('a timed-out count is a lower bound: a full page stays truncated even at the bound', () => {
    const e = pageEnvelope({ total: 200, returned: 200, offset: 0, limit: 200, totalIsLowerBound: true });
    expect(e.truncated).toBe(true);
    expect(e.truncation_note).toMatch(/at least 200/);
  });

  it('an empty result is not truncated', () => {
    expect(pageEnvelope({ total: 0, returned: 0, offset: 0, limit: 10 })).toMatchObject({ truncated: false, next_offset: null });
  });

  it('parses offsets defensively', () => {
    expect(parseOffset(undefined)).toBe(0);
    expect(parseOffset(-5)).toBe(0);
    expect(parseOffset('40')).toBe(40);
    expect(parseOffset(12.9)).toBe(12);
  });
});

// Tools that cap a list but deliberately take no offset, with the reason. Adding a capped tool
// to this list is a decision; forgetting to declare offset is the bug this test exists to catch.
const NO_OFFSET_BY_DESIGN: Record<string, string> = {
  search_concept: 'nearest-neighbour ranking with no corpus count; it says so in count_note',
  get_quotes: 'takes an explicit list of pages, not a ranked list',
  list_image_facets: 'reports matched vs listed_values per facet, so the cut is visible; narrow with contains',
};

describe('every capped MCP list tool can page', () => {
  it('declares offset wherever it declares limit', async () => {
    const { POST } = await import('@/app/api/mcp/route');
    const res = await (POST as unknown as (r: Request) => Promise<Response>)(new Request('https://sourcelibrary.org/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }));
    const text = await res.text();
    const json = JSON.parse(text.startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data:'))!.slice(5));
    const tools = json.result.tools as Array<{ name: string; inputSchema: { properties?: Record<string, unknown> } }>;
    expect(tools.length).toBeGreaterThan(5);
    const missing = tools
      .filter((t) => t.inputSchema.properties?.limit && !t.inputSchema.properties?.offset && !NO_OFFSET_BY_DESIGN[t.name])
      .map((t) => t.name);
    expect(missing).toEqual([]);
  });
});
