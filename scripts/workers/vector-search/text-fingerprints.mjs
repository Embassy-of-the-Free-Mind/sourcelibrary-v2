// Fill the text store's fingerprint table (lib.mjs openTextStore, `fp`) from the rows it already holds,
// once, for a store made before the table existed. Every later write keeps `fp` current itself.
//   flock /tmp/vector-search-delta.lock node text-fingerprints.mjs
// Reads the 19 GB store once, in rowid order (insertion order: sequential reads). Run it under the
// delta lock, so no delta writes a row between this script's read of it and its fingerprint.
// Sets meta.fp_complete when every row has a fingerprint; until then sync-delta.mjs --reconcile skips
// its text comparison. Touches nothing outside the store (no Supabase, no service).
//
// PRIOR ART: pull-text.mjs (same directory) fills the store from Supabase; this derives a column from
// what the store holds, which is the thing the reconcile has to compare. Re-pulling 7.6M rows of text
// (30 min, ~19 GB of egress) to compute it would measure Supabase, not the copy.
import { openTextStore, textFingerprint, log } from './lib.mjs';

const CHUNK = 5000;
const store = openTextStore();
const read = store.db.prepare(`SELECT rowid, page_id, translation, book_title, book_author FROM pages WHERE rowid > ? ORDER BY rowid LIMIT ${CHUNK}`);
const put = store.db.prepare('INSERT OR REPLACE INTO fp (page_id, tl, ml, h) VALUES (?, ?, ?, ?)');
const t0 = Date.now(); let last = 0, n = 0;
for (;;) {
  const rows = read.all(last);
  if (!rows.length) break;
  store.tx(() => { for (const r of rows) { const f = textFingerprint(r); put.run(r.page_id, f.tl, f.ml, f.h); } });
  last = rows[rows.length - 1].rowid; n += rows.length;
  if (n % (CHUNK * 100) < rows.length) log(`${n.toLocaleString()} rows · ${(n / ((Date.now() - t0) / 1000)).toFixed(0)} rows/s`);
  if (rows.length < CHUNK) break;
}
const { pages } = store.db.prepare('SELECT count(*) AS pages FROM pages').get();
const { fps } = store.db.prepare('SELECT count(*) AS fps FROM fp').get();
const { orphans } = store.db.prepare('SELECT count(*) AS orphans FROM fp WHERE page_id NOT IN (SELECT page_id FROM pages)').get();
if (orphans) store.db.exec('DELETE FROM fp WHERE page_id NOT IN (SELECT page_id FROM pages)');
const complete = fps - orphans === pages;
if (complete) store.db.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('fp_complete', ?)").run(new Date().toISOString());
store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
store.db.close();
log(`fingerprints: ${n.toLocaleString()} rows read · ${pages.toLocaleString()} pages · ${(fps - orphans).toLocaleString()} fingerprints${orphans ? ` (${orphans} orphans dropped)` : ''} · ${complete ? 'complete' : 'INCOMPLETE — fp_complete not set'} · ${((Date.now() - t0) / 60000).toFixed(1)} min`);
process.exit(complete ? 0 : 1);
