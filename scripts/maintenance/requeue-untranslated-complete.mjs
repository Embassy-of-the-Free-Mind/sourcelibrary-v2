#!/usr/bin/env node
/**
 * Requeue books that Phase 9 finalized as `complete` while translation never ran.
 *
 * PRIOR ART:
 *   scripts/maintenance/fix-h13-stragglers.mjs — closest shape (find books past a
 *     phase that still lack its output), but it re-submits OCR for 5 named books
 *     and does not touch pipeline_auto.status. This moves status.
 *   scripts/maintenance/archiving-watchdog.mjs — watches pipeline_auto.status for
 *     the ARCHIVE stage only; it cannot see this because the books are past archive.
 *   scripts/maintenance/fix-translation-loops.mjs — repairs translation that ran
 *     and looped; here translation never started.
 *   none writes a complete -> ocr_complete requeue.
 *
 * ── What went wrong ──────────────────────────────────────────────────────────
 *
 * Phase 9 (finalize) decides `complete` from OCR coverage ALONE:
 *
 *     const ocrPercent = ocrCount / totalPages;
 *     if (ocrPercent < 0.1) { ...needs_attention... }
 *     await setPipelineStatus(db, book.id, 'complete', { completed_at: new Date() });
 *
 * Translation is never consulted. A book whose OCR finished and whose translation
 * never ran is therefore finalized as `complete` — and `complete` is terminal for
 * enrichment: Phase 6 selects strictly on `translate_complete`, Phase 7 on
 * `summary_indexed`. Neither will ever see it again. No `translate_skipped_reason`
 * is recorded either, so the #3740 guard has nothing to catch.
 *
 * Measured 2026-09-08: 142 books, ~15.4K OCR'd pages, ALL non-Latin-script
 * (Chinese 71, Arabic 38, Malay 15, Javanese 5, Hindi/Nepali 6, Yucatec Maya 2,
 * Sundanese/Kannada/Balinese 3). Zero of the 142 carry a skip reason.
 *
 * ── What this does NOT touch, and why that matters ───────────────────────────
 *
 * The far larger population of `complete` + zero-translation books (~17.5K) is
 * the DELIBERATE 25-page preview posture: `PREVIEW_PAGE_COUNT = 25` in the
 * orchestrator, with full OCR bought on demand by
 * scripts/batch/bulk-reocr-opened-books.mjs once read_count >= 1. Those books are
 * working as designed and requeueing them would restart ~17K translations nobody
 * asked for. The selector below therefore requires pages_ocr >= 90% of
 * pages_count — a genuinely fully-OCR'd book — which excludes every preview.
 *
 * That distinction is the whole safety of this script. pipeline-status-truth.md:
 * "a predicate reading absence as failure would re-stall ~28K books permanently."
 *
 * ── Direction of travel ──────────────────────────────────────────────────────
 *
 * complete -> ocr_complete is a BACKWARD move: it un-claims work rather than
 * claiming it. `ocr_complete` is literally true of these books (OCR done,
 * translation not), so this cannot reproduce the status-ahead-of-output harm.
 * It is also what the fresh-translate lane selects on
 * (`'pipeline_auto.status': { $in: ['ocr_complete'] }`), so the books re-enter
 * the primary queue rather than the gap-fill fallback.
 *
 * COST: requeueing all 142 queues ~15.4K pages of translation, ~$44 at the rates
 * measured 2026-09-04 ($0.00241/pg realtime). Meter it with a scope envelope
 * (scripts/maintenance/set-scope.mjs) before running without --limit.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/requeue-untranslated-complete.mjs
 *   node --env-file=.env.production.local scripts/maintenance/requeue-untranslated-complete.mjs --execute --limit 20
 */
import { MongoClient } from 'mongodb';

const EXECUTE = process.argv.includes('--execute');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const LIMIT = parseInt(arg('--limit', '1000'), 10);

// The edition's own language. English editions need no translation, so their
// absence of one is not evidence of anything (language-fields.md).
const ENGLISH = ['English', 'english', 'en', 'eng'];

const SELECTOR = {
  'pipeline_auto.status': 'complete',
  language: { $nin: ENGLISH },
  // Excludes the 25-page preview cohort: a preview book has pages_ocr ~25 against
  // a much larger pages_count, so it can never satisfy the 90% test.
  pages_count: { $gt: 30 },
  $expr: { $gte: ['$pages_ocr', { $multiply: ['$pages_count', 0.9] }] },
  $or: [{ pages_translated: 0 }, { pages_translated: { $exists: false } }],
};

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }
const client = new MongoClient(uri, { maxPoolSize: 1 });

try {
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  const total = await books.countDocuments(SELECTOR);
  const todo = await books.find(SELECTOR, {
    projection: { id: 1, title: 1, language: 1, pages_count: 1, pages_ocr: 1, pipeline_auto: 1 },
  }).limit(LIMIT).toArray();

  console.log(`${EXECUTE ? 'EXECUTE' : 'DRY-RUN'} — ${todo.length} of ${total} matching books\n`);

  const byLang = {};
  let pages = 0;
  for (const b of todo) {
    byLang[b.language || '?'] = (byLang[b.language || '?'] || 0) + 1;
    pages += b.pages_ocr || 0;
  }
  console.log('by language:', JSON.stringify(byLang));
  console.log(`pages that would enter the translation queue: ${pages} (~$${(pages * 0.00241).toFixed(2)} at 2026-09-04 rates)\n`);

  let moved = 0;
  for (const b of todo) {
    if (!EXECUTE) {
      console.log(`DRY   ${String(b.pages_ocr) + '/' + b.pages_count}pp  ${(b.language || '?').slice(0, 12).padEnd(13)} ${(b.title || '').slice(0, 52)}`);
      continue;
    }
    // Record WHY on the document, at the moment of the write — the thing Phase 9
    // failed to do. `completed_at` is preserved rather than dropped: it is
    // evidence of when the bad finalize happened.
    const prev = b.pipeline_auto || {};
    const res = await books.updateOne(
      { id: b.id, 'pipeline_auto.status': 'complete' },
      {
        $set: {
          'pipeline_auto.status': 'ocr_complete',
          'pipeline_auto.requeued_from': 'complete',
          'pipeline_auto.requeued_at': new Date(),
          'pipeline_auto.requeue_reason':
            'Phase 9 finalize wrote `complete` from OCR coverage alone; translation never ran '
            + 'and no translate_skipped_reason was recorded. Requeued to ocr_complete so the '
            + 'translate lane and Phases 6/7 can reach it.',
          ...(prev.completed_at ? { 'pipeline_auto.previous_completed_at': prev.completed_at } : {}),
          updated_at: new Date(),
        },
        $unset: { 'pipeline_auto.completed_at': '' },
      },
    );
    if (res.modifiedCount === 1) {
      moved++;
      console.log(`OK    ${String(b.pages_ocr) + '/' + b.pages_count}pp  ${(b.language || '?').slice(0, 12).padEnd(13)} ${(b.title || '').slice(0, 52)}`);
    } else {
      console.log(`MISS  ${b.id} — status changed under us (modifiedCount ${res.modifiedCount})`);
    }
  }

  const after = await books.countDocuments(SELECTOR);
  console.log(`\n=== ${EXECUTE ? 'EXECUTED' : 'DRY-RUN'} — moved ${moved}; matching now ${after} (was ${total}) ===`);
  if (EXECUTE && moved) {
    console.log('These are now in the fresh-translate lane. Watch with:');
    console.log('  node scripts/audit/scope-progress.mjs --scope <your-envelope>');
  }
} finally {
  await client.close();
}
