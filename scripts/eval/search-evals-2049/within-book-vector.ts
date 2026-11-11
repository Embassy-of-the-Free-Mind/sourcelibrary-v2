/**
 * search_within_book's semantic leg: Supabase `match_pages_in_books` against the page-vector
 * service's `book_ids` path (#2049, job within-book-semantic). Samples real calls the way
 * within-book-parts.ts does (mcp_tool_calls, tool search_within_book, English, one row per distinct
 * args, seed 2049), embeds each query ONCE and keeps the vector in the --calls file, so a re-run
 * (after the service restart) costs no Gemini call.
 *
 * Per call: the RPC at k=10 (what the route asks) and the service's /match with the same book,
 * threshold and k; overlap@10 on page_id, top-1, and the largest similarity difference on shared
 * pages. Read-only.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local --import tsx \
 *     scripts/eval/search-evals-2049/within-book-vector.ts --n 30 --out $JOB_SCRATCH/wbv.json \
 *     [--calls $JOB_SCRATCH/wbv.json] [--svc http://127.0.0.1:3459]
 * --svc defaults to the service's local listener (no token; run on l7a). Without a reachable
 * service only the RPC arm runs.
 *
 * PRIOR ART: scripts/eval/search-evals-2049/within-book-parts.ts — the sampler is its `sample()`
 * (copied: that file runs its main on import); it times the RPC but never asks the service.
 * scripts/workers/vector-search/latency-eval.mjs compares the service to match_semantic, not to the
 * per-book RPC.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { getDb } from '@/lib/mongodb';
import { supabase } from '@/lib/supabase';
import { getQueryEmbedding } from '@/lib/semantic-search';
// @ts-expect-error — plain-JS module, no declarations
import { makeRng } from '../lib/paired-stats.mjs';

const argv = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const N = +(opt('n', '30') as string);
const OUT = opt('out');
const CALLS = opt('calls');
const SVC = opt('svc', 'http://127.0.0.1:3459') as string;
const K = 10;

interface Call { book_id: string; query: string; embedding?: number[] | null }

async function sample(): Promise<Call[]> {
  if (CALLS) return (JSON.parse(readFileSync(CALLS, 'utf8')).rows as Call[]).map(({ book_id, query, embedding }) => ({ book_id, query, embedding }));
  const db = await getDb();
  const rows = await db.collection('mcp_tool_calls')
    .find({ tool: 'search_within_book', ok: true, ts: { $gte: new Date(Date.now() - 14 * 864e5) } })
    .project({ args: 1 }).toArray();
  const seen = new Set<string>();
  const calls: Call[] = [];
  for (const r of rows) {
    const a = r.args as Record<string, unknown>;
    if (a.lang && a.lang !== 'en') continue;
    if (!a.book_id || !a.query) continue;
    const c = { book_id: String(a.book_id), query: String(a.query).trim() };
    const k = `${c.book_id}\u0000${c.query}`;
    if (seen.has(k)) continue;
    seen.add(k);
    calls.push(c);
  }
  const rng = makeRng(2049);
  for (let i = calls.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [calls[i], calls[j]] = [calls[j], calls[i]]; }
  return calls.slice(0, N);
}

/** The route's book_id may be a slug; the vectors are keyed by the book's `id`. */
async function resolveId(db: Awaited<ReturnType<typeof getDb>>, idOrSlug: string): Promise<string> {
  const b = await db.collection('books').findOne({ $or: [{ id: idOrSlug }, { slug: idOrSlug }] }, { projection: { id: 1 } });
  return (b?.id as string) || idOrSlug;
}

type Row = { page_id: string; similarity: number };

async function main() {
  const db = await getDb();
  const calls = await sample();
  const out = [];
  for (const c of calls) {
    if (c.embedding === undefined) c.embedding = await getQueryEmbedding(c.query);
    if (!c.embedding) { out.push({ ...c, skipped: 'no embedding' }); continue; }
    const bookId = await resolveId(db, c.book_id);
    const vec = JSON.stringify(c.embedding);
    let t = performance.now();
    const rpc = await supabase.rpc('match_pages_in_books', { query_embedding: vec, book_ids: [bookId], match_threshold: 0.3, match_count: K });
    const rpcMs = Math.round(performance.now() - t);
    const rpcRows = (rpc.data || []) as Row[];
    let svcRows: Row[] | null = null, svcMs: number | null = null, svcServerMs: number | null = null, svcInfo: Record<string, unknown> | null = null;
    try {
      t = performance.now();
      const res = await fetch(`${SVC}/match`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vector: c.embedding, k: K, threshold: 0.3, book_ids: [bookId], with_text: true }),
        signal: AbortSignal.timeout(5000),
      });
      const body = await res.json() as { rows: Row[]; ms: number; path?: string; complete?: boolean; filtered_rows?: number; books_timing?: unknown };
      svcMs = Math.round(performance.now() - t);
      if (res.ok) {
        svcRows = body.rows; svcServerMs = Math.round(body.ms * 10) / 10;
        svcInfo = { path: body.path, complete: body.complete, filtered_rows: body.filtered_rows, books_timing: body.books_timing };
      } else svcInfo = { status: res.status, body };
    } catch (e) { svcInfo = { error: (e as Error).message }; }
    const ids = (rs: Row[]) => rs.map((r) => r.page_id);
    let overlap: number | null = null, top1: boolean | null = null, maxSimDiff: number | null = null;
    if (svcRows) {
      const a = ids(rpcRows), b = new Set(ids(svcRows));
      const denom = Math.max(a.length, b.size);
      overlap = denom === 0 ? 1 : a.filter((x) => b.has(x)).length / denom;
      top1 = (a[0] ?? null) === (svcRows[0]?.page_id ?? null);
      const sim = new Map(svcRows.map((r) => [r.page_id, r.similarity]));
      maxSimDiff = Math.max(0, ...rpcRows.filter((r) => sim.has(r.page_id)).map((r) => Math.abs(Number(r.similarity) - sim.get(r.page_id)!)));
    }
    const row = { book_id: c.book_id, query: c.query, rpc_error: rpc.error?.message ?? null, rpc_ms: rpcMs, rpc_n: rpcRows.length, svc_ms: svcMs, svc_server_ms: svcServerMs, svc_n: svcRows?.length ?? null, overlap, top1, max_sim_diff: maxSimDiff, svc: svcInfo, rpc_top: ids(rpcRows), svc_top: svcRows ? ids(svcRows) : null };
    out.push({ ...row, embedding: c.embedding });
    const { query: _q, book_id: _b, ...printable } = row; // no user queries on stdout
    console.log(JSON.stringify(printable));
  }
  const done = out.filter((r) => !('skipped' in r)) as Array<{ rpc_ms: number; svc_ms: number | null; svc_server_ms: number | null; overlap: number | null; top1: boolean | null }>;
  const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
  const withSvc = done.filter((r) => r.overlap !== null);
  const summary = {
    n: done.length,
    rpc_ms: { p50: pct(done.map((r) => r.rpc_ms), 0.5), p90: pct(done.map((r) => r.rpc_ms), 0.9), max: Math.max(...done.map((r) => r.rpc_ms)) },
    svc_ms: withSvc.length ? { p50: pct(withSvc.map((r) => r.svc_ms!), 0.5), p90: pct(withSvc.map((r) => r.svc_ms!), 0.9), max: Math.max(...withSvc.map((r) => r.svc_ms!)) } : null,
    svc_server_ms: withSvc.length ? { p50: pct(withSvc.map((r) => r.svc_server_ms!), 0.5), p90: pct(withSvc.map((r) => r.svc_server_ms!), 0.9) } : null,
    svc_answered: withSvc.length,
    overlap10_mean: withSvc.length ? +(withSvc.reduce((s, r) => s + r.overlap!, 0) / withSvc.length).toFixed(3) : null,
    overlap10_eq1: withSvc.filter((r) => r.overlap === 1).length,
    top1_same: withSvc.filter((r) => r.top1).length,
  };
  console.log(JSON.stringify(summary, null, 1));
  if (OUT) writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), summary, rows: out }, null, 1));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
