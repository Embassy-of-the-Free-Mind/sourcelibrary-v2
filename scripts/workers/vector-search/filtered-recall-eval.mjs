// Filtered recall of the running service against an exact float32 filtered scan (#6821, phase 3).
//   node filtered-recall-eval.mjs [--n 30] [--k 45] [--seed 6821] [--threads 8] [--out file.json]
// Queries: N stored page vectors drawn at random from the shards (no Gemini call, no spend); each
// query's own page is excluded from both lists. Filter shapes are the ones readers send
// (search_queries.filters, 60 days to 2026-10-17), names expanded as the app's expandLanguages does.
// Truth per (query, shape): one pass over every shard, rows passing match_semantic's predicates on the
// shard's own book_language / book_year, float32 cosine (usearch exactSearch), `> threshold`, top k.
// Service: POST /match on the local listener with the same filter, threshold and k.
// Reports recall@k (|service ∩ exact| / |exact|), rows returned vs rows that exist, the path the
// planner took, and latency. Run it right after a build, before any delta (as recall-eval.mjs).
//
// PRIOR ART: recall-eval.mjs (this directory) — the same seeded draw, shard layout and exactSearch
// usage, unfiltered; its one filtered probe measured latency and row count only (20.2 of 45 rows).
import fs from 'node:fs';
import path from 'node:path';
import { DIM, SHARD_DIR, loadUsearch, log } from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = +arg('--n', 30), K = +arg('--k', 45), SEED = +arg('--seed', 6821), THREADS = +arg('--threads', 8);
const THRESHOLD = 0.3;
const OUT = arg('--out', null);
const LOCAL = `http://127.0.0.1:${process.env.VECTOR_SEARCH_LOCAL_PORT || 3459}`;
const { exactSearch } = loadUsearch();

const SHAPES = [
  { name: 'one language, selective (Sanskrit, 2%)', body: { filter_languages: ['Sanskrit', 'sa'] } },
  { name: 'one language, broad (Latin, 31%)', body: { filter_languages: ['Latin', 'la'] } },
  { name: 'language + year (Latin, ≤1600)', body: { filter_languages: ['Latin', 'la'], year_max: 1600 } },
  { name: 'exclude_languages (Latin, French, German, English)', body: { filter_exclude_languages: ['Latin', 'la', 'French', 'fr', 'German', 'de', 'English', 'en'] } },
];
const pass = (l, y, b) => {
  if (b.filter_languages && (l == null || !b.filter_languages.includes(l))) return false;
  if (b.filter_exclude_languages && l != null && b.filter_exclude_languages.includes(l)) return false;
  if (b.year_min != null || b.year_max != null) {
    if (y == null) return false;
    if (b.year_min != null && y < b.year_min) return false;
    if (b.year_max != null && y > b.year_max) return false;
  }
  return true;
};

const shards = fs.readdirSync(SHARD_DIR).filter((f) => /^shard-\d+\.f32$/.test(f))
  .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0])
  .map((f) => ({ f32: path.join(SHARD_DIR, f), jsonl: path.join(SHARD_DIR, f.replace('.f32', '.jsonl')), n: fs.statSync(path.join(SHARD_DIR, f)).size / (DIM * 4) }))
  .filter((s) => s.n > 0);
let base = 0; for (const s of shards) { s.base = base; base += s.n; }
const TOTAL = base;
const locate = (g) => shards.find((s) => g >= s.base && g < s.base + s.n);

// Seeded draw (mulberry32), the same generator as recall-eval.mjs.
let st = SEED >>> 0; const rnd = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const picks = new Set(); while (picks.size < N) picks.add(Math.floor(rnd() * TOTAL));
const qOrd = [...picks];
const Q = new Float32Array(N * DIM);
const qMeta = qOrd.map((g, i) => {
  const s = locate(g); const fd = fs.openSync(s.f32, 'r');
  fs.readSync(fd, Buffer.from(Q.buffer, i * DIM * 4, DIM * 4), 0, DIM * 4, (g - s.base) * DIM * 4); fs.closeSync(fd);
  return null;
});
log(`${N} queries from ${TOTAL.toLocaleString()} rows (seed ${SEED}); ${SHAPES.length} shapes`);

// ── exact filtered truth: one pass, all shapes ──
const KK = K + 1;
const best = SHAPES.map(() => Array.from({ length: N }, () => [])); // [sim, page_id]
const shapeRows = SHAPES.map(() => 0);
const CH = 50000; const buf = Buffer.alloc(CH * DIM * 4);
const packs = SHAPES.map(() => Buffer.alloc(CH * DIM * 4)); // offset-0 buffers: exactSearch ignores byteOffset
const qSet = new Set(qOrd); const t0 = Date.now();
for (const s of shards) {
  const lines = fs.readFileSync(s.jsonl, 'utf8').split('\n');
  const fd = fs.openSync(s.f32, 'r');
  for (let off = 0; off < s.n; off += CH) {
    const m = Math.min(CH, s.n - off);
    fs.readSync(fd, buf, 0, m * DIM * 4, off * DIM * 4);
    const meta = []; for (let i = 0; i < m; i++) meta.push(JSON.parse(lines[off + i]));
    for (let i = 0; i < m; i++) { const g = s.base + off + i; if (qSet.has(g)) qMeta[qOrd.indexOf(g)] = { page_id: meta[i][0], language: meta[i][3], year: meta[i][4] }; }
    SHAPES.forEach((shape, si) => {
      const ids = [];
      for (let i = 0; i < m; i++) if (pass(meta[i][3], meta[i][4], shape.body)) { buf.copy(packs[si], ids.length * DIM * 4, i * DIM * 4, (i + 1) * DIM * 4); ids.push(meta[i][0]); }
      shapeRows[si] += ids.length;
      if (!ids.length) return;
      const cnt = Math.min(KK, ids.length);
      const r = exactSearch(new Float32Array(packs[si].buffer, 0, ids.length * DIM), Q, DIM, cnt, 'cos', THREADS);
      for (let q = 0; q < N; q++) {
        const b = best[si][q];
        for (let j = 0; j < cnt; j++) { const sim = 1 - r.distances[q * cnt + j]; if (sim > THRESHOLD) b.push([sim, ids[Number(r.keys[q * cnt + j])]]); }
        b.sort((x, y) => y[0] - x[0]); if (b.length > KK) b.length = KK;
      }
    });
  }
  fs.closeSync(fd);
}
log(`exact filtered scan: ${((Date.now() - t0) / 1000).toFixed(0)} s; rows per shape ${shapeRows.join(', ')}`);

async function post(body) {
  const t = performance.now();
  const r = await fetch(`${LOCAL}/match`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`/match HTTP ${r.status} ${await r.text()}`);
  const j = await r.json(); j.http_ms = performance.now() - t; return j;
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1); };
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const health = await (await fetch(`${LOCAL}/health`)).json();

const results = [];
for (const [si, shape] of SHAPES.entries()) {
  const per = [];
  for (let q = 0; q < N; q++) {
    const self = qMeta[q].page_id;
    const h = await post({ vector: Array.from(Q.subarray(q * DIM, (q + 1) * DIM)), k: KK, threshold: THRESHOLD, ...shape.body });
    const svc = h.rows.filter((r) => r.page_id !== self).slice(0, K);
    const ex = best[si][q].filter(([, p]) => p !== self).slice(0, K);
    const exSet = new Set(ex.map(([, p]) => p));
    const hit = svc.filter((r) => exSet.has(r.page_id)).length;
    per.push({
      query_language: qMeta[q].language, exact_rows: ex.length, svc_rows: svc.length,
      recall: ex.length ? hit / ex.length : (svc.length ? 0 : 1),
      path: h.path ?? 'post-filter', complete: h.complete ?? null, rounds: h.rounds, candidates: h.candidates, ms: h.ms, http_ms: h.http_ms,
    });
  }
  const paths = {}; for (const p of per) paths[p.path] = (paths[p.path] || 0) + 1;
  const full = per.filter((p) => p.exact_rows === K);
  results.push({
    shape: shape.name, filter: shape.body, filtered_rows: shapeRows[si],
    recall_mean: +mean(per.map((p) => p.recall)).toFixed(4), recall_min: +Math.min(...per.map((p) => p.recall)).toFixed(4),
    queries_with_full_page: full.length, recall_mean_full_page: full.length ? +mean(full.map((p) => p.recall)).toFixed(4) : null,
    exact_rows_mean: +mean(per.map((p) => p.exact_rows)).toFixed(1), svc_rows_mean: +mean(per.map((p) => p.svc_rows)).toFixed(1),
    incomplete: per.filter((p) => p.complete === false).length, paths,
    server_ms: { p50: pct(per.map((p) => p.ms), 0.5), p90: pct(per.map((p) => p.ms), 0.9), max: pct(per.map((p) => p.ms), 1) },
    http_ms: { p50: pct(per.map((p) => p.http_ms), 0.5), p90: pct(per.map((p) => p.http_ms), 0.9) },
    per_query: per,
  });
}
const out = { date: new Date().toISOString().slice(0, 10), n_queries: N, k: K, seed: SEED, threshold: THRESHOLD, rows: TOTAL, health, query_languages: qMeta.map((m) => m.language), results };
console.log(JSON.stringify(results.map((r) => ({ ...r, per_query: undefined })), null, 2));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
