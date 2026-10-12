import { describe, it, expect, vi, afterEach } from 'vitest';

// The route's POST is wrapped in withApiAuth, which pulls in next-auth.
vi.mock('@/lib/api-auth', () => ({ withApiAuth: (h: (...a: unknown[]) => unknown) => (req: unknown) => h(req, {}, { tier: 'anonymous' }) }));
vi.mock('@/lib/mcp-usage', () => ({ logMcpToolCall: vi.fn(), logMcpInitialize: vi.fn() }));
vi.mock('@/lib/api-usage', () => ({ getPagesServedLast24h: vi.fn(async () => 0), logApiUsage: vi.fn() }));

// #4251: an agent searching "daemon" was never told that Zoroastrian texts say daēva and Arabic
// ones jinn, so it could not cross to them. tests/unit/concept-aliases.test.ts pins the
// vocabulary; this pins that the two passage tools HAND IT OVER, say it was not searched, and
// send the backend the caller's query unchanged. LIVE=1 runs it against production search.
const LIVE = process.env.LIVE === '1';

async function call(name: string, args: Record<string, unknown>) {
  const { POST } = await import('@/app/api/mcp/route');
  const res = await (POST as unknown as (r: Request) => Promise<Response>)(new Request('https://sourcelibrary.org/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }));
  const body = await res.json();
  return JSON.parse(body.result.content[0].text);
}

describe('MCP passage search hands over the curated concept vocabulary', () => {
  const seen: string[] = [];
  if (!LIVE) {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ query: 'x', total: 0, results: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
  }
  afterEach(() => { seen.length = 0; });

  for (const tool of ['search_translations', 'search_concept']) {
    it(`${tool}("daemon") names the other traditions' words and says they were not searched`, async () => {
      const out = await call(tool, { query: 'daemon' });
      expect(out.concept_vocabulary).toHaveLength(1);
      const v = out.concept_vocabulary[0];
      expect(v).toMatchObject({ concept: 'daimōn', matched_on: 'daemon' });
      expect(v.same_word).toContain('δαίμων');
      expect(v.other_renderings).toEqual(expect.arrayContaining(['daemones', 'demon']));
      expect(v.related_terms).toEqual(expect.arrayContaining(['daeva', 'jinn', 'shedim', 'bdud']));
      expect(out.concept_vocabulary_note).toMatch(/NOT searched/);
      expect(out.concept_vocabulary_note).toMatch(/NOT synonyms/);
      if (!LIVE) {
        // The query reaches the backend as sent: nothing is expanded on the caller's behalf.
        const sent = seen.filter((u) => u.includes('/api/search'));
        expect(sent).toHaveLength(1);
        expect(new URL(sent[0]).searchParams.get('q')).toBe('daemon');
      }
    }, 60_000);

    it(`${tool} says nothing when the query names no curated concept`, async () => {
      const out = await call(tool, { query: 'ouroboros' });
      expect(out).not.toHaveProperty('concept_vocabulary');
      expect(out).not.toHaveProperty('concept_vocabulary_note');
      expect(Array.isArray(out.passages)).toBe(true);
    }, 60_000);
  }
});
