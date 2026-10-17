// Build the exact-scan file the server uses for selective filters (#6821, phase 3).
//   node build-exact.mjs [--window-mb 1024] [--force]
// Reads  $VECTOR_SEARCH_ROOT/shards/shard-<k>.{f32,jsonl} in shard order (key = global row ordinal, as
//        build-hnsw.mjs assigns it) and index/state.json (the build it belongs to).
// Writes index/exact.i8   one int8 vector per row (quantizeI8 in lib.mjs), ordered by (book_language,
//                         book_year): one language, or one language over a year range, is ONE read
//        index/exact.keys file row → usearch key (uint32)
//        index/exact.json class table [[language, year, start, count], …] + the index's built_at
// The server refuses the file when built_at differs (a rebuilt index renumbers keys).
//
// Why a second copy: the HNSW post-filter cannot find rows of a language the query's neighbourhood
// does not contain (a Chinese page's neighbours are Chinese), and the float32 shards are ordered by
// page_id, so a filtered set is scattered across 23 GB: 5.5K random 3 KB reads/s measured on l7a
// 2026-10-17. int8 in class order is 5.9 GB and a filtered set is one sequential read.
//
// Writes the output in windows of --window-mb (each a full sequential pass over the shards), so it
// never holds more than one window in RAM beside the 8 GB service in the same 14 GB slice.
//
// PRIOR ART: build-hnsw.mjs (this directory) — the same streamed shard read and key numbering;
// recall-eval.mjs — the shard → ordinal layout. Neither writes vectors in another order.
import fs from 'node:fs';
import path from 'node:path';
import { DIM, SHARD_DIR, EXACT_VEC_PATH, EXACT_KEYS_PATH, EXACT_META_PATH, readState, writeJsonAtomic, quantizeI8, log } from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const WINDOW_ROWS = Math.floor((+arg('--window-mb', 1024) * 1024 * 1024) / DIM);
const FORCE = process.argv.includes('--force');
const state = readState();
if (!state) { console.error('no index/state.json — build the index first (build-hnsw.mjs)'); process.exit(2); }
if (fs.existsSync(EXACT_META_PATH) && !FORCE) {
  const m = JSON.parse(fs.readFileSync(EXACT_META_PATH, 'utf8'));
  if (m.index_built_at === state.built_at) { console.error(`${EXACT_META_PATH} already matches this index (--force to rebuild)`); process.exit(0); }
}

const shards = fs.readdirSync(SHARD_DIR).filter((f) => /^shard-\d+\.f32$/.test(f))
  .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0])
  .map((f) => ({ f32: path.join(SHARD_DIR, f), jsonl: path.join(SHARD_DIR, f.replace('.f32', '.jsonl')), n: fs.statSync(path.join(SHARD_DIR, f)).size / (DIM * 4) }));
const N = shards.reduce((a, s) => a + s.n, 0);
if (N !== state.rows && N !== state.next_key) log(`warning: shards hold ${N} rows, state.json ${state.rows} (deltas since the build live in overrides, not here)`);

// ── pass 0: classes ──
const t0 = Date.now();
const classIdx = new Map(); const classes = []; // {lang, year, count}
const keyClass = new Uint32Array(N);
let key = 0;
for (const s of shards) {
  const lines = fs.readFileSync(s.jsonl, 'utf8').split('\n');
  for (let i = 0; i < s.n; i++) {
    const a = JSON.parse(lines[i]);
    const lang = a[3] ?? null, year = a[4] ?? null;
    const ck = `${lang}\u0000${year}`;
    let c = classIdx.get(ck);
    if (c === undefined) { c = classes.length; classes.push({ lang, year, count: 0 }); classIdx.set(ck, c); }
    classes[c].count++; keyClass[key++] = c;
  }
}
// (language, year): NULL language first, NULL year last within a language, so a year range is contiguous.
const order = classes.map((_, i) => i).sort((x, y) => {
  const a = classes[x], b = classes[y];
  if (a.lang !== b.lang) return a.lang === null ? -1 : b.lang === null ? 1 : a.lang < b.lang ? -1 : 1;
  if (a.year === b.year) return 0;
  return a.year === null ? 1 : b.year === null ? -1 : a.year - b.year;
});
let start = 0;
for (const c of order) { classes[c].start = start; start += classes[c].count; }
const pos = new Uint32Array(N); const filled = new Uint32Array(classes.length);
const keysOut = new Uint32Array(N);
for (let k = 0; k < N; k++) { const c = keyClass[k]; const p = classes[c].start + filled[c]++; pos[k] = p; keysOut[p] = k; }
log(`${N.toLocaleString()} rows in ${classes.length} (language, year) classes, ${((Date.now() - t0) / 1000).toFixed(0)} s`);

// ── passes 1..: vectors, one output window per pass ──
const tmpVec = `${EXACT_VEC_PATH}.tmp`, tmpKeys = `${EXACT_KEYS_PATH}.tmp`;
fs.writeFileSync(tmpKeys, Buffer.from(keysOut.buffer));
const out = fs.openSync(tmpVec, 'w');
const win = new Int8Array(Math.min(WINDOW_ROWS, N) * DIM);
const CH = 20000; const buf = Buffer.allocUnsafeSlow(CH * DIM * 4);
const passes = Math.ceil(N / WINDOW_ROWS);
for (let w = 0; w < passes; w++) {
  const lo = w * WINDOW_ROWS, hi = Math.min(N, lo + WINDOW_ROWS); let k = 0, got = 0;
  for (const s of shards) {
    const fd = fs.openSync(s.f32, 'r');
    for (let off = 0; off < s.n; off += CH) {
      const m = Math.min(CH, s.n - off);
      fs.readSync(fd, buf, 0, m * DIM * 4, off * DIM * 4);
      const f = new Float32Array(buf.buffer, 0, m * DIM);
      for (let i = 0; i < m; i++, k++) {
        const p = pos[k];
        if (p >= lo && p < hi) { quantizeI8(f, win, i * DIM, (p - lo) * DIM); got++; }
      }
    }
    fs.closeSync(fd);
  }
  if (got !== hi - lo) { console.error(`window ${w}: filled ${got} of ${hi - lo} rows`); process.exit(3); }
  fs.writeSync(out, win, 0, (hi - lo) * DIM, lo * DIM);
  log(`window ${w + 1}/${passes}: rows ${lo.toLocaleString()}–${hi.toLocaleString()}, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
fs.fsyncSync(out); fs.closeSync(out);
fs.renameSync(tmpVec, EXACT_VEC_PATH); fs.renameSync(tmpKeys, EXACT_KEYS_PATH);
writeJsonAtomic(EXACT_META_PATH, {
  index_built_at: state.built_at, rows: N, dim: DIM, quantization: 'i8-per-vector', built_at: new Date().toISOString(),
  classes: order.map((c) => [classes[c].lang, classes[c].year, classes[c].start, classes[c].count]),
});
log(`exact file: ${N.toLocaleString()} rows, ${(fs.statSync(EXACT_VEC_PATH).size / 1e9).toFixed(2)} GB, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
