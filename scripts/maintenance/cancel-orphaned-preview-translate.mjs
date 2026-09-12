#!/usr/bin/env node
/**
 * Cancel orphaned preview-TRANSLATION jobs.
 *
 * WHY. #4432 removed import-time preview OCR and the preview translation it
 * auto-triggered. Removing the trigger does not empty the queue: 5,011
 * `preview_translate` jobs were already sitting in `jobs`, and the moment the
 * pipeline was unpaused behind a $5 dial, translate-worker began draining them.
 *
 * It drained them THROUGH the ceiling. translate-worker checks the pause and
 * gates `selfDispatch` on the budget, but consuming already-queued jobs asks
 * nothing — so the dial cannot stop work that was queued before it was set.
 * Observed 2026-08-30 22:42Z: $0.72 in 30 minutes with the guard reporting
 * "CEILING REACHED — no new dispatch". Both statements were true at once.
 *
 * The jobs are orphans twice over: the feature that created them is deleted,
 * and they translate the opening pages of books that are un-enrolled, unarchived
 * and invisible. Cancelling loses nothing — those books will be translated by
 * the normal dial-gated path when they reach it.
 *
 * Only `pending` jobs are cancelled. Jobs already `processing` are left to
 * finish rather than half-cancelled, which would leave their pages ambiguous.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/cancel-orphaned-preview-translate.mjs
 *   node --env-file=.env.production.local scripts/maintenance/cancel-orphaned-preview-translate.mjs --apply
 */

import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const REASON = 'cancelled: orphaned by #4432 (preview translate removed); drained outside the dial';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const jobs = db.collection('jobs');

const filter = { initiated_by: 'preview_translate', status: 'pending' };

const total = await jobs.countDocuments(filter);
const [agg] = await jobs.aggregate([
  { $match: filter },
  { $group: { _id: null, pages: { $sum: '$progress.total' } } },
]).toArray();
const oldest = await jobs.find(filter).sort({ created_at: 1 }).limit(1).project({ created_at: 1 }).toArray();
const processing = await jobs.countDocuments({ initiated_by: 'preview_translate', status: 'processing' });

console.log(`pending preview_translate jobs : ${total}`);
console.log(`pages they would translate     : ${agg?.pages ?? 0}`);
console.log(`oldest queued                  : ${oldest[0]?.created_at?.toISOString() ?? 'n/a'}`);
console.log(`left running (processing)      : ${processing}`);

if (!APPLY) {
  console.log('\nDRY RUN — re-run with --apply to cancel.');
  await client.close();
  process.exit(0);
}

const res = await jobs.updateMany(filter, {
  $set: { status: 'cancelled', cancel_reason: REASON, cancelled_at: new Date(), updated_at: new Date() },
});
console.log(`\nmatched ${res.matchedCount}, modified ${res.modifiedCount}`);

const bookIds = await jobs.distinct('book_id', { initiated_by: 'preview_translate', cancel_reason: REASON });
const cleared = await db.collection('books').updateMany(
  { id: { $in: bookIds }, 'job.type': 'realtime' },
  { $unset: { job: '' }, $set: { updated_at: new Date() } },
);
console.log(`cleared stale book.job pointers: ${cleared.modifiedCount} of ${bookIds.length} books`);

await client.close();
