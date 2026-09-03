#!/usr/bin/env node
/**
 * Boards the `forum-of-conscience` books for the full pipeline (OCR →
 * translation → enrichment) by raising `books.processing_priority`.
 *
 * This collection is a commissioned deliverable, so its books outrank the
 * algorithmic backlog — but not reader requests, which sit at the 100 ceiling
 * because a named human asked for that specific book. These get 95.
 *
 * PRIORITY CONVENTION (see board-reader-requests.mjs): 0-100, HIGHER = SOONER,
 * scored by src/lib/processing-priority.ts, dispatch sorts it descending.
 * Written with $max so an existing higher score is never lowered, and
 * provenance goes in `processing_priority_breakdown` (the breakdown-map
 * convention the import scripts use).
 *
 * BOARDING IS NOT SPENDING. The budget dial (#3737) still gates dispatch and
 * the line's pause flag still applies. This decides who goes first when the
 * dial allows; it does not itself start a paid job.
 *
 * DRY RUN BY DEFAULT.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/board-forum-of-conscience.mjs
 *   node --env-file=.env.production.local scripts/maintenance/board-forum-of-conscience.mjs --apply
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('No MONGODB_URI'); process.exit(1); }

const APPLY = process.argv.includes('--apply');
const SLUG = 'forum-of-conscience';
const PRIORITY = 95;
const REASON = 'commissioned collection — The Forum of Conscience';

const client = new MongoClient(uri);
await client.connect();
const books = client.db('bookstore').collection('books');

const rows = await books.find({ collections: SLUG }, {
  projection: { id: 1, title: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, visible: 1, processing_priority: 1 },
}).toArray();

const pages = rows.reduce((s, r) => s + (r.pages_count || 0), 0);
const ocr = rows.reduce((s, r) => s + (r.pages_ocr || 0), 0);
const tr = rows.reduce((s, r) => s + (r.pages_translated || 0), 0);
const RATE = 0.00079; // batch API, per page, per pass

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — boarding "${SLUG}" at priority ${PRIORITY}\n`);
console.log(`Books: ${rows.length}  |  pages ${pages.toLocaleString()}`);
console.log(`  OCR'd       ${ocr.toLocaleString()}   needs OCR         ${(pages - ocr).toLocaleString()}  ≈ $${((pages - ocr) * RATE).toFixed(2)}`);
console.log(`  translated  ${tr.toLocaleString()}   needs translation ${(pages - tr).toLocaleString()}  ≈ $${((pages - tr) * RATE).toFixed(2)}`);
console.log(`  both passes at batch rate ≈ $${(((pages - ocr) + (pages - tr)) * RATE).toFixed(2)}\n`);

const alreadyHigher = rows.filter(r => (r.processing_priority || 0) > PRIORITY);
if (alreadyHigher.length) console.log(`${alreadyHigher.length} book(s) already above ${PRIORITY} — $max leaves them alone.\n`);

if (!APPLY) {
  console.log('Dry run — nothing written. Re-run with --apply.');
  await client.close();
  process.exit(0);
}

let raised = 0;
for (const r of rows) {
  const res = await books.updateOne({ _id: r._id }, {
    $max: { processing_priority: PRIORITY },
    $set: { [`processing_priority_breakdown.commissioned_collection`]: REASON },
    $currentDate: { updated_at: true },
  });
  if (res.modifiedCount) raised++;
}
console.log(`Boarded ${rows.length} books (${raised} records changed).`);
console.log('Boarding only orders the queue — the budget dial and the line pause still gate dispatch.');

await client.close();
