#!/usr/bin/env node
/**
 * Synthetic search probe (#2049, eval check 6): a fixed panel of 10 queries through the four
 * search surfaces readers and agents use — `/api/search`, `/api/search/semantic?level=page`, and
 * MCP `search_library` / `search_concept` — every 15 min from the main Hetzner box. One JSON line
 * per run goes to the log; ntfy (sourcelibrary-uptime) fires when a surface's p90 this run is more
 * than 2× its trailing-24 h p90 in two runs in a row, or on an error streak (3 runs in a row with a failed or empty call),
 * once per state change, and once more when it clears.
 *
 * Why: on 2026-10-17 21:04–21:20Z every vector-service call timed out (#6821) and nothing paged —
 * it was shadow, so readers were spared, but in `serve` the same freeze would have added the
 * fallback's time to every semantic search with no signal at all.
 *
 * PRIOR ART: scripts/eval/mcp-latency-probe.mjs — the MCP JSON-RPC calls copied from it, but it is
 * a one-shot timing tool with no panel, no log and no alert. scripts/uptime-monitor.mjs — the
 * 5-minute endpoint monitor (Mongo log, ntfy on change); it checks that pages answer, one shot per
 * endpoint, not search latency over a panel, and adding 40 calls to its 5-minute loop would quadruple
 * this probe's cost. scripts/workers/vector-search/freshness-check.mjs — the once-per-state-change
 * ntfy pattern, for the service's index freshness, not the app path.
 *
 * Cost: no model call of its own. The same 10 queries every run, so the query embedding is a repeat:
 * the app's in-memory cache (per instance) answers it when warm, and a cold instance makes one
 * embedding call per query (~10 tokens each; ≲2K embedding calls a day in the worst case, ~$0.01/day).
 * The real cost is Vercel: 40 function invocations a run, 3,840 a day (~115K a month), each holding
 * a function for the search's ~1–3 s. The two HTTP routes carry a per-run nonce param so the edge
 * cache cannot answer: the semantic route's s-maxage 300 + swr 600 spans the whole 15 minutes, and the
 * first runs without it timed the cache (66–78 ms). MCP's in-process LRU (#6853) answers repeat
 * queries in ~0.1 s on a warm instance, so the MCP rows measure the MCP route and its cache more than
 * the search path; a nonce there would change the query and cost an embedding.
 *
 * Analytics: each `/api/search` and semantic call writes a `search_queries` row (~1,900 a day), and
 * each MCP call an `mcp_tool_calls` row, with user agent `sl-search-probe/1 (#2049)`. Exclude it:
 * `user_agent: { $not: /sl-search-probe/ }`.
 *
 *   node scripts/audit/search-probe.mjs [--base https://sourcelibrary.org] [--log <file>] [--state <file>]
 *     [--dry-run]   (no ntfy, prints the line and the verdict)
 *
 * Cron line: infrastructure/hetzner-crontab ("Synthetic search probe").
 */
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = opt('base', 'https://sourcelibrary.org').replace(/\/$/, '');
const LOG = opt('log', '/var/log/sourcelibrary/search-probe.jsonl');
const STATE = opt('state', '/var/log/sourcelibrary/search-probe.state.json');
const DRY = argv.includes('--dry-run');
const NTFY = 'https://ntfy.sh/sourcelibrary-uptime';
const UA = 'sl-search-probe/1 (#2049)';

/** Fixed, so every embedding is a repeat. Ten of the most-searched site queries (2026-10, search_queries). */
export const PANEL = [
  'hermes trismegistus', 'corpus hermeticum', 'materia medica', 'paracelsus', 'transmutation of metals',
  'rosarium philosophorum', 'drebbel', 'sefer yetzirah', 'prima materia', 'marsilio ficino',
];
const TIMEOUT_MS = 20000;
/** Runs needed in the trailing 24 h before a latency alert can fire (6 h of history). */
const MIN_HISTORY_RUNS = 24;
const ERROR_STREAK = 3;
const P90_FACTOR = 2;
const SLOW_STREAK = 2;

const pct = (xs, p) => { const a = xs.filter((x) => x != null).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : null; };

async function timed(fn) {
  const t = performance.now();
  try { const r = await fn(); return { ms: Math.round(performance.now() - t), ...r }; } catch (e) {
    return { ms: Math.round(performance.now() - t), ok: false, error: String(e.name === 'TimeoutError' ? `timeout ${TIMEOUT_MS} ms` : e.message).slice(0, 160) };
  }
}

/** A per-run param outside `q`: a new edge-cache key, so the route runs, but the same embedding-cache key. */
const NONCE = `_probe=${Date.now().toString(36)}`;

async function getJson(url) {
  const res = await fetch(`${url}&${NONCE}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
  const body = await res.json().catch(() => null);
  return { res, body };
}

let rpcId = 0;
async function mcpTool(name, args) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': UA },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('data: '));
  const body = JSON.parse(line ? line.slice(6) : text);
  if (!res.ok || body.error || body.result?.isError) return { ok: false, error: `HTTP ${res.status} ${JSON.stringify(body.error ?? body.result?.content?.[0]?.text ?? '').slice(0, 120)}` };
  const out = body.result?.content?.map((c) => c.text || '').join('\n') || '';
  let n = null;
  try { const j = JSON.parse(out); n = (j.results ?? j.passages ?? j.books ?? j.items ?? []).length; } catch { n = out.length > 80 ? 1 : 0; }
  return n === 0 ? { ok: false, error: 'empty' } : { ok: true, n };
}

/** The four surfaces. A call fails on a non-200, a timeout, an error body, or zero results (the panel always has results). */
const SURFACES = {
  search: (q) => timed(async () => {
    const { res, body } = await getJson(`${BASE}/api/search?q=${encodeURIComponent(q)}&limit=20`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const n = body?.results?.length ?? 0;
    return n ? { ok: true, n, degraded: body?.degraded_lanes?.length ? body.degraded_lanes : undefined } : { ok: false, error: 'empty' };
  }),
  semantic_page: (q) => timed(async () => {
    const { res, body } = await getJson(`${BASE}/api/search/semantic?q=${encodeURIComponent(q)}&level=page&limit=20`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const n = body?.results?.length ?? 0;
    return n ? { ok: true, n } : { ok: false, error: 'empty' };
  }),
  mcp_search_library: (q) => timed(() => mcpTool('search_library', { query: q, limit: 5 })),
  mcp_search_concept: (q) => timed(() => mcpTool('search_concept', { query: q, limit: 5 })),
};

async function runPanel() {
  const calls = {};
  for (const [surface, fn] of Object.entries(SURFACES)) {
    calls[surface] = [];
    // Two at a time: a reader's pace, not a load test.
    for (let i = 0; i < PANEL.length; i += 2) {
      const pair = await Promise.all(PANEL.slice(i, i + 2).map(async (q) => ({ q, ...(await fn(q)) })));
      calls[surface].push(...pair);
    }
  }
  const surfaces = {};
  for (const [s, cs] of Object.entries(calls)) {
    const ms = cs.map((c) => c.ms);
    surfaces[s] = {
      n: cs.length, errors: cs.filter((c) => !c.ok).length, p50: pct(ms, 0.5), p90: pct(ms, 0.9), max: Math.max(...ms),
      ...(cs.some((c) => !c.ok) ? { failed: cs.filter((c) => !c.ok).map((c) => `${c.q}: ${c.error}`).slice(0, 5) } : {}),
      ...(cs.some((c) => c.degraded) ? { degraded: [...new Set(cs.flatMap((c) => c.degraded || []))] } : {}),
      ms,
    };
  }
  return { ts: new Date().toISOString(), base: BASE, surfaces };
}

function readHistory() {
  if (!existsSync(LOG)) return [];
  const since = Date.now() - 24 * 3600 * 1000;
  return readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((r) => r && Date.parse(r.ts) >= since && r.base === BASE);
}

/** Exported for tests: the verdict per surface from this run and the trailing history (oldest first). */
export function judge(run, history) {
  const out = {};
  for (const [s, cur] of Object.entries(run.surfaces)) {
    const past = history.map((h) => h.surfaces?.[s]).filter(Boolean);
    const trailingP90 = past.length >= MIN_HISTORY_RUNS ? pct(past.flatMap((p) => p.ms || []), 0.9) : null;
    // p90 of ten calls is the second-slowest call, so one slow run is one slow call. SLOW needs
    // SLOW_STREAK runs in a row over the bar (2026-10-19: five one-run pages, medians flat).
    const over = (p) => trailingP90 != null && p.p90 > P90_FACTOR * trailingP90;
    const lastRuns = [...past.slice(-(SLOW_STREAK - 1)), cur];
    const slow = lastRuns.length === SLOW_STREAK && lastRuns.every(over);
    const recent = [...past.slice(-(ERROR_STREAK - 1)), cur];
    const streak = recent.length === ERROR_STREAK && recent.every((p) => p.errors > 0);
    out[s] = { bad: slow || streak, slow, streak, p90: cur.p90, trailing_p90: trailingP90, errors: cur.errors };
  }
  return out;
}

async function ntfy(title, body, priority) {
  if (DRY) { console.log(`[dry-run] ntfy: ${title}\n${body}`); return; }
  await fetch(NTFY, { method: 'POST', headers: { Title: title, Priority: priority, Tags: 'mag' }, body, signal: AbortSignal.timeout(10000) }).catch(() => {});
}

async function main() {
  const history = readHistory();
  const run = await runPanel();
  const verdict = judge(run, history);
  run.verdict = Object.fromEntries(Object.entries(verdict).map(([s, v]) => [s, v.bad ? (v.streak ? 'error_streak' : 'slow') : 'ok']));
  if (!DRY) { mkdirSync(path.dirname(LOG), { recursive: true }); appendFileSync(LOG, JSON.stringify(run) + '\n'); }
  console.log(JSON.stringify({ ...run, surfaces: Object.fromEntries(Object.entries(run.surfaces).map(([s, v]) => [s, { ...v, ms: undefined }])) }));

  // Once per state change, per surface.
  const prev = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
  const next = {};
  for (const [s, v] of Object.entries(verdict)) {
    const state = v.bad ? (v.streak ? 'error_streak' : 'slow') : 'ok';
    next[s] = state;
    if (state === (prev[s] || 'ok')) continue;
    const detail = `${s}: p90 ${v.p90} ms this run (trailing 24 h p90 ${v.trailing_p90 ?? 'n/a'} ms), ${v.errors}/${run.surfaces[s].n} calls failed.`
      + (run.surfaces[s].failed ? `\n${run.surfaces[s].failed.join('\n')}` : '')
      + `\nLog: ${LOG} on main. Panel: ${PANEL.length} fixed queries. #2049`;
    if (state === 'ok') await ntfy(`Search probe OK again: ${s}`, detail, 'low');
    else await ntfy(`Search probe ${state === 'slow' ? 'SLOW' : 'FAILING'}: ${s}`, detail, 'high');
  }
  if (!DRY) writeFileSync(STATE, JSON.stringify(next));
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
