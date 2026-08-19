#!/usr/bin/env node
/**
 * Re-enroll loop-quarantined books into the pipeline (#3750).
 *
 * BACKGROUND. fix-translation-loops.mjs cleared recitation-loop translation
 * garbage (translation.data $unset, pages_translated decremented) and the
 * affected books were parked at `pipeline_auto.status: 'loop_quarantine_hold'`
 * — a status the orchestrator never picks up, so they sit outside the line
 * (~1,393 books). This script boards them again: reset to 'ocr_complete', the
 * exact status orchestrator Phase 4 reads its fresh-translation candidates
 * from (pipeline-orchestrator.mjs, `'pipeline_auto.status': { $in:
 * ['ocr_complete'] }`). Phase 3.1's spread guard and Phase 4's budget dial
 * (#3737) still apply — re-enrolling puts a book in line, it does not spend.
 *
 * PER-BOOK CHECKS (see scripts/lib/reenroll-eligibility.mjs for the pure
 * predicate, unit-tested in tests/unit/reenroll-eligibility.test.ts):
 *   - hidden_reason set → NEVER re-enrolled. Takedowns/copyright holds must
 *     not re-enter via bulk sweeps (repo lesson #3099).
 *   - counters: pages_ocr > 0 and pages_translated < pages_ocr.
 *   - actuals (DB, not counters): the book still has OCR'd-but-untranslated
 *     pages, and no page still carries BOTH the loop-quarantine marker and a
 *     translation.data — i.e. the earlier clear really happened.
 *
 * DRY-RUN BY DEFAULT — writes nothing without --apply. Every decision is
 * logged. Each re-enrolled book gets a permanent book_events record
 * (type: 'loop_quarantine_reenroll') — that collection is durable history,
 * never pruned (see ensure-indexes.mjs).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/reenroll-quarantined.mjs                # dry run, first 100
 *   node scripts/maintenance/reenroll-quarantined.mjs --limit=500    # dry run, more
 *   node scripts/maintenance/reenroll-quarantined.mjs --book=<id>    # one book
 *   node scripts/maintenance/reenroll-quarantined.mjs --apply        # write (bounded by --limit)
 */

import { MongoClient, ObjectId } from 'mongodb';
import { evaluateReenrollment, QUARANTINE_STATUS, REENTRY_STATUS } from '../lib/reenroll-eligibility.mjs';

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
};
const APPLY = process.argv.includes('--apply');
const LIMIT = parseInt(arg('limit', '100'), 10);
const ONE_BOOK = arg('book', null);

const toOid = (id) => { try { return new ObjectId(String(id)); } catch { return null; } };

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) { console.error('Missing MONGODB_URI'); process.exit(1); }
const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');

console.log(`Re-enroll quarantined books — ${APPLY ? '\x1b[31mAPPLY (writing)\x1b[0m' : 'DRY RUN (no writes)'}`);
console.log(`  ${QUARANTINE_STATUS} -> ${REENTRY_STATUS}, batch limit ${LIMIT}${ONE_BOOK ? `, scope: book ${ONE_BOOK}` : ''}`);

const query = { 'pipeline_auto.status': QUARANTINE_STATUS };
if (ONE_BOOK) query.$or = [{ id: ONE_BOOK }, { _id: toOid(ONE_BOOK) }].filter((c) => c.id || c._id);

const total = await books.countDocuments(query);
const candidates = await books.find(query, {
  projection: {
    id: 1, title: 1, display_title: 1, language: 1, hidden_reason: 1, visible: 1,
    pages_ocr: 1, pages_translated: 1, pages_count: 1, 'pipeline_auto.status': 1,
  },
}).limit(LIMIT).toArray();
console.log(`\n${total.toLocaleString()} books at ${QUARANTINE_STATUS}; examining ${candidates.length} this run.\n`);

const tally = new Map();
const bump = (reason) => tally.set(reason, (tally.get(reason) || 0) + 1);
let reenrolled = 0;

for (const book of candidates) {
  const label = `${book.id || book._id}  ${(book.display_title || book.title || '?').slice(0, 60)}`;

  // Pure predicate over the book doc (counters + hidden_reason + status).
  const verdict = evaluateReenrollment(book);
  if (!verdict.eligible) {
    bump(verdict.reason);
    console.log(`  SKIP [${verdict.reason}] ${label}` +
      (verdict.reason === 'hidden_reason' ? `  (hidden_reason: ${JSON.stringify(book.hidden_reason).slice(0, 80)})` : ''));
    continue;
  }

  // Actuals, not counters: pages.book_id is a string id — match either the
  // books.id field or the stringified _id (both conventions exist in the DB).
  const bookIdKeys = [...new Set([book.id, String(book._id)].filter(Boolean))];
  const pageScope = { book_id: { $in: bookIdKeys } };
  const [ocrActual, translatedActual, loopResidue] = await Promise.all([
    pages.countDocuments({ ...pageScope, 'ocr.data': { $type: 'string' } }),
    pages.countDocuments({ ...pageScope, 'translation.data': { $type: 'string' } }),
    // A page that still has BOTH the quarantine marker and translation text
    // means the loop garbage was never actually cleared for this book.
    pages.countDocuments({ ...pageScope, 'translation.loop_quarantined_at': { $exists: true }, 'translation.data': { $type: 'string' } }),
  ]);

  if (loopResidue > 0) {
    bump('loop_garbage_present');
    console.log(`  SKIP [loop_garbage_present] ${label}  (${loopResidue} pages still hold quarantined translation text — needs fix-translation-loops.mjs first)`);
    continue;
  }
  if (ocrActual <= 0 || translatedActual >= ocrActual) {
    bump('no_untranslated_pages_actual');
    console.log(`  SKIP [no_untranslated_pages_actual] ${label}  (actual ocr=${ocrActual}, translated=${translatedActual}; counters said ${book.pages_ocr}/${book.pages_translated})`);
    continue;
  }

  const drift = (Number(book.pages_translated) || 0) !== translatedActual || (Number(book.pages_ocr) || 0) !== ocrActual;
  console.log(`  ${APPLY ? 'REENROLL' : 'WOULD REENROLL'} ${label}  (${ocrActual - translatedActual} pages to translate` +
    (drift ? `; counter drift: book says ocr=${book.pages_ocr}/tr=${book.pages_translated}, actual ${ocrActual}/${translatedActual}` : '') + ')');
  bump('reenrolled');

  if (!APPLY) continue;

  const now = new Date();
  // Guard on status in the filter so a concurrent write elsewhere loses cleanly.
  const res = await books.updateOne(
    { _id: book._id, 'pipeline_auto.status': QUARANTINE_STATUS },
    {
      $set: { 'pipeline_auto.status': REENTRY_STATUS, 'pipeline_auto.last_updated': now, updated_at: now },
      $unset: { job: '' },
    },
  );
  if (res.modifiedCount !== 1) {
    console.log(`    !! status changed under us — not re-enrolled (modifiedCount=${res.modifiedCount})`);
    bump('lost_race');
    continue;
  }
  reenrolled++;
  // Durable provenance — book_events is permanent (never in prune-telemetry).
  await db.collection('book_events').insertOne({
    book_id: book.id || String(book._id),
    type: 'loop_quarantine_reenroll',
    at: now,
    source: 'reenroll-quarantined',
    details: {
      from_status: QUARANTINE_STATUS,
      to_status: REENTRY_STATUS,
      pages_ocr_counter: book.pages_ocr ?? null,
      pages_translated_counter: book.pages_translated ?? null,
      pages_ocr_actual: ocrActual,
      pages_translated_actual: translatedActual,
      untranslated: ocrActual - translatedActual,
    },
  });
}

console.log('\n=== SUMMARY ===');
for (const [reason, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${reason.padEnd(30)} ${String(n).padStart(6)}`);
}
if (APPLY) {
  console.log(`\nRe-enrolled ${reenrolled} books to ${REENTRY_STATUS}. Orchestrator Phase 4 dispatches them when the budget dial allows (#3737).`);
  if (total > candidates.length) console.log(`${(total - candidates.length).toLocaleString()} books remain quarantined — re-run to process the next batch.`);
} else {
  console.log('\nDRY RUN — no writes. Re-run with --apply to re-enroll (bounded by --limit).');
}
await client.close();
process.exit(0);
