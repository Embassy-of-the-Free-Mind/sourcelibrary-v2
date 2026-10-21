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
 *   0. Refuses a book where the run would clear text on more than 20% of its pages, unless
 *      --force-full (#7058). That is the 2026-10-21 failure: a requeue ran this on fully-read,
 *      untranslated books (Oettingen's Klang, Huygens's Œuvres vol. 20) and cleared 759 good
 *      pages. A reset is for a few poisoned pages or a book that never read; a full re-read of
 *      a book that reads is a decision, and the flag is where it is made.
 *   1. (was: a hand-rolled page_revisions snapshot — lossy: it kept text, source, model,
 *      language and prompt_version and dropped the rest of the record. Step 4 now clears
 *      through writePageText, which keeps the WHOLE prior field per page.)
 *   2. Ends the book's outstanding (pending/processing) OCR batch_jobs: never-submitted rows are
 *      cancelled; submitted single-book rows are marked `superseded` (paid output discarded on
 *      purpose — see step 4); cross-book rows are left to the generation guard.
 *   3. Bumps pipeline_auto.ocr_generation — submitters stamp this on new jobs,
 *      and batch-collector refuses to save results from an older generation.
 *   4. Clears ocr (and optionally translation) on the selected pages through writePageText()
 *      (scripts/lib/page-text-writer.mjs) with one run_id: every cleared field becomes a
 *      page_revisions row carrying the whole prior object, and the whole run is undone with
 *        node scripts/maintenance/revert-run.mjs --run-id <id> [--apply]
 *      Human-edited fields (source 'manual' or edited_by) are skipped and reported unless
 *      --include-human-edited, the same protection the collectors apply.
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
 *   --pages 5-39           Only clear a page_number range (inclusive). Comma-separated ranges and
 *                          single pages are accepted (`--pages 26-230,247,300-412`) so a book whose
 *                          poisoned pages are scattered (#3391: 39 books, 101 runs) is one reset —
 *                          one revision snapshot, one job cancel, one ocr_generation bump — instead
 *                          of one run per range, each bumping the generation again.
 *   --pages-file PATH      Same, read from a file: whitespace/comma-separated page numbers and ranges.
 *   --reason "..."         Recorded on the revision notes (default: manual reset).
 *   --force-full           Clear even when more than 20% of the book's pages would lose text.
 *   --include-human-edited Also clear fields a person edited (refused by default).
 *   --run-id ID            Use this run id (default: reset-book-ocr-<UTC stamp>-<hex>); printed either way.
 */

import { MongoClient } from 'mongodb';
import { writePageText, newRunId, isHumanEditedField } from '../lib/page-text-writer.mjs';
import { isHeld } from '../lib/pipeline-hold.mjs';
import { endNamelessBatchJobs } from '../lib/end-batch-job.mjs';
import { hasGeminiJobNameClause } from '../lib/batch-job-filters.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE_FULL = args.includes('--force-full');
const INCLUDE_HUMAN = args.includes('--include-human-edited');
/** Above this share of the book's pages losing text, the run refuses without --force-full (#7058). */
const MAX_CLEAR_SHARE = 0.2;
const runIdIdx = args.indexOf('--run-id');
const RUN_ID = runIdIdx !== -1 ? args[runIdIdx + 1] : newRunId('reset-book-ocr');
if (!RUN_ID || RUN_ID.startsWith('--')) { console.error('--run-id expects a value'); process.exit(1); }
const ALSO_TRANSLATION = args.includes('--also-translation');
const TRANSLATION_ONLY = args.includes('--translation-only');
if (ALSO_TRANSLATION && TRANSLATION_ONLY) {
  console.error('--also-translation and --translation-only are mutually exclusive');
  process.exit(1);
}
/** Which page fields this run destroys. The rest of the script keys off this. */
const FIELDS = TRANSLATION_ONLY ? ['translation'] : ALSO_TRANSLATION ? ['ocr', 'translation'] : ['ocr'];
// The first bare argument that is not the value of a value-taking flag.
const VALUE_FLAGS = new Set(['--reason', '--pages', '--pages-file', '--run-id']);
const target = args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1]));
const reasonIdx = args.indexOf('--reason');
const REASON = reasonIdx !== -1 ? args[reasonIdx + 1] : 'manual reset via reset-book-ocr.mjs';
const pagesIdx = args.indexOf('--pages');
const pagesFileIdx = args.indexOf('--pages-file');
/**
 * Page selection as a Mongo filter on page_number, or null for the whole book.
 * "5-39" → a range; "26-230,247,300-412" → an $or of ranges and singles. Overlaps
 * and order do not matter; an empty or malformed spec exits before any write.
 */
function parsePageSpec(spec) {
  const parts = String(spec || '').split(/[\s,]+/).filter(Boolean);
  const clauses = [];
  for (const part of parts) {
    const m = part.match(/^(-?\d+)(?:-(-?\d+))?$/) || part.match(/^(-?\d+)\.\.(-?\d+)$/);
    if (!m) return null;
    const a = parseInt(m[1]), b = m[2] === undefined ? a : parseInt(m[2]);
    if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
    clauses.push(a === b ? { page_number: a } : { page_number: { $gte: a, $lte: b } });
  }
  if (!clauses.length) return null;
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}
let pageRange = null;
let pageSpecText = null;
if (pagesIdx !== -1 || pagesFileIdx !== -1) {
  if (pagesIdx !== -1 && pagesFileIdx !== -1) { console.error('--pages and --pages-file are mutually exclusive'); process.exit(1); }
  pageSpecText = pagesIdx !== -1 ? (args[pagesIdx + 1] || '') : (await import('node:fs')).readFileSync(args[pagesFileIdx + 1], 'utf8');
  pageRange = parsePageSpec(pageSpecText);
  if (!pageRange) { console.error('--pages expects a range like 5-39, or a comma-separated list of ranges and pages like 26-230,247,300-412'); process.exit(1); }
}

if (!target) {
  console.log('Usage: node scripts/maintenance/reset-book-ocr.mjs <book-id-or-slug> [--dry-run] [--also-translation] [--pages N-M[,N,N-M...] | --pages-file PATH] [--reason "..."]');
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

// 2. Pages to clear — every page in the selection that carries any field this run destroys
// (a text-less marker object such as {source: 'skip'} is cleared too, as the old $unset did).
// The page selection is a filter fragment ({page_number: …} or {$or: [...]}), so it is merged
// with $and rather than assigned to page_number.
const pageFilter = { book_id: book.id, $or: FIELDS.map((f) => ({ [f]: { $exists: true, $ne: null } })) };
if (pageRange) pageFilter.$and = [pageRange];
const pages = await db.collection('pages').find(
  pageFilter, { projection: { id: 1, book_id: 1, page_number: 1, ...Object.fromEntries(FIELDS.map((f) => [f, 1])) } }
).toArray();
const hasText = (p) => FIELDS.some((f) => typeof p[f]?.data === 'string' && p[f].data !== '');
const textPages = pages.filter(hasText).length;
const humanEdited = pages.filter((p) => FIELDS.some((f) => isHumanEditedField(p[f]))).length;
const totalPages = await db.collection('pages').countDocuments({ book_id: book.id });
const share = totalPages ? textPages / totalPages : 0;
const specSummary = pageSpecText ? pageSpecText.trim().split(/[\s,]+/).filter(Boolean) : null;
console.log(`Pages to clear: ${textPages} with text, ${pages.length - textPages} marker-only${specSummary ? ` (page_number ${specSummary.length <= 6 ? specSummary.join(',') : `${specSummary.slice(0, 6).join(',')},… ${specSummary.length} parts`})` : ''} (${FIELDS.join(' + ')} only)`);
console.log(`Text lost: ${textPages}/${totalPages} pages of the book = ${(share * 100).toFixed(1)}% (limit ${MAX_CLEAR_SHARE * 100}% without --force-full)`);
if (humanEdited) {
  console.log(`Human-edited pages in the selection: ${humanEdited} — ${INCLUDE_HUMAN ? 'WILL be cleared (--include-human-edited)' : 'will be SKIPPED (pass --include-human-edited to clear them)'}`);
}
console.log(`run_id: ${RUN_ID}`);

// 3. The 20% guard (#7058) — before ANY write, jobs and generation included.
if (share > MAX_CLEAR_SHARE && !FORCE_FULL) {
  console.error(`\nREFUSED: this would clear text on ${(share * 100).toFixed(1)}% of the book's pages (> ${MAX_CLEAR_SHARE * 100}%).`);
  console.error('A book that reads is not reset by default — 759 good pages were cleared this way on 2026-10-21 (#7058).');
  console.error('Narrow the run with --pages, or pass --force-full if a full re-read is really the decision.');
  await client.close();
  process.exit(2);
}

if (DRY_RUN) { await client.close(); process.exit(0); }

// 4. End outstanding jobs BEFORE clearing pages (closes the resurrect window).
// A row with no Gemini name never reached Gemini: cancelled. A submitted row is PAID output
// this reset discards on purpose, so it is written `superseded` — the collector skips it and
// the Gemini-side ledger (paid-vs-got section 8) counts it as a deliberate discard — never
// `cancelled`, which reads as "nothing to collect" and hides a billed job (#6276). A submitted
// CROSS-book job also carries other books' pages: it is left in flight, and for OCR the
// generation bump below drops only this book's pages when it is collected.
const RESET_BY = 'scripts/maintenance/reset-book-ocr.mjs';
const namelessRes = await endNamelessBatchJobs(db, activeJobFilter, {
  status: 'cancelled', reason: `reset-book-ocr: ${REASON}`, by: RESET_BY, set: { error: `cancelled by reset-book-ocr: ${REASON}` },
});
const singleBook = { $or: [{ book_ids: { $exists: false } }, { book_ids: { $size: 0 } }, { book_ids: [book.id] }] };
const discardRes = await db.collection('batch_jobs').updateMany(
  { ...activeJobFilter, $and: [singleBook, hasGeminiJobNameClause()] },
  { $set: { status: 'superseded', error: `discarded by reset-book-ocr: ${REASON}`, discarded_by: RESET_BY, updated_at: new Date() } },
);
const crossBook = await db.collection('batch_jobs').countDocuments({ ...activeJobFilter, $and: [hasGeminiJobNameClause()] });
console.log(`Jobs ended: ${namelessRes.modifiedCount} never-submitted cancelled, ${discardRes.modifiedCount} submitted discarded (superseded)`
  + (crossBook ? `, ${crossBook} cross-book left in flight${TRANSLATION_ONLY ? ' — WARNING: no generation guard covers translation; they may re-write cleared text when collected' : ' (generation guard drops this book\'s pages)'}` : ''));

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

// 6. Clear page fields — through the one writer, one run_id, so every cleared field is a full
// page_revisions row and the run is revertible as a unit (revert-run.mjs).
const tally = { written: 0, unchanged: 0, refused_human_edit: 0, conflict: 0, not_found: 0 };
const clearOne = async (p) => {
  for (const field of FIELDS) {
    if (p[field] === undefined || p[field] === null) continue;
    const r = await writePageText(db, p.id, field, null, {
      by: RESET_BY, reason: `reset-book-ocr: ${REASON}`, run_id: RUN_ID, overrideHumanEdit: INCLUDE_HUMAN,
    });
    tally[r.status] = (tally[r.status] || 0) + 1;
  }
};
for (let i = 0; i < pages.length; i += 16) await Promise.all(pages.slice(i, i + 16).map(clearOne));
console.log(`Fields cleared: ${tally.written} | skipped human-edited: ${tally.refused_human_edit} | changed under us (left alone): ${tally.conflict}`);
console.log(`Undo this run: node scripts/maintenance/revert-run.mjs --run-id ${RUN_ID}   (dry run; add --apply)`);

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
