#!/usr/bin/env node
/**
 * Cancel pending import-preview OCR jobs.
 *
 * WHY. `src/lib/preview-ocr.ts` fires a 25-page OCR job at every newly imported
 * book, straight onto the SQS/Lambda realtime path. That path consults neither
 * `system_config.processing_control.paused` nor the daily dial — so it kept
 * spending through a pause set with the reason "Derek: pause Gemini spend until
 * prioritized". Between 2026-08-27 and 08-30 it billed ~$392 across 114,344
 * calls, on books the paused pipeline was never going to archive or publish.
 *
 * The queue also does not drain: the oldest pending preview job dates from
 * 2026-07-05. Cancelling is the reversible half of the fix — the OCR worker
 * checks `job.status === 'cancelled'` and skips, so in-flight SQS messages
 * drain harmlessly, and the books remain eligible for preview OCR once it moves
 * to the post-archive batch pool.
 *
 * This only touches jobs still `pending`. Jobs already `processing` are left to
 * finish rather than half-cancelled, which would leave their pages ambiguous.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/cancel-stuck-preview-ocr.mjs
 *   node --env-file=.env.production.local scripts/maintenance/cancel-stuck-preview-ocr.mjs --apply
 */

import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const REASON = 'cancelled: preview OCR bypassed the processing pause (#4427 follow-up)';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const jobs = db.collection('jobs');

const filter = { initiated_by: 'import_preview', status: 'pending' };

const total = await jobs.countDocuments(filter);
const [agg] = await jobs.aggregate([
  { $match: filter },
  { $group: { _id: null, pages: { $sum: '$progress.total' } } },
]).toArray();
const oldest = await jobs.find(filter).sort({ created_at: 1 }).limit(1)
  .project({ created_at: 1 }).toArray();

console.log(`pending import_preview jobs : ${total}`);
console.log(`pages they would OCR        : ${agg?.pages ?? 0}`);
console.log(`oldest queued               : ${oldest[0]?.created_at?.toISOString() ?? 'n/a'}`);

// Report what is deliberately left alone, so the untouched set is visible
// rather than merely absent — a silent omission reads as "nothing there".
const processing = await jobs.countDocuments({ initiated_by: 'import_preview', status: 'processing' });
console.log(`left running (status=processing, not touched): ${processing}`);

if (!APPLY) {
  console.log('\nDRY RUN — re-run with --apply to cancel.');
  await client.close();
  process.exit(0);
}

const res = await jobs.updateMany(filter, {
  $set: {
    status: 'cancelled',
    cancel_reason: REASON,
    cancelled_at: new Date(),
    updated_at: new Date(),
  },
});
console.log(`\nmatched ${res.matchedCount}, modified ${res.modifiedCount}`);

// Clear the book-level active-job pointer these jobs left behind, so the books
// are not stuck advertising a job that will never run.
const bookIds = await jobs.distinct('book_id', {
  initiated_by: 'import_preview', cancel_reason: REASON,
});
const cleared = await db.collection('books').updateMany(
  { id: { $in: bookIds }, 'job.type': 'realtime' },
  { $unset: { job: '' }, $set: { updated_at: new Date() } },
);
console.log(`cleared stale book.job pointers: ${cleared.modifiedCount} of ${bookIds.length} books`);

await client.close();
