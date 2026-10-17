// Fill the text store (lib.mjs openTextStore) with match_semantic's text columns for every served row.
//   node --env-file=/root/sourcelibrary/.env.production.local pull-text.mjs [--workers 4] [--batch 2000] [--limit N]
// Output: $VECTOR_SEARCH_ROOT/text/pages.sqlite. Resumable: each key range's cursor is committed in the
// same transaction as its rows (table pull_ck). Read-only on the database. Safe beside sync-delta.mjs:
// an upsert only replaces an older updated_at, so a delta's newer text is never overwritten.
// Measured 2026-10-17 on a 1% sample: ~1.84 KB of translation per row, ~14 GB for 7.63M rows.
//
// PRIOR ART: pull-embeddings.mjs (same directory) — same key ranges, worker pool and retry. Changed:
// the text columns instead of the vector, and SQLite instead of append-only shards, because the delta
// has to replace a row in place.
import { PULL_EDGES, TEXT_SELECT, pgClient, openTextStore, log } from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const WORKERS = +arg('--workers', 4);
const BATCH = +arg('--batch', 2000);
const LIMIT = +arg('--limit', 0); // per range, for tests

const store = openTextStore();
const getCk = store.db.prepare('SELECT last, rows, done FROM pull_ck WHERE shard = ?');
const putCk = store.db.prepare('INSERT OR REPLACE INTO pull_ck (shard, last, rows, done) VALUES (?, ?, ?, ?)');
const edges = PULL_EDGES;
const t0 = Date.now(); let total = 0, bytes = 0;

async function range(k, conn) {
  const lo = edges[k], hi = edges[k + 1];
  const ck = getCk.get(k) || { last: lo, rows: 0, done: 0 };
  if (ck.done) return;
  for (;;) {
    // Only rows match_semantic can return (embedding IS NOT NULL): withheld rows are not served.
    const q = `SELECT ${TEXT_SELECT} FROM page_translations
               WHERE page_id > $1 ${hi ? 'AND page_id < $2' : ''} AND embedding IS NOT NULL
               ORDER BY page_id LIMIT ${BATCH}`;
    let res;
    for (let attempt = 1; ; attempt++) {
      try { res = await conn.c.query(q, hi ? [ck.last, hi] : [ck.last]); break; }
      catch (e) {
        if (attempt >= 8) throw e;
        log(`range ${k}: ${e.message} — retry ${attempt}`);
        await new Promise((r) => setTimeout(r, Math.min(60000, 2000 * 2 ** attempt)));
        try { await conn.c.end(); } catch {}
        conn.c = await pgClient();
      }
    }
    const batch = res.rows;
    const end = !batch.length || batch.length < BATCH || (LIMIT && ck.rows + batch.length >= LIMIT);
    store.tx(() => {
      for (const r of batch) { store.upsert(r); bytes += r.translation?.length || 0; }
      if (batch.length) { ck.last = batch[batch.length - 1].page_id; ck.rows += batch.length; }
      putCk.run(k, ck.last, ck.rows, end ? 1 : 0);
    });
    total += batch.length;
    if (total % (BATCH * 50) < batch.length) {
      log(`${total.toLocaleString()} rows · ${(total / ((Date.now() - t0) / 1000)).toFixed(0)} rows/s · ${(bytes / 1e9).toFixed(2)} G chars`);
    }
    if (end) break;
  }
  log(`range ${k} done: ${ck.rows.toLocaleString()} rows`);
}

log('text pull start', 'ranges', edges.length - 1, 'workers', WORKERS);
const queue = edges.slice(0, -1).map((_, k) => k);
await Promise.all(Array.from({ length: WORKERS }, async () => {
  const conn = { c: await pgClient() };
  try { for (;;) { const k = queue.shift(); if (k === undefined) return; await range(k, conn); } }
  finally { try { await conn.c.end(); } catch {} }
}));
const { n } = store.db.prepare('SELECT count(*) AS n FROM pages').get();
store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
store.db.close();
log(`text pull done: ${total.toLocaleString()} rows this run, ${n.toLocaleString()} in the store · ${((Date.now() - t0) / 60000).toFixed(1)} min`);
