#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/retranslate-pages.mjs already re-translates a
// specific list of pages (PAID, --execute, consumes --from=<json> shaped as
// [{book_id, page_number, kind}]) — this script does NOT duplicate that. It
// only (a) DETECTS the #4685(b) batch-lane dropout (a page with OCR but no
// translation whose immediate neighbours were translated by the SAME
// batch_job_id, or a page the fixed collector has since marked
// translation.fail_reason === 'batch_response_missing_or_misaligned'),
// (b) estimates re-translation cost, and (c) writes a target list in the
// exact shape retranslate-pages.mjs --from= expects, so the actual paid
// retranslation is a separate, deliberate, human-run step.
// Also checked: scripts/maintenance/fix-batch-contamination.mjs (repairs the
// 2026-03-24 sibling incident by clearing contaminated OCR/translation — not
// applicable here, these pages were never WRITTEN wrong content, they were
// never written at all) and scripts/audit/ for an existing dropout detector —
// none found (`ls scripts/audit | grep -i batch` has no dropout/alignment
// detector).
/**
 * #4685(b) — Batch-lane translation dropout at fixed page indices.
 *
 * Detects pages the Gemini Batch API translation collector silently dropped:
 * OCR is present, no translation object exists, but the page's immediate
 * neighbours (page_number-1, page_number+1) WERE translated by the same
 * batch_job_id — i.e. the page sat inside a job the collector reported as
 * 100% successful (job.completed_pages === job.page_ids.length,
 * job.failed_pages === 0) and yet never got written. See
 * scripts/output/_tmp-batch-dropout.mjs for the measurement this repair
 * script's detection query is drawn from, and scripts/lib/batch-response-matching.mjs
 * + scripts/batch/collect-batch-results.mjs for the collector fix that stops
 * new occurrences (it now stamps translation.fail_reason ===
 * 'batch_response_missing_or_misaligned' on any page it can't resolve, which
 * this script also picks up going forward).
 *
 * READ-ONLY unless --apply is passed. Even with --apply, this script makes
 * NO Gemini API calls and spends NO money — it only (1) writes a target list
 * JSON that scripts/maintenance/retranslate-pages.mjs --from=<file> --execute
 * can consume later (a separate, deliberate, paid step a human runs), and
 * (2) backfills the translation.failed_at/fail_reason marker onto the
 * historical pages this script finds that predate the collector fix (so
 * they stop looking "never queued" to any give-up-counter sweep, #4674).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/repair-batch-dropout-4685.mjs                # dry run — list + cost estimate only
 *   node scripts/maintenance/repair-batch-dropout-4685.mjs --apply        # writes target-list JSON + backfills failure marker (no Gemini calls, no spend)
 *   node scripts/maintenance/repair-batch-dropout-4685.mjs --limit=200    # cap books scanned (debugging)
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const limitArg = args.find(a => a.startsWith('--limit='));
const BOOK_LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const windowStartArg = args.find(a => a.startsWith('--window-start='));
const windowEndArg = args.find(a => a.startsWith('--window-end='));
// Default window covers the incident this issue was filed against; widen with
// --window-start/--window-end to sweep other periods for the same shape.
const WINDOW_START = new Date(windowStartArg ? windowStartArg.split('=')[1] : '2026-07-01T00:00:00Z');
const WINDOW_END = new Date(windowEndArg ? windowEndArg.split('=')[1] : new Date().toISOString());

const OUTPUT_FILE = 'scripts/output/batch-dropout-4685-retranslate-targets.json';

// Same pricing table + batch discount as scripts/maintenance/backfill-batch-costs.mjs
// (kept in sync manually — no shared constant exists yet for this).
const MODEL_PRICING = {
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.50 },
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
};
const BATCH_DISCOUNT = 0.5;
function estimateCost(model, avgInputTokens, avgOutputTokens, pageCount) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['gemini-3.1-flash-lite'];
  const inputCost = (avgInputTokens * pageCount / 1_000_000) * pricing.input * BATCH_DISCOUNT;
  const outputCost = (avgOutputTokens * pageCount / 1_000_000) * pricing.output * BATCH_DISCOUNT;
  return inputCost + outputCost;
}

async function main() {
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 4, serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db('bookstore');

  console.log(`=== repair-batch-dropout-4685 — ${APPLY ? 'APPLY (writes target list + failure markers, NO Gemini calls)' : 'DRY RUN'} ===\n`);
  console.log(`Window: ${WINDOW_START.toISOString()} .. ${WINDOW_END.toISOString()}\n`);

  // --- Detection path 1: pages the fixed collector has already marked (going forward) ---
  // `translation.fail_reason` has no index (it doesn't exist on any page yet —
  // this collector fix hasn't shipped/run against production at the time this
  // script was written), so this is a full scan over 20M+ page docs. Bounded
  // with maxTimeMS so a dry-run stays usable before that index exists; once
  // the marker is actually being written in production, add one (e.g. a
  // partial index on translation.fail_reason) and drop this guard.
  let markedPages = [];
  try {
    markedPages = await db.collection('pages').find(
      { 'translation.fail_reason': 'batch_response_missing_or_misaligned' },
      { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, 'translation.failed_batch_job_id': 1 } }
    ).maxTimeMS(20000).toArray();
  } catch (err) {
    console.log(`  Detection 1 skipped (${err.message.slice(0, 80)}) — no index on translation.fail_reason yet; falling back to detection 2 only. Safe: detection 1 can only find pages the FIXED collector marked, and this repair predates that collector running in production.`);
  }
  console.log(`Detection 1 (collector-marked, post-fix): ${markedPages.length} pages`);

  // --- Detection path 2: legacy heuristic for the historical backlog that predates the fix ---
  // Same query as scripts/output/_tmp-batch-dropout.mjs.
  const bookIds = await db.collection('pages').distinct('book_id', {
    'translation.updated_at': { $gte: WINDOW_START, $lte: WINDOW_END },
    'translation.batch_job_id': { $exists: true, $nin: [null, ''] },
  });
  const liveBooks = await db.collection('books').find(
    { id: { $in: bookIds }, visible: true, pages_count: { $gt: 0 } },
    { projection: { id: 1, title: 1, language: 1 } }
  ).toArray();
  const booksToCheck = BOOK_LIMIT < Infinity ? liveBooks.slice(0, BOOK_LIMIT) : liveBooks;
  console.log(`Detection 2 (neighbour heuristic): scanning ${booksToCheck.length} live books with batch translations in window`);

  const legacyAffected = []; // { book_id, page_number, batch_job_id, kind }
  for (const book of booksToCheck) {
    const pages = await db.collection('pages').find(
      { book_id: book.id },
      { projection: { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.batch_job_id': 1 } }
    ).sort({ page_number: 1 }).toArray();
    const byNumber = new Map(pages.map(p => [p.page_number, p]));
    for (const p of pages) {
      const hasOcr = !!(p.ocr && p.ocr.data);
      const hasTranslation = !!(p.translation && p.translation.data);
      if (!hasOcr || hasTranslation) continue;
      const prev = byNumber.get(p.page_number - 1);
      const next = byNumber.get(p.page_number + 1);
      const prevJob = prev?.translation?.batch_job_id;
      const nextJob = next?.translation?.batch_job_id;
      if (prev?.translation?.data && next?.translation?.data && prevJob && nextJob && prevJob === nextJob) {
        legacyAffected.push({ book_id: book.id, page_number: p.page_number, batch_job_id: prevJob, kind: 'batch_dropout_4685' });
      }
    }
  }
  console.log(`Detection 2 found: ${legacyAffected.length} pages\n`);

  // --- Merge + dedupe ---
  const targetMap = new Map(); // `${book_id}:${page_number}` -> target
  for (const p of markedPages) {
    targetMap.set(`${p.book_id}:${p.page_number}`, { book_id: p.book_id, page_number: p.page_number, kind: 'batch_dropout_4685' });
  }
  for (const p of legacyAffected) {
    const key = `${p.book_id}:${p.page_number}`;
    if (!targetMap.has(key)) targetMap.set(key, { book_id: p.book_id, page_number: p.page_number, kind: p.kind });
  }
  const targets = [...targetMap.values()];

  console.log(`=== Total affected pages (deduplicated): ${targets.length} across ${new Set(targets.map(t => t.book_id)).size} books ===\n`);

  if (targets.length === 0) {
    console.log('Nothing to repair.');
    await client.close();
    return;
  }

  // --- Cost estimate ---
  // Sample average OCR/translation token size from currently-translated
  // pages of the SAME affected books (a reasonable proxy for what these
  // dropped pages would cost to retranslate).
  const affectedBookIds = [...new Set(targets.map(t => t.book_id))];
  const sample = await db.collection('pages').aggregate([
    { $match: { book_id: { $in: affectedBookIds }, 'translation.input_tokens': { $gt: 0 } } },
    { $group: {
        _id: null,
        avgInput: { $avg: '$translation.input_tokens' },
        avgOutput: { $avg: '$translation.output_tokens' },
        n: { $sum: 1 },
    } },
  ]).toArray();
  const avgInput = sample[0]?.avgInput || 1200; // conservative fallback if no sample
  const avgOutput = sample[0]?.avgOutput || 900;
  console.log(`Cost basis: avg ${Math.round(avgInput)} input / ${Math.round(avgOutput)} output tokens/page (sampled from ${sample[0]?.n || 0} already-translated pages in the same books)\n`);

  const liteCost = estimateCost('gemini-3.1-flash-lite', avgInput, avgOutput, targets.length);
  const flashCost = estimateCost('gemini-3-flash-preview', avgInput, avgOutput, targets.length);
  console.log(`Estimated re-translation cost for ${targets.length} pages (Gemini Batch API, 50% discount already applied):`);
  console.log(`  gemini-3.1-flash-lite:   ~$${liteCost.toFixed(2)}  (default routing for non-BPH books)`);
  console.log(`  gemini-3-flash-preview:  ~$${flashCost.toFixed(2)}  (BPH books / grounded-search routing)`);
  console.log('\n(Actual routing per book follows getTranslateModelForBook — see scripts/lib/translate-core.mjs.)\n');

  // Sample of affected pages for a human to spot-check
  console.log('Sample (first 15):');
  for (const t of targets.slice(0, 15)) {
    console.log(`  book=${t.book_id} page=${t.page_number} kind=${t.kind}`);
  }

  if (!APPLY) {
    console.log('\nDry run — no files written, no DB writes, no Gemini calls.');
    console.log(`Would write target list to ${OUTPUT_FILE} for scripts/maintenance/retranslate-pages.mjs --from=${OUTPUT_FILE} --execute (separate, paid, human-run step).`);
    await client.close();
    return;
  }

  // --- APPLY: write target-list JSON (retranslate-pages.mjs --from= shape) ---
  const fs = await import('fs');
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(targets, null, 2));
  console.log(`\nWrote ${targets.length} targets to ${OUTPUT_FILE}`);
  console.log(`Next step (separate, PAID, run deliberately): node scripts/maintenance/retranslate-pages.mjs --from=${OUTPUT_FILE} --execute`);

  // --- APPLY: backfill the failure marker onto the historical (pre-fix) pages ---
  // so they stop looking "never queued" even before anyone runs the retranslate
  // step above. Only touches pages that don't already carry the marker, and
  // only if they are still genuinely untranslated (never overwrites a real value).
  const toBackfill = legacyAffected.filter(p => !markedPages.some(m => m.book_id === p.book_id && m.page_number === p.page_number));
  if (toBackfill.length > 0) {
    const now = new Date();
    const ops = [];
    for (const p of toBackfill) {
      const page = await db.collection('pages').findOne({ book_id: p.book_id, page_number: p.page_number }, { projection: { id: 1 } });
      if (!page) continue;
      ops.push({
        updateOne: {
          filter: { id: page.id, $or: [{ 'translation.data': { $exists: false } }, { 'translation.data': null }, { 'translation.data': '' }] },
          update: { $set: {
            'translation.failed_at': now,
            'translation.fail_reason': 'batch_response_missing_or_misaligned',
            'translation.failed_batch_job_id': p.batch_job_id,
          } },
        },
      });
    }
    if (ops.length > 0) {
      const result = await db.collection('pages').bulkWrite(ops, { ordered: false });
      console.log(`Backfilled failure marker onto ${result.modifiedCount} historical page(s) (no OCR/translation content changed — marker fields only).`);
    }
  }

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
