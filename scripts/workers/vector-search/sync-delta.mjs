// Bring the running vector service up to date with page_translations.
//   node --env-file=/root/sourcelibrary/.env.production.local sync-delta.mjs [--save] [--count-check] [--reconcile] [--dry-run]
//
// 1. Rows with updated_at after the service's checkpoint (keyset on updated_at, page_id): a row with a
//    vector is added or replaced (re-embedded pages keep their key), a row whose vector is NULL is
//    removed. 2. Rows withheld since the checkpoint (#4523: the vector moves to embedding_withheld and
//    `embedding` becomes NULL, so match_semantic stops serving it) are removed too, in case the
//    withholding UPDATE did not bump updated_at. Deleted rows are not seen here; --count-check reports
//    the drift they leave (the nightly check in #6821).
// 3. The text store (phase 4): the same rows' translation, book_title and book_author are written to
//    text/pages.sqlite BEFORE the service sees the vector, so a row the service can return has its
//    text; a removed row is deleted from it. Skipped when the store does not exist yet (pull-text.mjs
//    creates it), so a delta never starts a partial store that serve mode would trust.
// 4. --reconcile (every 6 h, and nightly before the save): the updated_at delta CANNOT see a row whose
//    updated_at is older than the checkpoint, and the writer stamps updated_at with the page's Mongo
//    source time, not the write time (scripts/lib/page-embedding-text.mjs: `updated_at: mongoTs ||
//    new Date()`). A page translated at 04:00 and embedded at 16:00 lands behind a 14:50 checkpoint:
//    4,055 rows in the first 26 h after the pull (2026-10-17), all of them new pages. So the pass reads
//    every served page_id from Supabase in ONE unordered scan (a cursor; ~1–2 min, the cost of the
//    count(*) it replaces — ordered by page_id it was ~10K ids/s, 12 min), buckets them by pull range,
//    asks the service per range which it lacks and which it holds that Supabase no longer serves
//    (deleted rows too), and applies both. The result goes to logs/reconcile.json, where
//    freshness-check.mjs reads the drift instead of counting again.
// --save asks the service to write a new generation (tmp + rename, state.json last). Without it the
// changes live in RAM, and a restart re-applies them from the last saved checkpoint, so the
// half-hourly run never blocks queries on a 4 GB write; the nightly run saves.
//
// The service applies the changes in its own process (POST /admin/apply on the 127.0.0.1 listener)
// instead of this script loading a second 4 GB copy of the index into the 14 GB slice.
//
// PRIOR ART: scripts/workers/embed-gemini.mjs --incremental is the WRITER of these rows (Mongo →
// page_translations); this is a reader of the same table. The atlas pull has no delta at all (it
// re-pulls nightly), which takes hours at 4.5M rows.
import fs from 'node:fs';
import { ROW_SELECT, TEXT_DB_PATH, PULL_EDGES, RECONCILE_PATH, rangeOfPageId, pgClient, parseVector, openTextStore, writeJsonAtomic, log } from './lib.mjs';

const LOCAL = `http://127.0.0.1:${process.env.VECTOR_SEARCH_LOCAL_PORT || 3459}`;
const BATCH = 500;
const SAVE = process.argv.includes('--save');
const COUNT = process.argv.includes('--count-check');
const RECONCILE = process.argv.includes('--reconcile');
const DRY = process.argv.includes('--dry-run');

async function call(path, body) {
  const r = await fetch(LOCAL + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(600000),
  });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const h0 = await call('/health');
let cp = h0.checkpoint;
if (!cp?.updated_at) throw new Error('service reports no checkpoint');
const c = await pgClient();
const text = fs.existsSync(TEXT_DB_PATH) && !DRY ? openTextStore() : null;
const t0 = Date.now(); let ups = 0, rms = 0, applied = { added: 0, replaced: 0, removed: 0 };
const bump = (r) => { for (const k of Object.keys(applied)) applied[k] += r[k] || 0; };

for (;;) {
  const { rows } = await c.query(
    `SELECT ${ROW_SELECT}, embedding::text AS e, updated_at::text AS ut, extract(epoch from updated_at)::float8 AS u,
            translation, book_title, book_author FROM page_translations
     WHERE updated_at > $1::timestamptz OR (updated_at = $1::timestamptz AND page_id > $2)
     ORDER BY updated_at, page_id LIMIT ${BATCH}`, [cp.updated_at, cp.page_id]);
  if (!rows.length) break;
  const upserts = [], removes = [], texts = [];
  for (const r of rows) {
    const v = parseVector(r.e);
    if (v) texts.push(r);
    if (v) upserts.push({ page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, book_language: r.book_language, book_year: r.book_year, embedding: Array.from(v) });
    else removes.push(r.page_id);
  }
  const last = rows[rows.length - 1];
  cp = { updated_at: last.ut, page_id: last.page_id };
  if (text) text.tx(() => {
    for (const r of texts) text.upsert(r);
    for (const pid of removes) text.remove(pid);
  });
  ups += upserts.length; rms += removes.length;
  if (!DRY) bump(await call('/admin/apply', { upserts, removes, checkpoint: cp }));
  if (rows.length < BATCH) break;
}

// Withheld since the checkpoint we started from (idempotent: removing an absent row is a no-op).
const { rows: withheld } = await c.query(
  `SELECT page_id FROM page_translations WHERE withheld_at > $1::timestamptz AND embedding IS NULL`, [h0.checkpoint.updated_at]);
if (withheld.length) {
  rms += withheld.length;
  if (!DRY) bump(await call('/admin/apply', { removes: withheld.map((r) => r.page_id) }));
  if (text) text.tx(() => { for (const r of withheld) text.remove(r.page_id); });
}
if (RECONCILE) {
  const tr = Date.now(), session = `${process.pid}-${tr}`;
  const buckets = Array.from({ length: PULL_EDGES.length - 1 }, () => []);
  let ids = 0, onEdge = 0, missing = 0, extra = 0, fetched = 0;
  await c.query('BEGIN'); // a cursor lives in a transaction (the pooler keeps one backend for it)
  try {
    await c.query('DECLARE served NO SCROLL CURSOR FOR SELECT page_id FROM page_translations WHERE embedding IS NOT NULL');
    for (;;) {
      const { rows } = await c.query('FETCH 200000 FROM served');
      for (const r of rows) { const k = rangeOfPageId(r.page_id); if (k < 0) onEdge++; else buckets[k].push(r.page_id); }
      ids += rows.length;
      if (rows.length < 200000) break;
    }
  } finally { await c.query('COMMIT'); }
  const scanS = (Date.now() - tr) / 1000;
  const liveBefore = (await call('/health')).live_rows;
  for (let k = 0; k < buckets.length; k++) {
    const d = await call('/admin/diff', { session, range: k, ids: buckets[k] });
    buckets[k] = null;
    missing += d.missing.length; extra += d.extra.length;
    for (let i = 0; i < d.missing.length; i += BATCH) {
      const { rows } = await c.query(
        `SELECT ${ROW_SELECT}, embedding::text AS e, extract(epoch from updated_at)::float8 AS u, translation, book_title, book_author
         FROM page_translations WHERE page_id = ANY($1) AND embedding IS NOT NULL`, [d.missing.slice(i, i + BATCH)]);
      const upserts = [], texts = [];
      for (const r of rows) {
        const v = parseVector(r.e); if (!v) continue;
        texts.push(r);
        upserts.push({ page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, book_language: r.book_language, book_year: r.book_year, embedding: Array.from(v) });
      }
      fetched += upserts.length;
      if (DRY) continue;
      if (text) text.tx(() => { for (const r of texts) text.upsert(r); });
      bump(await call('/admin/apply', { upserts }));
    }
    if (d.extra.length && !DRY) {
      bump(await call('/admin/apply', { removes: d.extra }));
      if (text) text.tx(() => { for (const pid of d.extra) text.remove(pid); });
    }
  }
  const liveAfter = (await call('/health')).live_rows;
  const result = {
    at: new Date().toISOString(), supabase_served: ids, on_edge: onEdge, service_live_before: liveBefore, service_live_after: liveAfter,
    drift_before: liveBefore - ids, drift_after: liveAfter - ids, missing, fetched, extra, scan_s: scanS, total_s: (Date.now() - tr) / 1000, dry_run: DRY,
  };
  if (!DRY) writeJsonAtomic(RECONCILE_PATH, result);
  log(`reconcile: ${ids.toLocaleString()} served ids in Supabase (scan ${scanS.toFixed(1)} s) · ${missing} missing from the service (${fetched} fetched) · ${extra} in the service but no longer served · drift ${result.drift_before} → ${result.drift_after} · ${result.total_s.toFixed(1)} s${DRY ? ' (dry run)' : ''}`);
}

text?.db.close();
// Heartbeat: an empty apply stamps last_delta_at even when nothing changed, so freshness-check.mjs can
// tell a quiet half hour from a delta that stopped running.
if (!DRY) await call('/admin/apply', { checkpoint: cp });
log(`delta from ${h0.checkpoint.updated_at}: ${ups} upserts, ${rms} removals seen; applied ${JSON.stringify(applied)}; checkpoint ${cp.updated_at} · ${((Date.now() - t0) / 1000).toFixed(1)} s${DRY ? ' (dry run)' : ''}`);

let exit = 0;
if (COUNT) {
  const { rows: [{ n }] } = await c.query('SELECT count(*)::bigint AS n FROM page_translations WHERE embedding IS NOT NULL');
  const h = await call('/health');
  const drift = h.live_rows - Number(n);
  log(`count check: supabase ${Number(n).toLocaleString()} · service ${h.live_rows.toLocaleString()} (index size ${h.size.toLocaleString()}) · drift ${drift}`);
  // Rows deleted from page_translations leave live rows behind; more than 0.1% means a rebuild is due.
  if (Math.abs(drift) > Number(n) * 0.001) { log('COUNT DRIFT above 0.1% — rebuild (bootstrap.sh --rebuild)'); exit = 4; }
}
await c.end();
if (SAVE && !DRY) log('saved', JSON.stringify(await call('/admin/save', {})));
process.exit(exit);
