// Build generation 1 of the page-vector index from the pulled shards.
//   node build-hnsw.mjs [--threads 8] [--force]
// Reads  $VECTOR_SEARCH_ROOT/shards/shard-<k>.{f32,jsonl} in shard order (key = global row ordinal).
// Writes $VECTOR_SEARCH_ROOT/index/index-1.usearch (cos, M=16, e4m3: INDEX_CONFIG in lib.mjs),
// rows-1.jsonl, then state.json (the commit point). Streams the float32 shards in 20K-row chunks:
// the f32 set (~23 GB at 7.6M rows) is never in RAM, only the 8-bit index (~7 GB) is.
//
// PRIOR ART: sourcelibrary-atlas scripts/local-corpus/build-hnsw.mjs — same graph settings and the same
// streamed chunks. Changed: e4m3 instead of i8 (lib.mjs says why); keys index rows of the service's
// row store (with language/year) rather than the atlas's quantized matrix; an explicit thread count
// (one thread is ~8× slower on this box, measured 2026-10-16); and a state.json that records the
// delta checkpoint (the pull's start).
import fs from 'node:fs';
import path from 'node:path';
import { DIM, SHARD_DIR, INDEX_DIR, INDEX_CONFIG, QUANTIZATION, STATE_PATH, loadUsearch, indexPath, rowsPath, writeJsonAtomic, log } from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const THREADS = +arg('--threads', 8);
const FORCE = process.argv.includes('--force');
const pull = JSON.parse(fs.readFileSync(path.join(SHARD_DIR, 'pull.json'), 'utf8'));
if (!pull.done) { console.error('pull.json says the pull is not done'); process.exit(2); }
if (fs.existsSync(STATE_PATH) && !FORCE) { console.error(`${STATE_PATH} exists — index already built (--force to rebuild)`); process.exit(2); }
fs.mkdirSync(INDEX_DIR, { recursive: true });

const { Index } = loadUsearch();
const index = new Index(INDEX_CONFIG);
const shards = fs.readdirSync(SHARD_DIR).filter((f) => /^shard-\d+\.f32$/.test(f))
  .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
const rowsTmp = `${rowsPath(1)}.tmp`;
const rowsOut = fs.openSync(rowsTmp, 'w');
const CH = 20000; let row = 0; const t0 = Date.now(); let lastLog = 0;
for (const f of shards) {
  const fd = fs.openSync(path.join(SHARD_DIR, f), 'r');
  const n = fs.fstatSync(fd).size / (DIM * 4);
  const jsonl = fs.readFileSync(path.join(SHARD_DIR, f.replace('.f32', '.jsonl')), 'utf8');
  const lines = jsonl.split('\n').filter(Boolean);
  if (lines.length !== n) { console.error(`${f}: ${n} vectors but ${lines.length} rows — re-run the pull`); process.exit(3); }
  fs.writeSync(rowsOut, jsonl.endsWith('\n') || !jsonl ? jsonl : jsonl + '\n');
  const buf = Buffer.allocUnsafe(CH * DIM * 4);
  for (let off = 0; off < n; off += CH) {
    const m = Math.min(CH, n - off);
    fs.readSync(fd, buf, 0, m * DIM * 4, off * DIM * 4);
    const vecs = new Float32Array(buf.buffer, buf.byteOffset, m * DIM);
    const keys = new BigUint64Array(m); for (let i = 0; i < m; i++) keys[i] = BigInt(row + i);
    index.add(keys, vecs, THREADS); row += m;
    if (Date.now() - lastLog > 60000) {
      lastLog = Date.now(); const min = (Date.now() - t0) / 60000;
      log(`${row.toLocaleString()} / ${pull.rows.toLocaleString()} · ${min.toFixed(1)} min · ${(row / min / 60).toFixed(0)} rows/s · rss ${(process.memoryUsage().rss / 1e9).toFixed(1)} GB`);
    }
  }
  fs.closeSync(fd);
}
fs.fsyncSync(rowsOut); fs.closeSync(rowsOut);
if (row !== pull.rows) { console.error(`indexed ${row} rows but pull.json says ${pull.rows}`); process.exit(3); }
const tmp = `${indexPath(1)}.tmp`;
index.save(tmp); fs.renameSync(tmp, indexPath(1)); fs.renameSync(rowsTmp, rowsPath(1));
// Delta checkpoint = the pull's start, minus 10 min of clock slack. Re-applying a row is harmless.
const since = new Date(new Date(pull.started_at.replace(' ', 'T').replace(/\+00$/, 'Z')).getTime() - 600000).toISOString();
writeJsonAtomic(STATE_PATH, {
  generation: 1, built_at: new Date().toISOString(), next_key: row, rows: row, quantization: QUANTIZATION,
  checkpoint: { updated_at: since, page_id: '' }, last_delta_at: null, pulled_at: pull.started_at,
});
log('saved', index.size().toLocaleString(), 'vectors in', ((Date.now() - t0) / 60000).toFixed(1), 'min;',
  (fs.statSync(indexPath(1)).size / 1e9).toFixed(2), 'GB');
