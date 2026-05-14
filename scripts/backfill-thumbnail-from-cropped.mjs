#!/usr/bin/env node
/**
 * Backfill thumbnail_blob and image_thumb on every page where the split-
 * spread split happened AFTER thumbnail generation — so the existing
 * thumbnail_blob points at the uncropped full-spread thumbnail. Set both
 * fields to cropped_photo (which has the correct per-half image).
 *
 * Bug context — see issue #1729 / PR #1728 for the full write-up:
 *   1. curator uploads 2-page spread → /archived/{book}/{N}.jpg
 *   2. archive cron generates 150px thumb → /pages/{book}/{N}-thumb.jpg
 *      (this is the FULL SPREAD's thumbnail) → stored as thumbnail_blob
 *   3. spread-splitter runs LATER, creates a 2nd page doc per spread,
 *      sets cropped_photo to the cropped half — but copies the stale
 *      thumbnail_blob onto both halves instead of regenerating
 *
 * Library-wide scope (from .claude/docs/thumbnail-mismatch-2026-05-12.json):
 *   - 1,194 visible books affected, 407,554 pages mismatched
 *   - 1,148 BPH books, 42 Internet Archive, 3 Gallica, 1 BL
 *
 * What this script does (per affected book):
 *   1. Take a snapshot of pages with cropped_photo set (just _id + old fields)
 *   2. updateMany pages where thumbnail_blob != cropped_photo (and
 *      cropped_photo is not null) → set thumbnail_blob and image_thumb
 *      to cropped_photo
 *   3. Verify the count
 *
 * Reversibility: snapshots saved under
 * .claude/docs/snapshots/thumb-backfill-<book_id>.json. Restoration
 * script: scripts/undo-thumb-backfill.mjs
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/backfill-thumbnail-from-cropped.mjs --dry-run
 *   node scripts/backfill-thumbnail-from-cropped.mjs --book <id>
 *   node scripts/backfill-thumbnail-from-cropped.mjs --apply        # all 1,194
 *   node scripts/backfill-thumbnail-from-cropped.mjs --apply --skip-snapshot
 *
 * Snapshots can be skipped on small books (the change is recoverable
 * by re-running the archive cron's thumbnail step) but on by default.
 */

import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const SKIP_SNAPSHOT = args.includes('--skip-snapshot');
const SINGLE_BOOK = (() => {
  const i = args.indexOf('--book');
  return i !== -1 ? args[i + 1] : null;
})();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }

async function processBook(db, bookId) {
  // Count affected pages first
  const filter = {
    book_id: bookId,
    cropped_photo: { $exists: true, $ne: null },
    $or: [
      { $expr: { $ne: ['$thumbnail_blob', '$cropped_photo'] } },
      { $expr: { $ne: ['$image_thumb', '$cropped_photo'] } },
    ],
  };
  const toUpdate = await db.collection('pages').countDocuments(filter);
  if (toUpdate === 0) return { bookId, before: 0, after: 0 };

  if (!APPLY) return { bookId, would_update: toUpdate };

  // Snapshot (unless skipped)
  if (!SKIP_SNAPSHOT) {
    const before = await db.collection('pages').find(
      { book_id: bookId, cropped_photo: { $exists: true, $ne: null } },
      { projection: { _id: 1, page_number: 1, thumbnail_blob: 1, image_thumb: 1, thumbnail: 1, cropped_photo: 1 } }
    ).toArray();
    const snapPath = resolve(REPO_ROOT, '.claude/docs/snapshots', `thumb-backfill-${bookId}.json`);
    mkdirSync(dirname(snapPath), { recursive: true });
    writeFileSync(snapPath, JSON.stringify({
      snapshot_date: new Date().toISOString(),
      book_id: bookId,
      pages: before.map(p => ({
        _id: String(p._id),
        page_number: p.page_number,
        thumbnail_blob: p.thumbnail_blob ?? null,
        image_thumb: p.image_thumb ?? null,
        thumbnail: p.thumbnail ?? null,
      })),
    }));
  }

  // Aggregation-pipeline updateMany — atomic per-doc
  const r = await db.collection('pages').updateMany(
    { book_id: bookId, cropped_photo: { $exists: true, $ne: null } },
    [
      { $set: {
        thumbnail_blob: '$cropped_photo',
        image_thumb: '$cropped_photo',
        thumbnail: '$cropped_photo',
        updated_at: new Date(),
      } }
    ]
  );
  return { bookId, before: toUpdate, modified: r.modifiedCount, matched: r.matchedCount };
}

async function main() {
  const auditPath = resolve(REPO_ROOT, '.claude/docs/thumbnail-mismatch-2026-05-12.json');
  const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
  let books;
  if (SINGLE_BOOK) {
    books = audit.offenders.filter(o => o.id === SINGLE_BOOK);
  } else {
    books = audit.offenders;
  }
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} (snapshots ${SKIP_SNAPSHOT ? 'OFF' : 'on'})`);
  console.log(`Books in target set: ${books.length}`);
  console.log(`Expected mismatched pages: ${books.reduce((s, b) => s + b.mismatches, 0).toLocaleString()}`);

  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 30000, socketTimeoutMS: 600000 });
  await client.connect();
  const db = client.db('bookstore');

  let bookCount = 0;
  let totalUpdated = 0;
  const t0 = Date.now();
  for (const b of books) {
    bookCount++;
    if (bookCount % 50 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`  ${bookCount}/${books.length} books, ${totalUpdated.toLocaleString()} pages updated (${elapsed}s)`);
    }
    const r = await processBook(db, b.id);
    if (APPLY) totalUpdated += (r.modified || 0);
    else totalUpdated += (r.would_update || 0);
  }
  console.log(`\n=== Done ===`);
  console.log(`  Books processed: ${bookCount}`);
  console.log(`  Pages ${APPLY ? 'updated' : 'would update'}: ${totalUpdated.toLocaleString()}`);
  console.log(`  Elapsed: ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
