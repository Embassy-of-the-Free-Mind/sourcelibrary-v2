// Recall of the running service against exact cosine over the same vectors (#6821, definition of done 2).
//   node recall-eval.mjs [--n 50] [--k 45] [--seed 6821] [--threads 8] [--out file.json]
// Queries are N stored page vectors drawn at random from the pulled shards (no Gemini call, no spend);
// each query's own page is excluded from both lists. Exact = usearch exactSearch (float32, cos) over
// every shard, streamed in 50K-row chunks. HNSW = POST /match on the local listener, threshold −2 so
// nothing is cut. Reports overlap@k and @10, a tie-tolerant recall (HNSW rows whose exact similarity
// reaches the exact k-th: duplicate pages make set overlap understate), the similarity error the 8-bit
// index adds, and latency p50/p90 (server-side and HTTP round trip), unfiltered and with a language
// filter. Run it right after a build: a delta that re-embeds a sampled page changes its vector in the
// index but not in the shards.
//
// PRIOR ART: scripts/eval/orig-lang-recall/untranslated-lane.mjs measures a lane against Supabase with
// real queries (needs Gemini and the live RPC); sourcelibrary-atlas semantic-lib.mjs `searchParallel` is
// an exact scan, but in JS over an int8 matrix — this compares against float32, natively.
import fs from 'node:fs';
import path from 'node:path';
import { DIM, SHARD_DIR, loadUsearch, log } from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = +arg('--n', 50), K = +arg('--k', 45), SEED = +arg('--seed', 6821), THREADS = +arg('--threads', 8);
const OUT = arg('--out', null);
const LOCAL = `http://127.0.0.1:${process.env.VECTOR_SEARCH_LOCAL_PORT || 3459}`;
const { exactSearch } = loadUsearch();

const shards = fs.readdirSync(SHARD_DIR).filter((f) => /^shard-\d+\.f32$/.test(f))
  .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0])
  .map((f) => ({ f32: path.join(SHARD_DIR, f), jsonl: path.join(SHARD_DIR, f.replace('.f32', '.jsonl')), n: fs.statSync(path.join(SHARD_DIR, f)).size / (DIM * 4) }));
let base = 0; for (const s of shards) { s.base = base; base += s.n; }
const TOTAL = base;
const locate = (g) => shards.find((s) => g >= s.base && g < s.base + s.n);
// ordinal → page_id for the ordinals we need, one shard file in memory at a time.
const pageOf = new Map();
function resolve(ordinals) {
  const byShard = new Map();
  for (const g of ordinals) { if (pageOf.has(g)) continue; const s = locate(g); if (!byShard.has(s)) byShard.set(s, []); byShard.get(s).push(g); }
  for (const [s, gs] of byShard) { const lines = fs.readFileSync(s.jsonl, 'utf8').split('\n'); for (const g of gs) pageOf.set(g, JSON.parse(lines[g - s.base])[0]); }
}

// Seeded draw (mulberry32), distinct ordinals.
let st = SEED >>> 0; const rnd = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const picks = new Set(); while (picks.size < N) picks.add(Math.floor(rnd() * TOTAL));
const qOrd = [...picks];
const Q = new Float32Array(N * DIM);
qOrd.forEach((g, i) => { const s = locate(g); const fd = fs.openSync(s.f32, 'r'); fs.readSync(fd, Buffer.from(Q.buffer, i * DIM * 4, DIM * 4), 0, DIM * 4, (g - s.base) * DIM * 4); fs.closeSync(fd); });
log(`${N} queries drawn from ${TOTAL.toLocaleString()} rows (seed ${SEED})`);

// ── exact ──
const KK = K + 1; // room for the query's own row
const best = Array.from({ length: N }, () => []); // [dist, ordinal]
// Buffer.alloc, not allocUnsafe: a pooled Buffer can sit at a non-zero offset (see exactSearch below).
const CH = 50000; const buf = Buffer.alloc(CH * DIM * 4); const t0 = Date.now();
for (const s of shards) {
  const fd = fs.openSync(s.f32, 'r');
  for (let off = 0; off < s.n; off += CH) {
    const m = Math.min(CH, s.n - off);
    fs.readSync(fd, buf, 0, m * DIM * 4, off * DIM * 4);
    // exactSearch reads from the START of the ArrayBuffer and ignores byteOffset (usearch 2.26.4
    // lib.cpp), so dataset and queries must be offset-0 arrays — never a subarray.
    const data = new Float32Array(buf.buffer, 0, m * DIM);
    const cnt = Math.min(KK, m);
    const r = exactSearch(data, Q, DIM, cnt, 'cos', THREADS);
    for (let q = 0; q < N; q++) {
      const b = best[q];
      for (let j = 0; j < cnt; j++) b.push([r.distances[q * cnt + j], s.base + off + Number(r.keys[q * cnt + j])]);
      b.sort((x, y) => x[0] - y[0]); b.length = Math.min(b.length, KK);
    }
  }
  fs.closeSync(fd);
}
log(`exact scan: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
resolve([...qOrd, ...best.flat().map(([, g]) => g)]);

// ── HNSW via the service ──
async function post(body) {
  const t = performance.now();
  const r = await fetch(`${LOCAL}/match`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`/match HTTP ${r.status} ${await r.text()}`);
  const j = await r.json(); j.http_ms = performance.now() - t; return j;
}
function exactSim(q, g) {
  const s = locate(g); const v = new Float32Array(DIM); const fd = fs.openSync(s.f32, 'r');
  fs.readSync(fd, Buffer.from(v.buffer), 0, DIM * 4, (g - s.base) * DIM * 4); fs.closeSync(fd);
  let d = 0, a = 0, b = 0; for (let i = 0; i < DIM; i++) { const x = Q[q * DIM + i]; d += x * v[i]; a += x * x; b += v[i] * v[i]; }
  return d / Math.sqrt(a * b);
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
const per = []; const ms = [], httpMs = [], simErr = [];
for (let q = 0; q < N; q++) {
  const self = pageOf.get(qOrd[q]);
  const vector = Array.from(Q.subarray(q * DIM, (q + 1) * DIM));
  const h = await post({ vector, k: KK, threshold: -2, with_keys: true });
  ms.push(h.ms); httpMs.push(h.http_ms);
  const hn = h.rows.filter((r) => r.page_id !== self).slice(0, K);
  const ex = best[q].map(([d, g]) => ({ d, g, p: pageOf.get(g) })).filter((r) => r.p !== self).slice(0, K);
  const exSet = new Map(ex.map((r) => [r.p, 1 - r.d]));
  const overlap = hn.filter((r) => exSet.has(r.page_id)).length / K;
  const ex10 = new Set(ex.slice(0, 10).map((r) => r.p));
  const overlap10 = hn.slice(0, 10).filter((r) => ex10.has(r.page_id)).length / 10;
  // tie-tolerant: an HNSW row counts if its EXACT similarity reaches the exact k-th, so a duplicate
  // page (same vector, other id) is not scored as a miss.
  const kth = 1 - ex[ex.length - 1].d;
  const tieRecall = hn.filter((r) => exSet.has(r.page_id) || (r.key < TOTAL && exactSim(q, r.key) >= kth - 1e-6)).length / K;
  for (const r of hn) if (exSet.has(r.page_id)) simErr.push(Math.abs(r.similarity - exSet.get(r.page_id)));
  per.push({ ordinal: qOrd[q], page_id: self, overlap, overlap10, tieRecall, top_exact: +(1 - ex[0].d).toFixed(4), kth_exact: +kth.toFixed(4), self_first: h.rows[0]?.page_id === self });
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// Filtered path latency (same queries): a selective language filter forces over-fetch and widening.
const fms = [], fhttp = [], frows = [];
for (let q = 0; q < N; q++) {
  const h = await post({ vector: Array.from(Q.subarray(q * DIM, (q + 1) * DIM)), k: K, threshold: 0.3, filter_language: 'Latin', year_max: 1600 });
  fms.push(h.ms); fhttp.push(h.http_ms); frows.push(h.rows.length);
}
const health = await (await fetch(`${LOCAL}/health`)).json();
const result = {
  date: new Date().toISOString().slice(0, 10), n_queries: N, k: K, seed: SEED, rows: TOTAL, index_size: health.size, ef_search: health.ef_search,
  overlap_at_k: { mean: +mean(per.map((p) => p.overlap)).toFixed(4), min: Math.min(...per.map((p) => p.overlap)), p10: pct(per.map((p) => p.overlap), 0.1) },
  overlap_at_10: +mean(per.map((p) => p.overlap10)).toFixed(4),
  tie_tolerant_recall_at_k: +mean(per.map((p) => p.tieRecall)).toFixed(4),
  self_returned_first: per.filter((p) => p.self_first).length,
  similarity_abs_error: { mean: +mean(simErr).toFixed(5), max: +Math.max(...simErr).toFixed(5) },
  latency_ms_unfiltered: { server_p50: pct(ms, 0.5), server_p90: pct(ms, 0.9), http_p50: pct(httpMs, 0.5), http_p90: pct(httpMs, 0.9) },
  latency_ms_filtered_latin_pre1600: { server_p50: pct(fms, 0.5), server_p90: pct(fms, 0.9), http_p50: pct(fhttp, 0.5), http_p90: pct(fhttp, 0.9), mean_rows: +mean(frows).toFixed(1) },
  health, per_query: per,
};
console.log(JSON.stringify({ ...result, per_query: undefined, health: undefined }, null, 2));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
