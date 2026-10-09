/**
 * Run the REAL /api/search handler on this checkout against production data,
 * for the 30 eval queries, and save the raw responses for run.mjs to score.
 *
 * PRIOR ART: scripts/eval/librarian-search/variants.mjs — re-implements each
 * search variant in a script; a copy of the route's lanes drifts from the
 * route. The route cannot be imported under tsx (the auth adapter is ESM-only),
 * so this goes through vitest, which can, with the auth wrapper and the two
 * loggers stubbed. Nothing is written to any store.
 *
 *   OUT=/tmp/after.json node --env-file=.env.production.local node_modules/.bin/vitest run \
 *     --config scripts/eval/search-recall/local/vitest.config.mts
 *   node scripts/eval/search-recall/run.mjs --from /tmp/after.json --out after-scored.json
 *
 * Env: OUT (required), EXTRA (query-string suffix, e.g. "&ranking=rrf"),
 * ONLY (substring of a query id), LIMIT (default 20).
 * Reads prod Mongo and Supabase and calls the embedding API once per query.
 */
import { vi, test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { NextRequest } from 'next/server';

const logged: Array<{ stage_ms?: Record<string, number> }> = [];
vi.mock('@/lib/api-auth', () => ({ withApiAuth: (h: any) => (req: any, ctx: any) => h(req, ctx, null) }));
vi.mock('@/lib/search-log', () => ({ logSearchQuery: (x: any) => { logged.push({ stage_ms: x.stage_ms }); } }));
vi.mock('@/lib/search-event-log', () => ({ logSearchEvent: () => {} }));

test('run the eval queries through the route', async () => {
  if (!process.env.OUT) throw new Error('set OUT=<file> for the raw responses');
  const { GET } = await import('@/app/api/search/route');
  const { queries } = JSON.parse(readFileSync('scripts/eval/search-recall/queries.json', 'utf8'));
  const out: Record<string, unknown> = {};
  for (const q of queries) {
    if (process.env.ONLY && !q.id.includes(process.env.ONLY)) continue;
    const started = Date.now();
    const url = `http://localhost/api/search?q=${encodeURIComponent(q.query)}&limit=${process.env.LIMIT || 20}${process.env.EXTRA || ''}`;
    const res = await (GET as any)(new NextRequest(url), { params: Promise.resolve({}) });
    const body = await res.json();
    out[q.id] = { ...body, _ms: Date.now() - started, _stage_ms: logged.at(-1)?.stage_ms };
  }
  writeFileSync(process.env.OUT, JSON.stringify(out));
});
