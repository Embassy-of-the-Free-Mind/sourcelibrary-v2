#!/usr/bin/env node
/**
 * The archive-coverage question, asked at all three tiers at once.
 *
 * READ-ONLY. Writes nothing; prints a report and optionally a JSON snapshot.
 *
 * #4239 asked for one metric because ≥15 archive writers each carry their own
 * notion of "archived". On 2026-08-30 three methods answered "how many pages
 * lack a master?" with 1.48M, 4.03M and 5.18M. This script exists so that
 * question has one answer, and so the answer says which tier it came from.
 *
 *   RECORD tier  — corpus-wide, cheap. Does a page doc claim an R2 URL?
 *   FILE tier    — sampled HEAD. Does that object exist?
 *   MASTER tier  — sampled dimensions. Is it the full-resolution original?
 *
 * The tiers are reported separately and never summed. A page can pass RECORD
 * and fail MASTER (that is #4194's derivative-only state, and #3186's
 * resolution debt), and reporting one number hides exactly that.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/archive-coverage.mjs                    # record tier, sampled
 *   node scripts/audit/archive-coverage.mjs --books 800        # bigger sample
 *   node scripts/audit/archive-coverage.mjs --master-samples 150
 *   node scripts/audit/archive-coverage.mjs --by-host          # gap per source host (#4397 lanes)
 *   node scripts/audit/archive-coverage.mjs --json out.json
 *
 * Sampling note: books are drawn with $sample, NOT by natural order. Reading
 * the head of a collection samples insertion order, not the population — a
 * 2,500-page head-sample once read 92.9% retryable where the full corpus read
 * 69.2% (invariants/archive-fetch-failures.md).
 */

import { MongoClient } from 'mongodb';
import {
  classifyPageRecord,
  classifyPagePreservation,
  RecordState,
  PreservationState,
  emptyRecordTally,
  emptyPreservationTally,
  MASTER_WIDTH_RATIO,
} from '../lib/archive-coverage.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  if (i < 0) return d;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : process.argv[i + 1] ?? d;
};
const has = (k) => process.argv.includes(k);

const BOOK_SAMPLE = Number(arg('--books', 400));
const MASTER_SAMPLES = Number(arg('--master-samples', 80));
const BY_HOST = has('--by-host');
const JSON_OUT = typeof arg('--json', null) === 'string' ? arg('--json', null) : null;

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(2)}%` : '—');
const num = (n) => n.toLocaleString();

async function main() {
  const mc = new MongoClient(process.env.MONGODB_URI, { socketTimeoutMS: 900000 });
  await mc.connect();
  const db = mc.db('bookstore');
  const books = db.collection('books');
  const pages = db.collection('pages');

  const started = new Date();
  console.log(`archive-coverage — ${started.toISOString()}\n`);

  // ---- corpus shape (cheap, exact) ----
  const [totalBooks, withPages, markedComplete] = await Promise.all([
    books.countDocuments({}),
    books.countDocuments({ pages_count: { $gt: 0 } }),
    books.countDocuments({ archive_status: 'archive_complete' }),
  ]);
  console.log('CORPUS');
  console.log(`  book records              ${num(totalBooks)}`);
  console.log(`  with page docs            ${num(withPages)}`);
  console.log(`  marked archive_complete   ${num(markedComplete)}`);

  // ---- RECORD tier, on a random book sample ----
  // Sampling books (not pages) keeps the per-book page lookups indexed; a
  // corpus-wide $group over 20M page docs exceeds Atlas's operation time limit.
  const sample = await books.aggregate([
    { $match: { pages_count: { $gt: 0 } } },
    { $sample: { size: BOOK_SAMPLE } },
    { $project: { _id: 1, pages_count: 1, archive_status: 1 } },
  ], { maxTimeMS: 300000 }).toArray();

  const record = emptyRecordTally();
  const byHost = {};
  let sampledPages = 0;
  let mismarkedComplete = 0;   // flagged incomplete, actually complete
  let falselyComplete = 0;     // marked complete, actually missing masters
  const masterCandidates = [];

  for (const b of sample) {
    const id = b._id.toString();
    const docs = await pages.find({ book_id: id })
      .project({ archived_photo: 1, photo: 1, photo_original: 1, cropped_photo: 1, display_photo: 1, thumbnail_blob: 1, image_thumb: 1 })
      .toArray();
    if (!docs.length) continue;

    let held = 0;
    for (const d of docs) {
      const r = classifyPageRecord(d);
      record[r.state]++;
      sampledPages++;
      if (r.state === RecordState.MASTER_OR_DERIVATIVE) {
        held++;
        if (masterCandidates.length < MASTER_SAMPLES * 4) masterCandidates.push(d);
      } else if (BY_HOST && r.sourceUrl) {
        let h = '(unparseable)';
        try { h = new URL(r.sourceUrl).hostname; } catch { /* keep */ }
        byHost[h] = (byHost[h] || 0) + 1;
      }
    }

    const complete = held >= docs.length;
    if (b.archive_status === 'archive_complete' && !complete) falselyComplete++;
    if (b.archive_status !== 'archive_complete' && complete) mismarkedComplete++;
  }

  console.log(`\nRECORD TIER  (${num(sample.length)} random books, ${num(sampledPages)} pages)`);
  for (const [state, n] of Object.entries(record)) {
    if (!n) continue;
    console.log(`  ${state.padEnd(24)} ${String(num(n)).padStart(10)}  ${pct(n, sampledPages)}`);
  }
  const heldAtAll = record[RecordState.MASTER_OR_DERIVATIVE];
  const derivOnly = record[RecordState.DERIVATIVE_ONLY];
  console.log(`\n  "on R2 at all"   ${pct(heldAtAll + derivOnly, sampledPages)}   <- the optimistic number`);
  console.log(`  claims a master  ${pct(heldAtAll, sampledPages)}   <- the preservation number`);
  console.log(`  the gap between them is #4194's derivative-only state: ${pct(derivOnly, sampledPages)} of pages`);

  console.log(`\nFLAG ACCURACY  (archive_status vs the pages themselves)`);
  console.log(`  flagged incomplete but actually complete  ${num(mismarkedComplete)}`);
  console.log(`  marked complete but missing masters       ${num(falselyComplete)}`);
  console.log(`  -> #4190: the counter lies in BOTH directions, and archive-bulk selects work by it.`);

  // ---- MASTER tier, sampled ----
  if (MASTER_SAMPLES > 0 && masterCandidates.length) {
    const step = Math.max(1, Math.floor(masterCandidates.length / MASTER_SAMPLES));
    const picks = masterCandidates.filter((_, i) => i % step === 0).slice(0, MASTER_SAMPLES);
    console.log(`\nMASTER TIER  (${picks.length} pages that CLAIM an R2 object; threshold ${MASTER_WIDTH_RATIO} of native width)`);

    const preservation = emptyPreservationTally();
    const reasons = {};
    let ratioSum = 0, ratioN = 0;
    // Serial, with a gap between pages. This tier reads bytes from the source
    // institution's server (see `fetchNativeWidth`), and three hosts blocked us
    // in 48 hours during August 2026. An audit must never be the thing that
    // costs us access to the corpus it is auditing — so it runs slowly and
    // small rather than concurrently. ~1.5 req/s across all hosts combined.
    const results = [];
    for (const d of picks) {
      results.push(await classifyPagePreservation(d).catch(() => ({ state: PreservationState.UNKNOWN, reason: 'threw' })));
      await new Promise(r => setTimeout(r, 650));
    }
    for (const r of results) {
      preservation[r.state]++;
      if (r.reason) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
      if (typeof r.ratio === 'number') { ratioSum += r.ratio; ratioN++; }
    }
    const decided = preservation[PreservationState.MASTER] + preservation[PreservationState.BELOW_MASTER];
    for (const [state, n] of Object.entries(preservation)) {
      if (!n) continue;
      console.log(`  ${state.padEnd(16)} ${String(n).padStart(5)}  ${pct(n, picks.length)}`);
    }
    if (decided) {
      console.log(`\n  of pages we could decide: ${pct(preservation[PreservationState.MASTER], decided)} are true masters`);
      console.log(`  mean stored/native width ratio: ${ratioN ? (ratioSum / ratioN).toFixed(3) : '—'}`);
      console.log(`  -> pages below master are #3186 debt: they serve, and cannot be regenerated larger.`);
    }
    if (Object.keys(reasons).length) {
      console.log(`  unknown/skip reasons: ${Object.entries(reasons).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    }
  }

  // ---- by-host gap, for #4397 lane planning ----
  if (BY_HOST) {
    const rows = Object.entries(byHost).sort((a, b) => b[1] - a[1]);
    const gapTotal = rows.reduce((a, [, n]) => a + n, 0);
    console.log(`\nGAP BY SOURCE HOST  (${num(gapTotal)} pages needing a fetch, in this sample)`);
    for (const [h, n] of rows.slice(0, 12)) {
      console.log(`  ${h.padEnd(42)} ${String(num(n)).padStart(8)}  ${pct(n, gapTotal)}`);
    }
    console.log(`  -> one drain lane per host, each at its own DOMAIN_LIMITS rate (#4397).`);
  }

  console.log(`\nNOTE: RECORD is a sample-based estimate; FILE and MASTER tiers are always samples.`);
  console.log(`Never sum the tiers, and never quote one without saying which it is.`);

  if (JSON_OUT) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(JSON_OUT, JSON.stringify({
      generated_at: started.toISOString(),
      corpus: { totalBooks, withPages, markedComplete },
      sample: { books: sample.length, pages: sampledPages },
      record, byHost,
      flag_accuracy: { mismarkedComplete, falselyComplete },
    }, null, 2));
    console.log(`\nwrote ${JSON_OUT}`);
  }

  await mc.close();
}

main().catch(e => { console.error(e); process.exit(1); });
