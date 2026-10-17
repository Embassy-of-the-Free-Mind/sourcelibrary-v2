// Pull every served page vector (page_translations rows with a non-null `embedding`) to float32 shards.
//   node --env-file=/root/sourcelibrary/.env.production.local pull-embeddings.mjs [--workers 4] [--batch 5000] [--limit N]
// Output in $VECTOR_SEARCH_ROOT/shards: shard-<k>.f32 (row-major float32, 768/row), shard-<k>.jsonl
// (one rowLine per vector, same order), shard-<k>.ck.json (checkpoint), pull.json (start time, totals).
// Resumable: a re-run continues each shard from its checkpoint. Read-only on the database.
//
// PRIOR ART: sourcelibrary-atlas scripts/local-corpus/pull-embeddings.mjs — same keyset-on-page_id
// shards and checkpoints. Changed: Postgres instead of PostgREST (~25× faster from l7a), no
// `translation` column (the service never serves text, and it was most of the bytes), and the row
// carries book_language/book_year, the two columns match_semantic filters on.
import fs from 'node:fs';
import path from 'node:path';
import { DIM, SHARD_DIR, PULL_EDGES, ROW_SELECT, pgClient, parseVector, rowLine, writeJsonAtomic, log } from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const WORKERS = +arg('--workers', 4);
const BATCH = +arg('--batch', 5000);
const LIMIT = +arg('--limit', 0); // per shard, for tests
fs.mkdirSync(SHARD_DIR, { recursive: true });

const edges = PULL_EDGES;

const pullPath = path.join(SHARD_DIR, 'pull.json');
let pull = fs.existsSync(pullPath) ? JSON.parse(fs.readFileSync(pullPath, 'utf8')) : null;
if (!pull) {
  // The delta sync starts from the moment the pull STARTED: a row re-embedded mid-pull behind a
  // shard's cursor is picked up by the first delta rather than lost.
  const c = await pgClient();
  const { rows: [{ now }] } = await c.query('SELECT now()::text AS now');
  await c.end();
  pull = { started_at: now, shards: edges.length - 1, done: false };
  writeJsonAtomic(pullPath, pull);
}

async function shard(k, conn) {
  const lo = edges[k], hi = edges[k + 1];
  const ckPath = path.join(SHARD_DIR, `shard-${k}.ck.json`);
  const ck = fs.existsSync(ckPath) ? JSON.parse(fs.readFileSync(ckPath, 'utf8')) : { last: lo, rows: 0, done: false };
  if (ck.done) return ck.rows;
  const fPath = path.join(SHARD_DIR, `shard-${k}.f32`), jPath = path.join(SHARD_DIR, `shard-${k}.jsonl`);
  // A crash between the two appends and the checkpoint leaves extra tail bytes: cut both files back.
  if (fs.existsSync(fPath) && fs.statSync(fPath).size !== ck.rows * DIM * 4) fs.truncateSync(fPath, ck.rows * DIM * 4);
  if (fs.existsSync(jPath)) {
    const lines = fs.readFileSync(jPath, 'utf8').split('\n').filter(Boolean);
    if (lines.length !== ck.rows) fs.writeFileSync(jPath, lines.slice(0, ck.rows).map((l) => l + '\n').join(''));
  }
  const vec = fs.openSync(fPath, 'a'), rows = fs.openSync(jPath, 'a');
  const t0 = Date.now(); let n = 0;
  for (;;) {
    const q = `SELECT ${ROW_SELECT}, embedding::text AS e FROM page_translations
               WHERE page_id > $1 ${hi ? 'AND page_id < $2' : ''} AND embedding IS NOT NULL
               ORDER BY page_id LIMIT ${BATCH}`;
    let res;
    for (let attempt = 1; ; attempt++) {
      try { res = await conn.c.query(q, hi ? [ck.last, hi] : [ck.last]); break; }
      catch (e) {
        if (attempt >= 8) throw e;
        log(`shard ${k}: ${e.message} — retry ${attempt}`);
        await new Promise((r) => setTimeout(r, Math.min(60000, 2000 * 2 ** attempt)));
        try { await conn.c.end(); } catch {}
        conn.c = await pgClient();
      }
    }
    const batch = res.rows; if (!batch.length) break;
    const buf = Buffer.allocUnsafe(batch.length * DIM * 4);
    const f = new Float32Array(buf.buffer, buf.byteOffset, batch.length * DIM);
    let m = 0, lines = '';
    for (const r of batch) {
      ck.last = r.page_id;
      if (!parseVector(r.e, f.subarray(m * DIM, (m + 1) * DIM))) continue;
      lines += rowLine(r) + '\n'; m++;
    }
    fs.writeSync(vec, buf, 0, m * DIM * 4); fs.writeSync(rows, lines);
    ck.rows += m; n += m; writeJsonAtomic(ckPath, ck);
    if ((n / BATCH) % 20 === 0) log(`shard ${k}: ${ck.rows.toLocaleString()} rows · ${(n / ((Date.now() - t0) / 1000)).toFixed(0)} rows/s · at ${ck.last.slice(0, 8)}`);
    if (batch.length < BATCH || (LIMIT && ck.rows >= LIMIT)) break;
  }
  ck.done = true; writeJsonAtomic(ckPath, ck); fs.closeSync(vec); fs.closeSync(rows);
  log(`shard ${k} done: ${ck.rows.toLocaleString()} rows`);
  return ck.rows;
}

log('pull start', pull.started_at, 'ranges', edges.length - 1, 'workers', WORKERS);
const queue = edges.slice(0, -1).map((_, k) => k);
const counts = [];
await Promise.all(Array.from({ length: WORKERS }, async () => {
  const conn = { c: await pgClient() };
  try { for (;;) { const k = queue.shift(); if (k === undefined) return; counts.push(await shard(k, conn)); } }
  finally { try { await conn.c.end(); } catch {} }
}));
pull.done = true; pull.finished_at = new Date().toISOString(); pull.rows = counts.reduce((a, b) => a + b, 0);
writeJsonAtomic(pullPath, pull);
log('pull done rows', pull.rows.toLocaleString());
