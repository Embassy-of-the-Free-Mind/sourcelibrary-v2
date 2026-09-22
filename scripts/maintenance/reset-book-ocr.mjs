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
 * A HELD book (scripts/lib/pipeline-hold.mjs) gets steps 1-4 and NOT step 5's
 * status write. Everything this script destroys is legitimate to destroy under a
 * hold — that is usually why the book is held — but the requeue is not: setting
 * `archive_complete` on a held book silently LIFTS the hold and hands the book
 * straight back to the lane the hold existed to keep it out of. The hold
 * mechanism (#4790) postdates this script, so the write was unconditional until
 * 2026-09-15, when a caller had to reimplement steps 4+5 by hand to avoid it.
 * `batch-collector.mjs` states the same rule for its own write-back: a reset
 * must never lift a pipeline hold. Release with
 * `scripts/maintenance/hold-pipeline-books.mjs --release-held`, not by side effect.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *   node scripts/maintenance/reset-book-ocr.mjs <book-id-or-slug> [options]
 *
 * Options:
 *   --dry-run              Report what would change, write nothing.
 *   --also-translation     Clear translation.data alongside ocr.data.
 *   --translation-only     Clear ONLY translation.data; leave ocr.data untouched and do NOT
 *                          requeue the book. For undoing a translation pass that should never
 *                          have run (e.g. an English→English "modernization" written onto a
 *                          modern-print book — see #4958) without destroying paid OCR. Snapshots
 *                          to page_revisions and cancels outstanding TRANSLATION jobs exactly as
 *                          the OCR path does; skips the ocr_generation bump, which is an OCR
 *                          concept, and skips the archive_complete requeue, which would re-OCR a
 *                          book whose text is fine.
 *   --pages 5-39           Only clear a page_number range (inclusive).
 *   --reason "..."         Recorded on the revision notes (default: manual reset).
 */

import { MongoClient } from 'mongodb';
import { randomBytes } from 'crypto';
import { isHeld } from '../lib/pipeline-hold.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ALSO_TRANSLATION = args.includes('--also-translation');
const TRANSLATION_ONLY = args.includes('--translation-only');
if (ALSO_TRANSLATION && TRANSLATION_ONLY) {
  console.error('--also-translation and --translation-only are mutually exclusive');
  process.exit(1);
}
/** Which page fields this run destroys. The rest of the script keys off this. */
const FIELDS = TRANSLATION_ONLY ? ['translation'] : ALSO_TRANSLATION ? ['ocr', 'translation'] : ['ocr'];
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
  // 'pipeline_auto.hold' is what isHeld() reads. Project it or the hold check
  // below sees undefined on every book and silently passes them all through to
  // the requeue — the #4563/#4565 projection-starvation shape.
  { projection: { id: 1, slug: 1, title: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, 'pipeline_auto.ocr_generation': 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1, needs_splitting: 1, split_completed: 1 } }
);
if (!book) { console.error(`Book not found: ${target}`); process.exit(1); }

const currentGen = book.pipeline_auto?.ocr_generation || 0;
console.log(`\n=== Reset ${FIELDS.join(' + ')}: ${(book.title || '').slice(0, 60)} ===`);
console.log(
  `id: ${book.id} | status: ${book.pipeline_auto?.status} | ocr ${book.pages_ocr}/${book.pages_count}` +
    (TRANSLATION_ONLY ? ` | generation ${currentGen} (unchanged)` : ` | generation ${currentGen} -> ${currentGen + 1}`)
);
if (book.needs_splitting && !book.split_completed) {
  console.log('NOTE: book is an unsplit spread — after reset it re-OCRs via the spread-aware path.');
}
const HELD = isHeld(book);
if (HELD) {
  const h = book.pipeline_auto.hold;
  console.log(`HELD (${h.reason}${h.issue ? ` #${h.issue}` : ''}) — the reset will run, but pipeline_auto.status stays 'held'.`);
  console.log(`  release condition: ${h.release}`);
  console.log(`  release with: node scripts/maintenance/hold-pipeline-books.mjs --release-held --reason ${h.reason} --book ${book.id} --apply`);
} else if (TRANSLATION_ONLY) {
  console.log(`Translation-only — ocr.data and pipeline_auto.status are left untouched (no requeue).`);
} else {
  console.log(`Not held — the book will be requeued at archive_complete.`);
}
if (DRY_RUN) console.log('DRY RUN — nothing will be written.');

// 1. Outstanding jobs for whichever lane this run destroys. Cancelling the OCR
// lane on a --translation-only run would kill a live OCR pass the run is not
// touching; cancelling the translation lane is what closes the resurrect window
// for the text being cleared.
const JOB_TYPE = TRANSLATION_ONLY ? 'translation' : 'ocr';
const activeJobFilter = {
  $or: [{ book_id: book.id }, { book_ids: book.id }],
  type: JOB_TYPE,
  status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
};
const activeJobs = await db.collection('batch_jobs').countDocuments(activeJobFilter);
console.log(`Outstanding ${JOB_TYPE} batch_jobs to cancel: ${activeJobs}`);

// 2. Pages to clear — selected on the field this run actually destroys.
const pageFilter = { book_id: book.id, [`${FIELDS[0]}.data`]: { $exists: true, $nin: [null, ''] } };
if (pageRange) pageFilter.page_number = pageRange;
const pages = await db.collection('pages').find(
  pageFilter, { projection: { id: 1, book_id: 1, ocr: 1, translation: 1 } }
).toArray();
console.log(`Pages to clear: ${pages.length}${pageRange ? ` (page_number ${pageRange.$gte}-${pageRange.$lte})` : ''} (${FIELDS.join(' + ')} only)`);

if (DRY_RUN) { await client.close(); process.exit(0); }

// 3. Revisions first — never destroy without a snapshot
let revisions = 0;
for (const p of pages) {
  for (const field of FIELDS) {
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
// `ocr_generation` guards the OCR collector only; a --translation-only run does
// not touch ocr.data, and bumping it would invalidate a live OCR pass for text
// this run is deliberately preserving.
if (!TRANSLATION_ONLY) {
  await db.collection('books').updateOne({ id: book.id }, {
    $inc: { 'pipeline_auto.ocr_generation': 1 },
    $set: { 'pipeline_auto.last_updated': new Date() },
  });
}

// 6. Clear page fields
const unset = Object.fromEntries(FIELDS.map((f) => [f, '']));
const clearFilter = { book_id: book.id };
if (pageRange) clearFilter.page_number = pageRange;
const clearRes = await db.collection('pages').updateMany(clearFilter, { $unset: unset });
console.log(`Pages cleared: ${clearRes.modifiedCount}`);

// 7. Recount + requeue
const remainingOcr = await db.collection('pages').countDocuments({ book_id: book.id, 'ocr.data': { $exists: true, $nin: [null, ''] } });
const remainingTr = await db.collection('pages').countDocuments({ book_id: book.id, 'translation.data': { $exists: true, $nin: [null, ''] } });
// A held book gets the counters but NOT the status write — see the header. The
// counters are just recounts of what step 6 did; the status write is the one
// that would release the hold.
// A --translation-only run also leaves the status alone: the book's OCR is intact
// and requeueing at archive_complete would re-run the whole OCR pass. And once the
// last translated page is gone, `is_fully_translated` is a live lie — it gates
// badges and feeds homepage stats (invariants/visibility-and-stats.md), so it is
// cleared in the same update that zeroes the counter, never left to a later sweep.
const keepStatus = HELD || TRANSLATION_ONLY;
await db.collection('books').updateOne({ id: book.id }, {
  $set: {
    pages_ocr: remainingOcr,
    pages_translated: remainingTr,
    ...(remainingTr === 0 ? { is_fully_translated: false } : {}),
    ...(keepStatus ? {} : { 'pipeline_auto.status': 'archive_complete' }),
    'pipeline_auto.last_updated': new Date(),
  },
});
console.log(
  TRANSLATION_ONLY
    ? `Translation cleared; OCR and status untouched | pages_ocr: ${remainingOcr} | pages_translated: ${remainingTr}` +
      (remainingTr === 0 ? ' | is_fully_translated: false' : '')
    : HELD
    ? `Book left HELD (status untouched) | pages_ocr: ${remainingOcr} | pages_translated: ${remainingTr} | generation: ${currentGen + 1}\n` +
      `  It will NOT re-enter OCR until the hold is released: node scripts/maintenance/hold-pipeline-books.mjs --release-held --reason ${book.pipeline_auto.hold.reason} --book ${book.id} --apply`
    : `Book requeued at archive_complete | pages_ocr: ${remainingOcr} | pages_translated: ${remainingTr} | generation: ${currentGen + 1}`
);

await client.close();
