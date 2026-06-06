/**
 * Canonical OCR reset for a book (#2449).
 *
 * Manual "clear the OCR and let the pipeline redo it" resets used to be ad-hoc
 * Mongo updates, which left two traps armed:
 *   1. Outstanding batch_jobs from before the reset could be collected later
 *      and silently resurrect the cleared text (the spread-book incident).
 *   2. Nothing recorded that a reset happened, so the collector had no way to
 *      tell fresh results from stale ones.
 *
 * This script does the reset safely, in order:
 *   1. Saves a page_revisions snapshot of every cleared field (recoverable).
 *   2. Cancels the book's outstanding (pending/processing) OCR batch_jobs.
 *   3. Bumps pipeline_auto.ocr_generation — submitters stamp this on new jobs,
 *      and batch-collector refuses to save results from an older generation.
 *   4. Clears ocr (and optionally translation) on the selected pages.
 *   5. Resets book counters and queues it at archive_complete.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *   node scripts/maintenance/reset-book-ocr.mjs <book-id-or-slug> [options]
 *
 * Options:
 *   --dry-run              Report what would change, write nothing.
 *   --also-translation     Clear translation.data alongside ocr.data.
 *   --pages 5-39           Only clear a page_number range (inclusive).
 *   --reason "..."         Recorded on the revision notes (default: manual reset).
 */

import { MongoClient } from 'mongodb';
import { randomBytes } from 'crypto';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ALSO_TRANSLATION = args.includes('--also-translation');
const target = args.find(a => !a.startsWith('--'));
const reasonIdx = args.indexOf('--reason');
const REASON = reasonIdx !== -1 ? args[reasonIdx + 1] : 'manual reset via reset-book-ocr.mjs';
const pagesIdx = args.indexOf('--pages');
let pageRange = null;
if (pagesIdx !== -1) {
  const m = (args[pagesIdx + 1] || '').match(/^(\d+)-(\d+)$/);
  if (!m) { console.error('--pages expects a range like 5-39'); process.exit(1); }
  pageRange = { $gte: parseInt(m[1]), $lte: parseInt(m[2]) };
}

if (!target) {
  console.log('Usage: node scripts/maintenance/reset-book-ocr.mjs <book-id-or-slug> [--dry-run] [--also-translation] [--pages N-M] [--reason "..."]');
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const book = await db.collection('books').findOne(
  { $or: [{ id: target }, { slug: target }] },
  { projection: { id: 1, slug: 1, title: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, 'pipeline_auto.ocr_generation': 1, 'pipeline_auto.status': 1, needs_splitting: 1, split_completed: 1 } }
);
if (!book) { console.error(`Book not found: ${target}`); process.exit(1); }

const currentGen = book.pipeline_auto?.ocr_generation || 0;
console.log(`\n=== Reset OCR: ${(book.title || '').slice(0, 60)} ===`);
console.log(`id: ${book.id} | status: ${book.pipeline_auto?.status} | ocr ${book.pages_ocr}/${book.pages_count} | generation ${currentGen} -> ${currentGen + 1}`);
if (book.needs_splitting && !book.split_completed) {
  console.log('NOTE: book is an unsplit spread — after reset it re-OCRs via the spread-aware path.');
}
if (DRY_RUN) console.log('DRY RUN — nothing will be written.');

// 1. Outstanding OCR jobs
const activeJobFilter = {
  $or: [{ book_id: book.id }, { book_ids: book.id }],
  type: 'ocr',
  status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
};
const activeJobs = await db.collection('batch_jobs').countDocuments(activeJobFilter);
console.log(`Outstanding OCR batch_jobs to cancel: ${activeJobs}`);

// 2. Pages to clear
const pageFilter = { book_id: book.id, 'ocr.data': { $exists: true, $nin: [null, ''] } };
if (pageRange) pageFilter.page_number = pageRange;
const pages = await db.collection('pages').find(
  pageFilter, { projection: { id: 1, book_id: 1, ocr: 1, translation: 1 } }
).toArray();
console.log(`Pages to clear: ${pages.length}${pageRange ? ` (page_number ${pageRange.$gte}-${pageRange.$lte})` : ''}${ALSO_TRANSLATION ? ' (ocr + translation)' : ' (ocr only)'}`);

if (DRY_RUN) { await client.close(); process.exit(0); }

// 3. Revisions first — never destroy without a snapshot
let revisions = 0;
for (const p of pages) {
  const fields = ALSO_TRANSLATION ? ['ocr', 'translation'] : ['ocr'];
  for (const field of fields) {
    if (!p[field]?.data) continue;
    await db.collection('page_revisions').insertOne({
      id: randomBytes(6).toString('hex'),
      page_id: p.id, book_id: p.book_id, field,
      data: p[field].data, source: p[field].source || 'ai', model: p[field].model,
      language: p[field].language, prompt_version: p[field].prompt_version,
      original_date: p[field].updated_at, created_at: new Date(),
      note: `reset-book-ocr: ${REASON}`,
    });
    revisions++;
  }
}
console.log(`Revisions saved: ${revisions}`);

// 4. Cancel outstanding jobs BEFORE clearing pages (closes the resurrect window)
const cancelRes = await db.collection('batch_jobs').updateMany(activeJobFilter, {
  $set: { status: 'cancelled', error: `cancelled by reset-book-ocr: ${REASON}`, updated_at: new Date() },
});
console.log(`Jobs cancelled: ${cancelRes.modifiedCount}`);

// 5. Bump generation BEFORE clearing — any not-yet-cancelled job (e.g. created
// by a concurrent submitter mid-reset) is now stale by generation.
await db.collection('books').updateOne({ id: book.id }, {
  $inc: { 'pipeline_auto.ocr_generation': 1 },
  $set: { 'pipeline_auto.last_updated': new Date() },
});

// 6. Clear page fields
const unset = ALSO_TRANSLATION ? { ocr: '', translation: '' } : { ocr: '' };
const clearFilter = { book_id: book.id };
if (pageRange) clearFilter.page_number = pageRange;
const clearRes = await db.collection('pages').updateMany(clearFilter, { $unset: unset });
console.log(`Pages cleared: ${clearRes.modifiedCount}`);

// 7. Recount + requeue
const remainingOcr = await db.collection('pages').countDocuments({ book_id: book.id, 'ocr.data': { $exists: true, $nin: [null, ''] } });
const remainingTr = await db.collection('pages').countDocuments({ book_id: book.id, 'translation.data': { $exists: true, $nin: [null, ''] } });
await db.collection('books').updateOne({ id: book.id }, {
  $set: {
    pages_ocr: remainingOcr,
    pages_translated: remainingTr,
    'pipeline_auto.status': 'archive_complete',
    'pipeline_auto.last_updated': new Date(),
  },
});
console.log(`Book requeued at archive_complete | pages_ocr: ${remainingOcr} | pages_translated: ${remainingTr} | generation: ${currentGen + 1}`);

await client.close();
