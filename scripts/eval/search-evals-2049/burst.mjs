#!/usr/bin/env node
/**
 * Burst load on the vector and keyword services (#2049, eval check 3): R requests at concurrency C
 * against `/match` (vectors.sourcelibrary.org) or `/lane` (keywords.sourcelibrary.org), straight from
 * this box over the public TLS front, the way Vercel calls them. Prints p50/p90/p99 of the client
 * time and of the server's own ms, and the errors, as one JSON line per run.
 *
 * PRIOR ART: scripts/workers/vector-search/latency-eval.mjs — sequential latency on l7a itself
 * (loopback and the TLS front), one request at a time; it has no concurrency and no keyword side.
 * The 19:55 "plague" client fired seven parallel searches: this is that pattern, and worse.
 *
 *   VECTOR_SEARCH_TOKEN=… node scripts/eval/search-evals-2049/burst.mjs --svc vector \
 *     --bodies $JOB_SCRATCH/vectors-200.json --conc 1,7,20 --requests 200 --label idle --out $JOB_SCRATCH/burst.jsonl
 *   KEYWORD_SEARCH_TOKEN=… node … --svc keyword --bodies $JOB_SCRATCH/lane-params.jsonl …
 *
 * Vector bodies: a JSON array of {vector[768]} (stored page vectors: no model call). Each is sent as
 * serve mode sends it: k 40 (the site's semantic page request), threshold 0.3, no filters, with_text
 * (`--no-text`: as shadow mode sends it, ids only).
 * Keyword bodies: JSONL of `/lane` request bodies (lane-params.harness.ts). Timeouts: the app's own
 * (400 ms vector, 1,500 ms keyword) are counted as errors, but the request is allowed 10 s so the
 * tail is measured rather than cut.
 */
import { readFileSync, appendFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const SVC = opt('svc');
const CONC = opt('conc', '1,7,20').split(',').map(Number);
const R = +opt('requests', 200);
const LABEL = opt('label', '');
const OUT = opt('out');
const cfg = {
  vector: { url: 'https://vectors.sourcelibrary.org/match', token: process.env.VECTOR_SEARCH_TOKEN, appTimeout: 400 },
  keyword: { url: 'https://keywords.sourcelibrary.org/lane', token: process.env.KEYWORD_SEARCH_TOKEN, appTimeout: 1500 },
}[SVC];
if (!cfg || !cfg.token) { console.error('--svc vector|keyword and its *_SEARCH_TOKEN env'); process.exit(2); }

const raw = readFileSync(opt('bodies'), 'utf8');
const bodies = SVC === 'vector'
  ? JSON.parse(raw).map((v) => JSON.stringify({ vector: v.vector, k: 40, threshold: 0.3, filter_language: null, filter_languages: null, filter_exclude_languages: null, year_min: null, year_max: null, ...(argv.includes('--no-text') ? {} : { with_text: true }) }))
  : raw.split('\n').filter(Boolean);

const pct = (xs, p) => { const a = xs.filter((x) => x != null).sort((x, y) => x - y); return a.length ? Math.round(a[Math.min(a.length - 1, Math.floor(p * a.length))] * 10) / 10 : null; };

async function one(body) {
  const t = performance.now();
  try {
    const r = await fetch(cfg.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` }, body, signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => null);
    const ms = performance.now() - t;
    if (!r.ok) return { ms, error: `HTTP ${r.status}` };
    const server = SVC === 'vector' ? j?.ms : j?.server_ms;
    return { ms, server, error: ms > cfg.appTimeout ? 'over_app_timeout' : null };
  } catch (e) {
    return { ms: performance.now() - t, error: String(e.name === 'TimeoutError' ? 'timeout_10s' : e.message).slice(0, 80) };
  }
}

for (const c of CONC) {
  const res = [];
  let next = 0;
  const t0 = performance.now();
  const started = new Date().toISOString();
  await Promise.all(Array.from({ length: c }, async () => {
    while (next < R) { const i = next++; res.push(await one(bodies[i % bodies.length])); }
  }));
  const wall = performance.now() - t0;
  const errs = {};
  for (const r of res) if (r.error) errs[r.error] = (errs[r.error] || 0) + 1;
  const line = {
    svc: SVC, label: LABEL, conc: c, n: res.length, started, ended: new Date().toISOString(), rps: Math.round((res.length / wall) * 10000) / 10,
    ms: { p50: pct(res.map((r) => r.ms), 0.5), p90: pct(res.map((r) => r.ms), 0.9), p99: pct(res.map((r) => r.ms), 0.99), max: pct(res.map((r) => r.ms), 1) },
    server_ms: { p50: pct(res.map((r) => r.server), 0.5), p90: pct(res.map((r) => r.server), 0.9), p99: pct(res.map((r) => r.server), 0.99) },
    errors: errs,
  };
  console.log(JSON.stringify(line));
  if (OUT) appendFileSync(OUT, JSON.stringify(line) + '\n');
}
