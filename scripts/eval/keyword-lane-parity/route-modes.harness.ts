/**
 * The REAL /api/search handler in each KEYWORD_SEARCH_MODE (#6852), against production data and a running
 * keyword service: what readers would get (off vs serve), and what shadow logs (`keyword_shadow`).
 * Checks the route wiring end to end — that serve returns pages and records `keyword_lane: served`,
 * that shadow returns Atlas's pages and hands the logger a comparison, and that off never calls the service.
 *
 * PRIOR ART: scripts/eval/search-recall/local/route.harness.ts — runs this handler for 30 queries and saves
 * the responses; it has no mode switch and does not capture what the route logs.
 *
 *   OUT=$JOB_SCRATCH/route-modes.json KEYWORD_SEARCH_URL=http://127.0.0.1:3460 KEYWORD_SEARCH_TOKEN=<token> \
 *     node --env-file=/root/sourcelibrary/.env.production.local node_modules/.bin/vitest run \
 *     --config scripts/eval/keyword-lane-parity/vitest.config.mts route-modes.harness
 *
 * Env: OUT, KEYWORD_SEARCH_URL / _TOKEN (the service), QUERIES (JSON array; default a fixed mix).
 * The two semantic lanes are stubbed empty: they would embed every query with a paid model, and they are
 * not what this checks. So the responses are the keyword lanes' (book + page + canon). Writes no store.
 */
import { vi, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { NextRequest } from 'next/server';

const logged: any[] = [];
vi.mock('@/lib/api-auth', () => ({ withApiAuth: (h: any) => (req: any, ctx: any) => h(req, ctx, null) }));
vi.mock('@/lib/anon-gate', () => ({ anonSearchGate: async () => ({ allowed: true }), ANON_SEARCHES_PER_HOUR: 10, SIGNIN_URL: '' }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ allowed: true }), getClientIp: () => '127.0.0.1' }));
vi.mock('@/lib/search-log', () => ({ logSearchQuery: (x: any) => { logged.push(x); } }));
vi.mock('@/lib/search-event-log', () => ({ logSearchEvent: () => {} }));
// No model calls: the semantic lanes would embed the query (paid). Everything else is the real code.
vi.mock('@/lib/semantic-search', async (orig) => ({ ...(await orig() as object), semanticBookSearch: async () => [] }));
vi.mock('@/lib/search/concept-search', async (orig) => ({ ...(await orig() as object), conceptPageSearch: async () => ({ rows: [], diversity: 'off', lanes: { untranslated: 'off' }, traditions: {} }) }));

const QUERIES: string[] = JSON.parse(process.env.QUERIES || '["Drebbel", "prima materia", "\\"philosophers stone\\"", "melancholia", "Paracelsus plague", "道德經"]');

test('route in each keyword mode', async () => {
  if (!process.env.OUT) throw new Error('set OUT=<file>');
  const { GET } = await import('@/app/api/search/route') as any;
  const out: any[] = [];
  for (const q of QUERIES) {
    const row: any = { q };
    for (const mode of ['off', 'shadow', 'serve']) {
      process.env.KEYWORD_SEARCH_MODE = mode;
      logged.length = 0;
      const t = performance.now();
      const res = await GET(new NextRequest(`http://localhost/api/search?q=${encodeURIComponent(q)}&limit=20`), { params: Promise.resolve({}) });
      const body = await res.json();
      const ms = Math.round(performance.now() - t);
      const log = logged[0] || {};
      const shadow = log.keyword_shadow ? await log.keyword_shadow : null;
      const pages = (body.results || []).filter((r: any) => r.type === 'page');
      row[mode] = {
        ms, page_stage_ms: log.stage_ms?.page, total: body.total, pages: pages.length,
        page_keys: pages.map((r: any) => `${r.book_id}:${r.page_number}`),
        snippets_ok: pages.every((r: any) => typeof r.snippet === 'string' && r.snippet.length > 0),
        keyword_lane: log.filters?.keyword_lane ?? null, degraded: body.degraded_lanes ?? null, shadow,
      };
    }
    const off = new Set(row.off.page_keys), serve = row.serve.page_keys;
    row.serve_vs_off_page_overlap = off.size ? serve.filter((k: string) => off.has(k)).length / off.size : null;
    console.log(JSON.stringify({ q, off: [row.off.ms, row.off.page_stage_ms, row.off.pages], shadow: row.shadow.shadow, serve: [row.serve.ms, row.serve.page_stage_ms, row.serve.pages, row.serve.keyword_lane], overlap: row.serve_vs_off_page_overlap }));
    out.push(row);
  }
  writeFileSync(process.env.OUT, JSON.stringify(out, null, 2));
});
