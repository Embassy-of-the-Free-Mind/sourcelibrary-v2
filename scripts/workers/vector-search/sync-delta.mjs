// Bring the running vector service up to date with page_translations.
//   node --env-file=/root/sourcelibrary/.env.production.local sync-delta.mjs [--save] [--count-check] [--dry-run]
//
// 1. Rows with updated_at after the service's checkpoint (keyset on updated_at, page_id): a row with a
//    vector is added or replaced (re-embedded pages keep their key), a row whose vector is NULL is
//    removed. 2. Rows withheld since the checkpoint (#4523: the vector moves to embedding_withheld and
//    `embedding` becomes NULL, so match_semantic stops serving it) are removed too, in case the
//    withholding UPDATE did not bump updated_at. Deleted rows are not seen here; --count-check reports
//    the drift they leave (the nightly check in #6821).
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
import { ROW_SELECT, pgClient, parseVector, log } from './lib.mjs';

const LOCAL = `http://127.0.0.1:${process.env.VECTOR_SEARCH_LOCAL_PORT || 3459}`;
const BATCH = 500;
const SAVE = process.argv.includes('--save');
const COUNT = process.argv.includes('--count-check');
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
const t0 = Date.now(); let ups = 0, rms = 0, applied = { added: 0, replaced: 0, removed: 0 };
const bump = (r) => { for (const k of Object.keys(applied)) applied[k] += r[k] || 0; };

for (;;) {
  const { rows } = await c.query(
    `SELECT ${ROW_SELECT}, embedding::text AS e, updated_at::text AS u FROM page_translations
     WHERE updated_at > $1::timestamptz OR (updated_at = $1::timestamptz AND page_id > $2)
     ORDER BY updated_at, page_id LIMIT ${BATCH}`, [cp.updated_at, cp.page_id]);
  if (!rows.length) break;
  const upserts = [], removes = [];
  for (const r of rows) {
    const v = parseVector(r.e);
    if (v) upserts.push({ page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, book_language: r.book_language, book_year: r.book_year, embedding: Array.from(v) });
    else removes.push(r.page_id);
  }
  const last = rows[rows.length - 1];
  cp = { updated_at: last.u, page_id: last.page_id };
  ups += upserts.length; rms += removes.length;
  if (!DRY) bump(await call('/admin/apply', { upserts, removes, checkpoint: cp }));
  if (rows.length < BATCH) break;
}

// Withheld since the checkpoint we started from (idempotent: removing an absent row is a no-op).
const { rows: withheld } = await c.query(
  `SELECT page_id FROM page_translations WHERE withheld_at > $1::timestamptz AND embedding IS NULL`, [h0.checkpoint.updated_at]);
if (withheld.length) { rms += withheld.length; if (!DRY) bump(await call('/admin/apply', { removes: withheld.map((r) => r.page_id) })); }
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
