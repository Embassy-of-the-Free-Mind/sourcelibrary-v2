#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/reset-book-ocr.mjs — resets a WHOLE BOOK's OCR
 * (cancels jobs, clears text, bumps ocr_generation). Wrong grain: this reopens
 * individual pages that were given up on, touches no existing text, and cancels
 * nothing. scripts/batch/realtime-ocr.mjs re-OCRs pages but has no notion of a
 * give-up and would re-run pages that are still legitimately blocked.
 *
 * Reopen pages a give-up has stranded (#4674).
 *
 * Why this exists: the per-page block used to be permanent. 967 pages entered a
 * retry loop and were parked; 959 of them had not been tried in over 30 days,
 * and when six were re-probed against the CURRENT model, three read cleanly on
 * the first attempt. They were never unreadable — they were blocked by a
 * transcriber we no longer run.
 *
 * New blocks carry `ocr.fail_blocked_model` and expire on their own when the
 * model changes. This script is for the pages blocked BEFORE that field existed,
 * which carry no model and would otherwise stay parked forever.
 *
 * Reopening is ACTUATION: these pages go back in the OCR queue and the next
 * orchestrator pass will spend on them. Dry-run by default; --apply writes.
 * Scope it with --collection or --book so the spend is bounded by something you
 * chose, and run it behind a scope envelope (scripts/maintenance/set-scope.mjs).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/retry-model-blocked-pages.mjs
 *   node --env-file=.env.production.local scripts/maintenance/retry-model-blocked-pages.mjs \
 *     --collection forum-of-conscience --apply
 *   node --env-file=.env.production.local scripts/maintenance/retry-model-blocked-pages.mjs \
 *     --stale-days 30 --limit 200 --apply
 */
import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const has = (n) => args.includes(`--${n}`);
const val = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

const APPLY = has('apply');
const COLLECTION = val('collection');
const BOOK = val('book');
const STALE_DAYS = parseInt(val('stale-days', '30'), 10);
const LIMIT = parseInt(val('limit', '0'), 10);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// Only pages whose block predates model-scoping. A block that names its model
// already expires by itself; re-opening it here would fight that mechanism.
const filter = {
  'ocr.fail_blocked': true,
  'ocr.fail_blocked_model': { $in: [null, undefined] },
};
if (STALE_DAYS > 0) {
  filter.$or = [
    { 'ocr.fail_blocked_at': { $lt: new Date(Date.now() - STALE_DAYS * 86400000) } },
    { 'ocr.fail_blocked_at': { $exists: false } },
  ];
}

if (BOOK) filter.book_id = BOOK;
else if (COLLECTION) {
  const ids = await db.collection('books').distinct('id', { collections: COLLECTION });
  if (!ids.length) { console.error(`No books in collection '${COLLECTION}'.`); process.exit(1); }
  filter.book_id = { $in: ids };
  console.log(`Scoped to collection '${COLLECTION}' (${ids.length} books).`);
}

const total = await db.collection('pages').countDocuments(filter);
console.log(`Pages blocked with no model recorded${STALE_DAYS > 0 ? ` and idle ${STALE_DAYS}+ days` : ''}: ${total}`);
if (total === 0) { await client.close(); process.exit(0); }

// Show what we are about to reopen, by book — a bare total hides a runaway book.
const byBook = await db.collection('pages').aggregate([
  { $match: filter },
  { $group: { _id: '$book_id', n: { $sum: 1 } } },
  { $sort: { n: -1 } }, { $limit: 15 },
]).toArray();
const titles = new Map((await db.collection('books')
  .find({ id: { $in: byBook.map(b => b._id) } }, { projection: { id: 1, title: 1, language: 1 } })
  .toArray()).map(b => [b.id, b]));
console.log('\nTop books:');
for (const b of byBook) {
  const t = titles.get(b._id) || {};
  console.log(`  ${String(b.n).padStart(4)} page(s)  ${String(t.language || '?').padEnd(8)} ${String(t.title || b._id).slice(0, 54)}`);
}

if (!APPLY) {
  console.log(`\nDRY RUN — would reopen ${LIMIT > 0 ? Math.min(LIMIT, total) : total} page(s). Pass --apply to write.`);
  console.log('Reopened pages re-enter the OCR queue and WILL be paid for. Set a scope envelope first.');
  await client.close();
  process.exit(0);
}

// Clear the give-up. Leave ocr.data alone — some of these hold a partial read,
// and destroying text is never part of reopening a queue.
let ids = null;
if (LIMIT > 0) {
  ids = (await db.collection('pages').find(filter, { projection: { id: 1 } }).limit(LIMIT).toArray()).map(p => p.id);
}
const res = await db.collection('pages').updateMany(
  ids ? { id: { $in: ids } } : filter,
  { $unset: { 'ocr.fail_blocked': '', 'ocr.fail_blocked_at': '', 'ocr.fail_count': '', 'ocr.fail_reason': '' },
    $set: { 'ocr.reopened_at': new Date() } }
);
console.log(`\nreopened: matched=${res.matchedCount} modified=${res.modifiedCount}`);

await db.collection('audit_log').insertOne({
  action: 'ocr_blocked_pages_reopened',
  metadata: { issue: 4674, scope: BOOK ? { book: BOOK } : COLLECTION ? { collection: COLLECTION } : 'corpus',
              stale_days: STALE_DAYS, limit: LIMIT || null, matched: res.matchedCount, modified: res.modifiedCount },
  timestamp: new Date(),
});
console.log('audit_log written');
await client.close();
