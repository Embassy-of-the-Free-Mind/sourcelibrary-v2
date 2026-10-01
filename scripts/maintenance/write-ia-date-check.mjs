#!/usr/bin/env node
/**
 * Write `classification.date_check` onto ia_language import_candidates (#5458) from the
 * verdict file produced by `scripts/audit/ia-date-check.mjs classify`.
 *
 * PRIOR ART: scripts/iiif-discovery/classify-candidates.mjs — writes the sibling
 *   tier-0 keys of the same `classification` sub-document, but $sets the WHOLE
 *   sub-document (it would clobber date_check if re-run; this script only ever
 *   $sets the dotted path, so it never clobbers tier-0). No other date writer exists.
 *
 * One recorded column, nested under the existing `classification` sub-document
 * (no new top-level field — field-sprawl.md):
 *   classification.date_check = { verdict, reason, date_ce, checked_at, method }
 * The run itself is logged as ONE summary row in `sweep_log` (sweep 'ia-date-check-2026-10').
 *
 * Who reads it: nothing yet. The acquisition wave (#5457) is meant to take rows whose
 * verdict reads `old`. Writing here is therefore an input to a future importer — the
 * verdict file must have passed the 100-item title-page validation first (#5458).
 *
 * Guards: only rows still `source: ia_language, status: discovered`; skips rows that
 * already carry this METHOD (resumable). Dry run unless --execute.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/write-ia-date-check.mjs --file=scratch/verdicts.jsonl
 *   node --env-file=.env.production.local scripts/maintenance/write-ia-date-check.mjs --file=scratch/verdicts.jsonl --execute
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { MongoClient, ObjectId } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { METHOD } from '../lib/ia-date-check.mjs';

const args = process.argv.slice(2);
const FILE = (args.find((a) => a.startsWith('--file=')) || '').slice(7);
const EXECUTE = args.includes('--execute');
if (!FILE || !fs.existsSync(FILE)) { console.error('--file=<verdicts.jsonl> required'); process.exit(1); }
const VERDICTS = new Set(['old', 'modern', 'unknown']);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const col = db.collection('import_candidates');
const checkedAt = new Date();
const tally = { old: 0, modern: 0, unknown: 0 };
let ops = [], read = 0, matched = 0, modified = 0;

async function flush() {
  if (!ops.length) return;
  if (EXECUTE) {
    const r = await col.bulkWrite(ops, { ordered: false });
    matched += r.matchedCount; modified += r.modifiedCount;
  }
  ops = [];
}

for await (const line of readline.createInterface({ input: fs.createReadStream(FILE) })) {
  if (!line.trim()) continue;
  const v = JSON.parse(line);
  if (!VERDICTS.has(v.verdict) || v.method !== METHOD || !v._id) throw new Error(`bad verdict row: ${line.slice(0, 200)}`);
  read++; tally[v.verdict]++;
  ops.push({
    updateOne: {
      filter: { _id: new ObjectId(v._id), source: 'ia_language', status: 'discovered', 'classification.date_check.method': { $ne: METHOD } },
      update: { $set: { 'classification.date_check': { verdict: v.verdict, reason: v.reason, date_ce: v.date_ce ?? null, checked_at: checkedAt, method: METHOD } } },
    },
  });
  if (ops.length >= 2000) { await flush(); if (read % 100000 < 2000) console.log(`  …${read.toLocaleString()} (modified ${modified.toLocaleString()})`); }
}
await flush();

console.log(`read ${read.toLocaleString()} verdicts:`, tally);
if (EXECUTE) {
  console.log(`matched ${matched.toLocaleString()}, modified ${modified.toLocaleString()}`);
  await recordSweepAction(db, {
    sweep: 'ia-date-check-2026-10',
    book_id: 'import_candidates:ia_language',
    action: 'wrote-classification-date-check',
    detail: { method: METHOD, file: FILE, read, matched, modified, tally, issue: 5458 },
  });
} else console.log('Dry run — nothing written. Re-run with --execute.');
await client.close();
