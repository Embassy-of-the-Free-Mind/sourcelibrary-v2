#!/usr/bin/env node

/**
 * Delete orphan fields from `books` — the fields nothing reads and nothing
 * writes (issue #3969, the shrink half of Track B).
 *
 * The validator freezes the field count; only this reduces it.
 *
 * NOTHING IS LOST. Every book touched gets ONE row in `sweep_log` recording
 * every removed field and its value, so a deletion is recoverable from the
 * ledger. That is the ROW-not-COLUMN rule applied to its own cleanup.
 *
 * HOW THE LIST WAS BUILT (and why it is not the list the audits produced)
 * Two reader surveys classified these as orphan. Both used
 * `git grep -E "\bfield\b"` — which in this repo matches NOTHING and exits 1,
 * because BSD ERE has no `\b`. Verified: `git grep -E '\bpages_count\b' --
 * src/lib/types/book.ts` finds nothing while `-P` finds it. A silent false
 * negative is indistinguishable from "no references", which is the worst
 * possible failure for a deletion decision, so every candidate was re-checked
 * with `git grep -P` across src/, scripts/ and mcp-server/, excluding only:
 *   - scripts/audit/field-sprawl.mjs  (census grouping lists, not a reader)
 *   - scripts/lib/book-docs.mjs       (write-side whitelist, not a reader)
 *   - _archived/ paths                (dead code)
 * That re-check removed SIX fields the first survey had called orphan
 * (free_tier, material, last_updated, cover, translator, archived_reason).
 *
 * Deliberately NOT here: anything read only by a cron/worker. `photo` is the
 * case in point — read solely by sync-books-catalog.mjs, feeding the public
 * listing thumbnails via Supabase. Invisible to any src/-only grep.
 *
 * Dry-run by default; pass --apply to write.
 */

import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const SWEEP = 'orphan-field-deletion-2026-08';

/** Verified clean: zero references under `git grep -P` outside census/whitelist files. */
export const ORPHAN_FIELDS = [
  // abandoned first-translation sweeps
  'ft_prediction', 'ft_candidate', 'translation_audit_2026_06', 'existing_translation',
  'translated_from', 'superseded_by', 'translation_requested_by_reader',
  'work_authority', 'wikidata_work_ids',
  // language-relabel sweeps
  'language_relabeled_from', 'language_relabeled_at', 'language_correction',
  'language_corrected_at', 'language_corrected_by',
  // dated one-shot metadata sweeps
  'author_corrected_2026_06_30', 'title_corrected_2026_06_30', 'bibliographic_correction',
  // acquisition / curation experiments
  'acquisition_wave', 'acquisition_priority', 'priority_translation', 'forshaw_relevance',
  // pipeline-priority / hold experiment
  'pipeline_hold', 'pipeline_priority_at', 'pipeline_priority_reason',
  'current_job_id', 'enrichment_phase',
  // warehouse-as-a-flag (superseded by the books_warehouse collection)
  'warehouse_reason',
  // IA re-point / dedup forensics
  'ia_identifier_previous', 'ia_repoint_reason', 'ica_records', 'dedup_note',
  'deletion_batch',
  // place triplication (canonical: place_published / place_of_publication)
  'published_location', 'published_place',
  // artwork / museum one-way street
  'related_artwork', 'morgan_accession', 'morgan_bibid', 'resourced_from',
  // rights
  'rights_note', 'rights_status',
  // misc orphans
  'author_original', 'thumbnail_page_id', 'former_resource_type', 'modern_typeset',
  'split_warnings', 'unhidden_note', 'part_number', 'source_notes',
  'summary_updated_at', 'cover_page_id',
];

const APPLY = process.argv.includes('--apply');
// --fields a,b : delete a DIFFERENT set through the same proven machinery
// (preserve to sweep_log, then $unset, canary-able, reversible via
// restore-orphan-book-fields.mjs). Reusing this beats writing a second deleter
// per family, which is how two implementations drift apart.
const FIELDS_OVERRIDE = (() => {
  const i = process.argv.indexOf('--fields');
  return i > -1 ? process.argv[i + 1].split(',').map((f) => f.trim()).filter(Boolean) : null;
})();
// --sweep <name> : label the sweep_log rows for this run.
const SWEEP_OVERRIDE = (() => { const i = process.argv.indexOf('--sweep'); return i > -1 ? process.argv[i + 1] : null; })();
// --limit N: canary mode. Delete from at most N books, so the sweep_log
// round-trip can be proved on a small set before the full run.
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > -1 ? Number(process.argv[i + 1]) : 0; })();
const uri = process.env.MONGODB_URI;
if (!uri) { console.error('Missing MONGODB_URI'); process.exit(2); }

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000, socketTimeoutMS: 600000 });
await client.connect();
const db = client.db(process.env.DB_NAME || 'bookstore');
const books = db.collection('books');

const FIELDS = FIELDS_OVERRIDE || ORPHAN_FIELDS;
const SWEEP_NAME = SWEEP_OVERRIDE || SWEEP;
console.log(`Book field deletion — ${FIELDS.length} field(s), sweep '${SWEEP_NAME}'`);
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

// Exact per-field counts. Sampling is not admissible for a deletion decision:
// on this collection a 3,000-doc sample missed ~95 fields entirely.
const counts = [];
for (const f of FIELDS) {
  const n = await books.countDocuments({ [f]: { $exists: true } }, { maxTimeMS: 60000 });
  counts.push([f, n]);
}
counts.sort((a, b) => b[1] - a[1]);
for (const [f, n] of counts) console.log(`  ${f.padEnd(34)} ${n}`);

const live = counts.filter(([, n]) => n > 0);
const totalFieldInstances = counts.reduce((s, [, n]) => s + n, 0);
const affected = await books.countDocuments(
  { $or: FIELDS.map((f) => ({ [f]: { $exists: true } })) },
  { maxTimeMS: 120000 },
);
console.log(`\nfields with >0 docs : ${live.length} of ${FIELDS.length}`);
console.log(`field instances     : ${totalFieldInstances}`);
console.log(`distinct books      : ${affected}`);

if (!APPLY) {
  console.log('\nDry-run only. Re-run with --apply to delete.');
  await client.close();
  process.exit(0);
}

// Preserve first, delete second — and one row per BOOK, carrying every value.
const findOpts = { projection: Object.fromEntries([['id', 1], ...FIELDS.map((f) => [f, 1])]) };
if (LIMIT) findOpts.limit = LIMIT;
const cursor = books.find({ $or: FIELDS.map((f) => ({ [f]: { $exists: true } })) }, findOpts);
if (LIMIT) console.log(`\nCANARY: limiting to ${LIMIT} books.`);

let rows = 0, unset = 0;
for await (const book of cursor) {
  const removed = {};
  for (const f of FIELDS) if (f in book) removed[f] = book[f];
  if (!Object.keys(removed).length) continue;

  await recordSweepAction(db, {
    sweep: SWEEP_NAME,
    book_id: book.id || String(book._id),
    action: 'orphan-fields-removed',
    detail: { removed },
  });
  rows += 1;

  const r = await books.updateOne(
    { _id: book._id },
    { $unset: Object.fromEntries(Object.keys(removed).map((f) => [f, ''])) },
  );
  unset += r.modifiedCount;
}

console.log(`\nsweep_log rows written : ${rows}`);
console.log(`books modified         : ${unset}`);

let residual = 0;
for (const f of FIELDS) residual += await books.countDocuments({ [f]: { $exists: true } }, { maxTimeMS: 60000 });
// In canary mode a non-zero residual is the expected result, not a fault — the
// run deliberately stopped early. Only a full run can claim "clean", and a
// check that cries wolf is one people learn to ignore.
const residualNote = LIMIT
  ? '(expected — canary run stopped early)'
  : residual === 0 ? '(clean)' : '(!! investigate)';
console.log(`residual instances     : ${residual} ${residualNote}`);
console.log(`\nRecover a book's values: db.sweep_log.find({ sweep: '${SWEEP_NAME}', book_id: '<id>' })`);

await client.close();
