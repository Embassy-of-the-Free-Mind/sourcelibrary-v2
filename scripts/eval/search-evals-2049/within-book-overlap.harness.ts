/**
 * The keyword page service for one book (#2049, job within-book-speed): overlap and latency
 * against today's Atlas leg, on real MCP calls. Two surfaces:
 *   wb  — search_within_book → /api/books/[id]/search
 *   st  — search_translations with a book_id → /api/search?pages_only=true&book_id=…
 * Each call runs the ROUTE HANDLER in-process twice, KEYWORD_SEARCH_MODE unset (Atlas, today)
 * and =serve (the service), alternating which arm goes first so each pays the cold reads on half
 * the calls. Scores:
 *   overlap@10  |top10(atlas) ∩ top10(served)| / |top10(atlas)|, by page number
 *   jaccard     over the whole returned lists
 *   ms          the handler, end to end, per arm
 * Read-only: the routes' search logs (analytics_events, search_queries) are swallowed, and any
 * other write throws. The within-book semantic leg embeds each query once (the in-process cache
 * serves the second arm): one Gemini call per wb call. st calls make none (no semantic lane
 * with a book_id).
 *
 * Sample: mcp_tool_calls, ok, the 14 days before CUTOFF, one row per distinct (book, query),
 * English, seeded shuffle, so every box draws the same calls without copying them anywhere.
 *
 * PRIOR ART: within-book.harness.ts (this directory) times the route's parts with Atlas only;
 * scripts/eval/keyword-lane-parity/route-modes.harness.ts compares the modes on the GLOBAL lane,
 * which never sends a book_id.
 *
 *   OUT=$JOB_SCRATCH/wb-overlap.json KEYWORD_SEARCH_URL=… KEYWORD_SEARCH_TOKEN=… \
 *     node --env-file=/root/sourcelibrary/.env.production.local node_modules/.bin/vitest run \
 *     --config scripts/eval/search-evals-2049/vitest.config.mts within-book-overlap
 * Env: OUT, N (default 30 per surface), ONLY (wb | st), CUTOFF (default 2026-10-18T22:00:00Z).
 */
import { test, vi } from 'vitest';
import { writeFileSync } from 'node:fs';

// next-auth does not load under this config. Neither arm has a session, so the gates reduce to
// what they decide for an anonymous caller: a hidden book is not readable, and /api/search's
// auth wrapper passes the request through.
vi.mock('@/lib/book-access', () => ({
  isBookReadable: async (b: { visible?: boolean | null } | null) => !!b && b.visible !== false,
}));
vi.mock('@/lib/api-auth', () => ({ withApiAuth: (h: (...a: unknown[]) => unknown) => Object.assign((r: unknown) => h(r, {}, { kind: 'anon' }), { handler: h }) }));
import { NextRequest } from 'next/server';
import type { Db } from 'mongodb';
import { getDb } from '@/lib/mongodb';
// @ts-expect-error — plain-JS module, no declarations
import { makeRng } from '../lib/paired-stats.mjs';

const N = +(process.env.N || 30);
const OUT = process.env.OUT;
const CUTOFF = new Date(process.env.CUTOFF || '2026-10-18T22:00:00Z');
const ONLY = process.env.ONLY; // wb | st

const LOG_COLLECTIONS = new Set(['analytics_events', 'search_queries', 'mcp_tool_calls', 'api_usage']);
const WRITES = ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'bulkWrite', 'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'createIndex', 'drop'];

/** The route's Db, made read-only: log writes vanish, any other write throws. */
function readOnly(db: Db): void {
  const collection = db.collection.bind(db);
  (db as unknown as { collection: unknown }).collection = (name: string, o?: unknown) => {
    const c = collection(name, o as never);
    return new Proxy(c, {
      get(t, k, r) {
        if (typeof k === 'string' && WRITES.includes(k)) {
          if (LOG_COLLECTIONS.has(name)) return async () => ({ acknowledged: true });
          return () => { throw new Error(`harness is read-only: ${name}.${k}`); };
        }
        const v = Reflect.get(t, k, r);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  };
}

interface Call { kind: 'wb' | 'st'; book_id: string; query: string; limit?: number }

async function sample(db: Db, tool: string, kind: Call['kind']): Promise<Call[]> {
  const rows = await db.collection('mcp_tool_calls')
    .find({ tool, ok: true, ts: { $gte: new Date(CUTOFF.getTime() - 14 * 864e5), $lt: CUTOFF }, 'args.book_id': { $exists: true } })
    .sort({ ts: 1 }).project({ args: 1 }).toArray();
  const seen = new Set<string>();
  const calls: Call[] = [];
  for (const r of rows) {
    const a = r.args as Record<string, unknown>;
    if ((a.lang && a.lang !== 'en') || !a.book_id || !a.query) continue;
    // search_translations: only the arguments that reach this lane unchanged.
    if (kind === 'st' && (a.language || a.languages || a.exclude_languages || a.year_from || a.year_to || a.author || a.offset)) continue;
    const c: Call = { kind, book_id: String(a.book_id), query: String(a.query).trim(), ...(kind === 'st' ? { limit: Math.min(Number(a.limit) || 20, 50) } : {}) };
    const k = `${c.book_id}\u0000${c.query}`;
    if (seen.has(k)) continue;
    seen.add(k);
    calls.push(c);
  }
  const rng = makeRng(2049);
  for (let i = calls.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [calls[i], calls[j]] = [calls[j], calls[i]]; }
  return calls.slice(0, N);
}

type Pages = number[];

/** Calls to the keyword service, so a row shows the served arm really reached it (and Atlas did not). */
let svcCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const base = process.env.KEYWORD_SEARCH_URL;
  if (base && String(input instanceof Request ? input.url : input).startsWith(base)) svcCalls++;
  return realFetch(input, init);
}) as typeof fetch;

async function run(c: Call, serve: boolean): Promise<{ ms: number; pages: Pages; total: number; svc: number; status: number }> {
  const svcBefore = svcCalls;
  if (serve) process.env.KEYWORD_SEARCH_MODE = 'serve'; else delete process.env.KEYWORD_SEARCH_MODE;
  const headers = { 'user-agent': 'SourceLibrary-eval/2049-within-book' };
  const t = performance.now();
  let res: Response;
  if (c.kind === 'wb') {
    const { GET } = await import('@/app/api/books/[id]/search/route');
    res = await GET(new NextRequest(`https://sourcelibrary.org/api/books/${c.book_id}/search?q=${encodeURIComponent(c.query)}`, { headers }), { params: Promise.resolve({ id: c.book_id }) });
  } else {
    const { GET } = await import('@/app/api/search/route');
    // As search_translations builds it (src/app/api/mcp/route.ts searchPassages).
    const p = new URLSearchParams({ q: c.query, pages_only: 'true', limit: String(Math.min(c.limit! * 3, 150)), offset: '0', book_id: c.book_id });
    const handler = (GET as unknown as { handler: (r: NextRequest, ctx: unknown, id: unknown) => Promise<Response> }).handler;
    res = await handler(new NextRequest(`https://sourcelibrary.org/api/search?${p}`, { headers }), {}, { kind: 'anon' });
  }
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  const ms = Math.round(performance.now() - t);
  const results = (body.results as Array<Record<string, unknown>>) || [];
  const pages = results.map((r) => Number(c.kind === 'wb' ? r.pageNumber : r.page_number));
  return { ms, pages, total: Number(body.total) || 0, svc: svcCalls - svcBefore, status: res.status };
}

const overlapAt = (a: Pages, b: Pages, k: number) => {
  const A = a.slice(0, k);
  if (A.length === 0) return b.length === 0 ? 1 : null;
  const B = new Set(b.slice(0, k));
  return A.filter((x) => B.has(x)).length / A.length;
};
const jaccard = (a: Pages, b: Pages) => {
  const A = new Set(a), B = new Set(b);
  const u = new Set([...A, ...B]).size;
  return u === 0 ? 1 : [...A].filter((x) => B.has(x)).length / u;
};
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

test('within-book overlap', async () => {
  if (!process.env.KEYWORD_SEARCH_URL || !process.env.KEYWORD_SEARCH_TOKEN) throw new Error('set KEYWORD_SEARCH_URL / KEYWORD_SEARCH_TOKEN');
  const db = await getDb();
  readOnly(db);
  const calls = [
    ...(ONLY === 'st' ? [] : await sample(db, 'search_within_book', 'wb')),
    ...(ONLY === 'wb' ? [] : await sample(db, 'search_translations', 'st')),
  ];
  const rows = [];
  let i = 0;
  for (const c of calls) {
    const serveFirst = i++ % 2 === 0;
    const first = await run(c, serveFirst);
    const second = await run(c, !serveFirst);
    const [atlas, served] = serveFirst ? [second, first] : [first, second];
    const row = {
      kind: c.kind, book_id: c.book_id, query: c.query, serve_first: serveFirst,
      atlas_ms: atlas.ms, served_ms: served.ms, atlas_n: atlas.pages.length, served_n: served.pages.length,
      atlas_total: atlas.total, served_total: served.total, status: [atlas.status, served.status], svc_calls: [atlas.svc, served.svc],
      overlap10: overlapAt(atlas.pages, served.pages, 10), top1_same: atlas.pages[0] === served.pages[0],
      jaccard: Math.round(jaccard(atlas.pages, served.pages) * 1000) / 1000,
      atlas_top10: atlas.pages.slice(0, 10), served_top10: served.pages.slice(0, 10),
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  const summary: Record<string, unknown> = {};
  for (const kind of ['wb', 'st'] as const) {
    const g = rows.filter((r) => r.kind === kind);
    if (!g.length) continue;
    const ov = g.map((r) => r.overlap10).filter((x): x is number => x !== null);
    summary[kind] = {
      n: g.length,
      atlas_ms: { p50: pct(g.map((r) => r.atlas_ms), 0.5), p90: pct(g.map((r) => r.atlas_ms), 0.9), max: Math.max(...g.map((r) => r.atlas_ms)) },
      served_ms: { p50: pct(g.map((r) => r.served_ms), 0.5), p90: pct(g.map((r) => r.served_ms), 0.9), max: Math.max(...g.map((r) => r.served_ms)) },
      overlap10_mean: Math.round((ov.reduce((s, x) => s + x, 0) / ov.length) * 1000) / 1000,
      overlap10_eq1: ov.filter((x) => x === 1).length,
      top1_same: g.filter((r) => r.top1_same).length,
      jaccard_mean: Math.round((g.reduce((s, r) => s + r.jaccard, 0) / g.length) * 1000) / 1000,
      both_empty: g.filter((r) => r.atlas_n === 0 && r.served_n === 0).length,
      atlas_only_empty: g.filter((r) => r.atlas_n > 0 && r.served_n === 0).length,
      served_only_nonempty: g.filter((r) => r.atlas_n === 0 && r.served_n > 0).length,
      non200: g.filter((r) => r.status.some((s) => s !== 200)).length,
      // The served arm must have asked the service once, and the Atlas arm never.
      served_reached_service: g.filter((r) => r.svc_calls[1] === 1).length,
      atlas_called_service: g.filter((r) => r.svc_calls[0] > 0).length,
    };
  }
  console.log(JSON.stringify(summary, null, 1));
  if (OUT) writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), cutoff: CUTOFF.toISOString(), summary, rows }, null, 1));
});
