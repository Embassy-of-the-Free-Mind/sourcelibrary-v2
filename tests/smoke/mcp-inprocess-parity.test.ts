/**
 * Live parity for #6853: the search tools on a deployment that runs the search
 * routes IN-PROCESS answer byte-for-byte what a deployment that still SELF-CALLS
 * over HTTP answers, for ten fixed queries against the same database.
 *
 * tests/unit/mcp-inprocess-parity.test.ts proves the same on a canned backend
 * in CI; this proves it on the real one.
 *
 *   PARITY_NEW_BASE=https://<preview>.vercel.app \
 *   PARITY_OLD_BASE=https://sourcelibrary-v2-<hash>-dereklomas-projects.vercel.app \
 *   npx vitest run --config vitest.smoke.config.ts tests/smoke/mcp-inprocess-parity.test.ts
 *
 * PARITY_OLD_BASE defaults to production, which is the old code only until
 * #6853 ships; after that, point it at a pre-#6853 deployment URL (`vercel ls`).
 * Skipped unless PARITY_NEW_BASE is set.
 *
 * Search is not perfectly repeatable: a lane that times out returns a
 * `partial` answer with fewer rows (and is never cached). Each query is
 * therefore warmed on both sides first, compared up to three times, and a
 * pair is only judged when neither side is partial.
 */
import { describe, it, expect } from 'vitest';

const NEW_BASE = process.env.PARITY_NEW_BASE;
const OLD_BASE = process.env.PARITY_OLD_BASE || 'https://sourcelibrary.org';
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

const QUERIES: Array<[string, Record<string, unknown>]> = [
  ['search_library', { query: 'Paracelsus', limit: 5 }],
  ['search_library', { query: 'emerald tablet', language: 'Latin', year_from: 1500, year_to: 1700 }],
  ['search_library', { query: 'Kepler harmony', sort: 'date_asc' }],
  ['search_translations', { query: 'prima materia', limit: 5 }],
  ['search_translations', { query: 'the philosophers stone', diversity: 'off', limit: 8 }],
  ['search_translations', { query: 'daemon', languages: ['Latin', 'Greek'] }],
  ['search_concept', { query: 'the soul ascends through the planetary spheres', limit: 5 }],
  ['search_concept', { query: 'memory palace', year_from: 1400, year_to: 1650, diversity: 'off' }],
  ['search_concept', { query: 'transmutation of metals', max_per_book: 1, limit: 6 }],
  ['search_concept', { query: 'divine light emanation', diversity: 'author' }],
];

async function call(base: string, name: string, args: Record<string, unknown>): Promise<{ text: string; partial: boolean }> {
  const res = await fetch(`${base}/api/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const line = raw.split('\n').find((l) => l.startsWith('data: '));
  const body = JSON.parse(line ? line.slice(6) : raw);
  const text = JSON.stringify(body.result ?? body.error);
  return { text, partial: /\\"partial\\": true|"isError":true/.test(text) };
}

describe.skipIf(!NEW_BASE)(`MCP search parity: ${NEW_BASE} (in-process) vs ${OLD_BASE} (HTTP)`, () => {
  for (const [tool, args] of QUERIES) {
    it(`${tool} ${JSON.stringify(args)}`, async () => {
      await Promise.all([call(OLD_BASE, tool, args), call(NEW_BASE!, tool, args)]);
      let last: [string, string] = ['', ''];
      let judged = 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        const [o, n] = await Promise.all([call(OLD_BASE, tool, args), call(NEW_BASE!, tool, args)]);
        if (o.partial || n.partial) continue;
        judged++;
        last = [o.text, n.text];
        if (o.text === n.text) break;
      }
      expect(judged, 'every attempt came back partial on one side').toBeGreaterThan(0);
      expect(last[1]).toBe(last[0]);
    }, 120_000);
  }
});
