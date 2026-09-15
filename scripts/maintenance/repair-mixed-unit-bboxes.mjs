#!/usr/bin/env node
/**
 * Repair gallery crops whose bbox the old normaliser damaged (mixed 0–1 / 0–1000 units).
 *
 * PRIOR ART: none — checked scripts/maintenance/ (backfill-gallery-*.mjs write other fields;
 * cleanup-gallery-zombies.mjs removes rows with NO bbox, not rows with a speck-sized one)
 * and scripts/audit/. The detection/inversion rule lives in scripts/lib/bbox.mjs.
 *
 * WHAT IT FIXES
 * -------------
 * Until scripts/lib/bbox.mjs landed, every writer scaled ALL FOUR bbox fields by 1000 when
 * ANY field was > 1. The model sometimes answers with one field in permille beside three in
 * fractions, and the three fractions became 0.000498-style specks — a 1×1-pixel crop that
 * the gallery renders as a blown-up smear. Measured 2026-09-14: 198 of 2,768 gallery rows
 * written the previous week (7%).
 *
 * The damage is invertible: a field below 0.001 that sits beside a healthy width/height was
 * a fraction divided by 1000, so ×1000 restores it. `repairMixedUnitBbox` applies that only
 * when the result is a sane box inside the page (see the .mjs for the edge cases it refuses).
 *
 * WHAT IT WRITES
 * --------------
 *   gallery_images.bbox                        — the corrected box
 *   pages.detected_images[<detection_index>].bbox — the paired source detection (#2531: the
 *                                                 gallery doc is a denormalised copy)
 *   sweep_log                                  — one row per book (field-sprawl rule)
 * Nothing else. Rows the inversion cannot repair are listed, not touched.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-mixed-unit-bboxes.mjs           # dry run
 *   node --env-file=.env.production.local scripts/maintenance/repair-mixed-unit-bboxes.mjs --apply
 *   … --book-id <id>   confine to one book
 */

import { MongoClient } from 'mongodb';
import { repairMixedUnitBbox, MIN_BBOX_EXTENT } from '../lib/bbox.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const bookIdx = args.indexOf('--book-id');
const BOOK_ID = bookIdx >= 0 ? args[bookIdx + 1] : null;
const SWEEP = 'repair-mixed-unit-bboxes-2026-09';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// A speck is a width or height below MIN_BBOX_EXTENT/5 — well under anything the model
// means as a crop. gallery_images has no index on bbox; it is ~200K docs, a scan is fine.
const speck = MIN_BBOX_EXTENT / 5;
const filter = {
  $or: [{ 'bbox.width': { $lt: speck } }, { 'bbox.height': { $lt: speck } }],
  ...(BOOK_ID ? { book_id: BOOK_ID } : {}),
};
const rows = await db.collection('gallery_images')
  .find(filter, { projection: { id: 1, book_id: 1, page_id: 1, page_number: 1, detection_index: 1, bbox: 1 } })
  .toArray();

let repairable = 0, unrepairable = 0, galleryWritten = 0, pagesWritten = 0;
const perBook = new Map();
const cannot = [];

for (const row of rows) {
  const fixed = repairMixedUnitBbox(row.bbox);
  if (!fixed) { unrepairable++; cannot.push(row); continue; }
  repairable++;
  if (!perBook.has(row.book_id)) perBook.set(row.book_id, 0);
  perBook.set(row.book_id, perBook.get(row.book_id) + 1);
  if (!APPLY) continue;

  const g = await db.collection('gallery_images').updateOne(
    { id: row.id, bbox: row.bbox }, // only if still the damaged box (another writer may have re-extracted)
    { $set: { bbox: fixed, updated_at: new Date() } },
  );
  galleryWritten += g.modifiedCount;

  if (row.page_id && Number.isInteger(row.detection_index)) {
    const p = await db.collection('pages').updateOne(
      { id: row.page_id, [`detected_images.${row.detection_index}.bbox.width`]: row.bbox.width },
      { $set: { [`detected_images.${row.detection_index}.bbox`]: fixed } },
    );
    pagesWritten += p.modifiedCount;
  }
}

if (APPLY) {
  for (const [book_id, n] of perBook) {
    await recordSweepAction(db, { sweep: SWEEP, book_id, action: 'bbox-mixed-units-inverted', detail: { rows: n } });
  }
}

console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} — speck-bbox gallery rows: ${rows.length} in ${perBook.size + (cannot.length ? 1 : 0)} book(s)`);
console.log(`  repairable: ${repairable}  unrepairable (left as-is): ${unrepairable}`);
if (APPLY) console.log(`  gallery_images modified: ${galleryWritten}  pages.detected_images modified: ${pagesWritten}  (compare to repairable=${repairable})`);
for (const r of cannot.slice(0, 10)) console.log(`  cannot: ${r.book_id} p${r.page_number} ${JSON.stringify(r.bbox)}`);

await client.close();
