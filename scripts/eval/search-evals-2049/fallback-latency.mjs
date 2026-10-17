#!/usr/bin/env node
/**
 * Serve-mode fallback cost (#2049, eval check 2b): the same requests, interleaved, against two
 * deployments of the same commit — a baseline (vector lane off) and one built with
 * VECTOR_SEARCH_MODE=serve and VECTOR_SEARCH_URL pointing at a host that never answers. Every
 * semantic page search on the second must time out on the service (400 ms) and fall back to
 * `match_semantic`. Reports per route and deployment: p50/p90/p99 ms, non-200s, empty or degraded
 * answers, and whether the semantic page results are the same rows as the baseline's.
 *
 * PRIOR ART: scripts/eval/mcp-latency-probe.mjs — times one deployment's MCP calls; this compares
 * two deployments on the HTTP search routes, interleaved so both see the same minutes of
 * Atlas/Supabase load.
 *
 *   CRON_SECRET=… node scripts/eval/search-evals-2049/fallback-latency.mjs \
 *     --a https://<baseline>.vercel.app --b https://<dead-host>.vercel.app --rounds 6 --out $JOB_SCRATCH/fallback.jsonl
 *
 * Queries: the fixed 10-query panel (scripts/audit/search-probe.mjs), so the query embeddings repeat
 * and each deployment's instances embed each query once. A nonce param bypasses the edge cache.
 * Preview hosts refuse some routes without an Authorization header (src/lib/alias-host-scope.ts);
 * any value passes, so CRON_SECRET is sent.
 */
import { appendFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const A = opt('a').replace(/\/$/, ''), B = opt('b').replace(/\/$/, '');
const ROUNDS = +opt('rounds', 6);
const OUT = opt('out');
const PANEL = ['hermes trismegistus', 'corpus hermeticum', 'materia medica', 'paracelsus', 'transmutation of metals',
  'rosarium philosophorum', 'drebbel', 'sefer yetzirah', 'prima materia', 'marsilio ficino'];
const headers = { 'user-agent': 'sl-search-evals/1 (#2049)', ...(process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {}) };
const ROUTES = {
  semantic_page: (q) => `/api/search/semantic?q=${encodeURIComponent(q)}&level=page&limit=20`,
  search: (q) => `/api/search?q=${encodeURIComponent(q)}&limit=20`,
};

async function call(base, path) {
  const t = performance.now();
  try {
    const r = await fetch(`${base}${path}&_n=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, { headers, signal: AbortSignal.timeout(30000), cache: 'no-store' });
    const body = await r.json().catch(() => null);
    const ms = Math.round(performance.now() - t);
    const results = body?.results || [];
    return { ms, status: r.status, n: results.length, degraded: body?.degraded_lanes || [], keys: results.map((x) => `${x.book_id}:${x.page_number ?? ''}`) };
  } catch (e) { return { ms: Math.round(performance.now() - t), status: 0, n: 0, error: String(e.message).slice(0, 80) }; }
}

const rows = [];
// Warm-up: one pass per deployment so the first-instance embedding and cold start are not in the sample.
for (const base of [A, B]) for (const q of PANEL) for (const route of Object.keys(ROUTES)) await call(base, ROUTES[route](q));
for (let r = 0; r < ROUNDS; r++) {
  for (const q of PANEL) {
    for (const route of Object.keys(ROUTES)) {
      // Alternate which deployment goes first, so neither always meets a warmer Postgres cache.
      const order = (r + PANEL.indexOf(q)) % 2 ? [['a', A], ['b', B]] : [['b', B], ['a', A]];
      const pair = {};
      for (const [k, base] of order) pair[k] = await call(base, ROUTES[route](q));
      const same = route === 'semantic_page' && pair.a.n && pair.b.n
        ? pair.a.keys.filter((x) => pair.b.keys.includes(x)).length / Math.max(pair.a.n, pair.b.n) : null;
      const row = { round: r, q, route, a: { ...pair.a, keys: undefined }, b: { ...pair.b, keys: undefined }, same_rows: same };
      rows.push(row);
      if (OUT) appendFileSync(OUT, JSON.stringify(row) + '\n');
    }
  }
}

const pct = (xs, p) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
for (const route of Object.keys(ROUTES)) {
  const rs = rows.filter((x) => x.route === route);
  const side = (k) => ({
    n: rs.length, p50: pct(rs.map((x) => x[k].ms), 0.5), p90: pct(rs.map((x) => x[k].ms), 0.9), p99: pct(rs.map((x) => x[k].ms), 0.99),
    non200: rs.filter((x) => x[k].status !== 200).length, empty: rs.filter((x) => x[k].status === 200 && x[k].n === 0).length,
    degraded: rs.filter((x) => (x[k].degraded || []).length).length,
  });
  const diffs = rs.map((x) => x.b.ms - x.a.ms);
  const same = rs.map((x) => x.same_rows).filter((x) => x != null);
  console.log(JSON.stringify({ route, a: side('a'), b: side('b'), added_ms_paired: { p50: pct(diffs, 0.5), p90: pct(diffs, 0.9), mean: Math.round(diffs.reduce((s, x) => s + x, 0) / diffs.length) }, same_rows_mean: same.length ? Math.round((same.reduce((s, x) => s + x, 0) / same.length) * 1000) / 1000 : null }));
}
