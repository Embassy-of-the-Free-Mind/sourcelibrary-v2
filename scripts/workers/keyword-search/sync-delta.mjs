// Bring the running keyword service up to date with Mongo `pages` and the live-book set.
//   node --env-file=/root/sourcelibrary/.env.production.local sync-delta.mjs [--max 200000] [--dry-run]
//
// 1. Pages whose translation.updated_at or ocr.updated_at is at or after the checkpoint (one cursor per
//    field, each on its own index, oldest first). A page with text and page_number > 0 is upserted; one
//    without either is removed. `$gte` re-reads the boundary timestamp every run, so a batch of pages
//    sharing one timestamp is never half-missed; re-applying a page is harmless.
// 2. The live-book set (visible, pages_count > 0, not hidden — the route's join filter plus its hidden
//    drop), so a book that is published or hidden changes the results within one run, with no page
//    touched. The server refuses a set under 1,000 books, so a failed read cannot empty the results.
// 3. The new checkpoint, one per field, posted last: a run that dies part-way repeats its work.
//
// Not seen here: a page deleted outright, or renumbered without a text edit. Both stay in the index until
// the next rebuild, and both are harmless to readers: the app hydrates every hit from Mongo by page id and
// drops a page that is gone or has page_number <= 0 (src/lib/keyword-search.ts).
//
// The service applies the writes in its own process (POST /admin/apply on 127.0.0.1), as the vector
// service's delta does: tantivy allows one writer per index, and the service holds it. The text goes as
// it is; the service tokenizes it with the index's own analyzer (kwindex.py).
//
// PRIOR ART: scripts/workers/vector-search/sync-delta.mjs — same shape over Supabase page_translations,
// keyset on (updated_at, page_id). `pages` has no compound (updated_at, _id) index, only one per field, so
// this keys on the timestamp alone with `$gte` and idempotent upserts.
import { mongo, log, PAGE_PROJECTION, pageRow } from './lib.mjs';

const LOCAL = `http://127.0.0.1:${process.env.KEYWORD_SEARCH_LOCAL_PORT || 3461}`;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MAX = +arg('--max', 200000);
const DRY = process.argv.includes('--dry-run');
const BATCH = 200;
/** First run after a build: start this far before the pull began. */
const MARGIN_MS = 15 * 60 * 1000;

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

const h = await call('/health');
const cp0 = h.checkpoint || {};
const start = (f) => new Date(cp0[f] || (+new Date(cp0.u) - MARGIN_MS));
const cp = { tr: start('tr').toISOString(), ocr: start('ocr').toISOString() };
if (Number.isNaN(+new Date(cp.tr)) || Number.isNaN(+new Date(cp.ocr))) throw new Error(`service reports no usable checkpoint: ${JSON.stringify(cp0)}`);
log(`checkpoint tr ${cp.tr} ocr ${cp.ocr}`);

const { client, db } = await mongo();
const t0 = Date.now();
const total = { upserted: 0, removed: 0, read: 0 };
for (const [key, field] of [['tr', 'translation.updated_at'], ['ocr', 'ocr.updated_at']]) {
  const cur = db.collection('pages')
    .find({ [field]: { $gte: new Date(cp[key]) } }, { projection: { ...PAGE_PROJECTION, page_number: 1 } })
    .sort({ [field]: 1 })
    .hint({ [field]: -1 })
    .batchSize(BATCH);
  let up = [], rm = [], n = 0, last = null;
  const flush = async () => {
    if (!up.length && !rm.length) return;
    if (!DRY) { const r = await call('/admin/apply', { upserts: up, removes: rm }); for (const k of ['upserted', 'removed']) total[k] += r[k] || 0; }
    up = []; rm = [];
  };
  for await (const p of cur) {
    const r = pageRow(p);
    if (r) up.push(r); else if (p.id) rm.push(String(p.id));
    const ts = key === 'tr' ? p.translation?.updated_at : p.ocr?.updated_at;
    if (ts) last = new Date(ts);
    n++; total.read++;
    if (up.length + rm.length >= BATCH) await flush();
    if (n >= MAX) { log(`${key}: stopped at --max ${MAX}; the next run continues from ${last?.toISOString()}`); break; }
  }
  await cur.close();
  await flush();
  if (last) cp[key] = last.toISOString();
  log(`${key}: ${n} pages read`);
}

const live = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, hidden: { $ne: true } }, { projection: { _id: 0, id: 1 } }).toArray();
const liveIds = live.map((b) => b.id).filter(Boolean);
const lr = DRY ? { posted: liveIds.length } : await call('/admin/live', { book_ids: liveIds });
if (!DRY) await call('/admin/checkpoint', { checkpoint: cp });
log(`delta ${JSON.stringify(total)} · live ${JSON.stringify(lr)} · checkpoint ${JSON.stringify(cp)} · ${((Date.now() - t0) / 1000).toFixed(1)} s${DRY ? ' (dry run)' : ''}`);
await client.close();
