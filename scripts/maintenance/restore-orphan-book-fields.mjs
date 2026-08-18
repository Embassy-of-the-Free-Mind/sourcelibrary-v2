#!/usr/bin/env node

/**
 * Undo `delete-orphan-book-fields.mjs` by replaying the `sweep_log` rows it wrote.
 *
 * This is the reason the deletion is safe to run at all. The deletion records
 * every removed field and its value in a row keyed to the book BEFORE unsetting
 * anything; this script reads those rows back and re-sets the values. A
 * deletion you cannot reverse is a decision; a deletion you can reverse is an
 * experiment.
 *
 * Test it on a canary batch BEFORE the full deletion — a restore path that has
 * never been exercised is not a restore path.
 *
 * Only restores fields that are currently ABSENT, so re-running is safe and it
 * can never clobber a value written after the deletion.
 *
 * USAGE
 *   node --env-file=.env.production.local scripts/maintenance/restore-orphan-book-fields.mjs            # dry run
 *   node --env-file=.env.production.local scripts/maintenance/restore-orphan-book-fields.mjs --apply
 *   ... --book-id <id>    restore one book
 */

import { MongoClient } from 'mongodb';

// --sweep <name>: restore a different deletion run through the same replay.
const SWEEP = (() => { const i = process.argv.indexOf('--sweep'); return i > -1 ? process.argv[i + 1] : 'orphan-field-deletion-2026-08'; })();
const APPLY = process.argv.includes('--apply');
const BOOK_ID = (() => { const i = process.argv.indexOf('--book-id'); return i > -1 ? process.argv[i + 1] : null; })();

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('Missing MONGODB_URI'); process.exit(2); }

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000, socketTimeoutMS: 600000 });
await client.connect();
const db = client.db(process.env.DB_NAME || 'bookstore');
const books = db.collection('books');

const query = { sweep: SWEEP, action: 'orphan-fields-removed' };
if (BOOK_ID) query.book_id = BOOK_ID;

const rows = await db.collection('sweep_log').find(query).toArray();
console.log(`Restore from sweep_log — ${rows.length} row(s)${BOOK_ID ? ` for book ${BOOK_ID}` : ''}`);
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

let restored = 0, fields = 0, missingBooks = 0, skippedPresent = 0;

for (const row of rows) {
  const removed = row.detail?.removed || {};
  const names = Object.keys(removed);
  if (!names.length) continue;

  const book = await books.findOne({ id: row.book_id }, { projection: Object.fromEntries(names.map((f) => [f, 1])) });
  if (!book) { missingBooks++; continue; }

  // Only restore what is currently absent — never clobber a newer value.
  const toSet = {};
  for (const f of names) {
    if (f in book) { skippedPresent++; continue; }
    toSet[f] = removed[f];
  }
  if (!Object.keys(toSet).length) continue;

  if (APPLY) {
    const r = await books.updateOne({ id: row.book_id }, { $set: toSet });
    restored += r.modifiedCount;
  } else {
    restored += 1;
  }
  fields += Object.keys(toSet).length;
}

console.log(`books ${APPLY ? 'restored' : 'that would be restored'}: ${restored}`);
console.log(`field values                                : ${fields}`);
console.log(`sweep_log rows whose book is gone           : ${missingBooks}`);
console.log(`fields already present (left alone)         : ${skippedPresent}`);
if (!APPLY) console.log('\nDry-run only. Re-run with --apply to restore.');

await client.close();
