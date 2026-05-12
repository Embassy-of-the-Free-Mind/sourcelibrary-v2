#!/usr/bin/env node
/**
 * Reverse a single book's spread-dedup using its snapshot from
 * .claude/docs/snapshots/dedup-<book_id>.json.
 *
 * Restores every page doc's `page_number` to its pre-dedup value and
 * clears `is_duplicate`, `duplicate_of`, `original_page_number`. Resets
 * `book.pages_count` to the pre-dedup value.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/undo-spread-dedup.mjs --book <id>
 */

import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const args = process.argv.slice(2);
const BOOK = args[args.indexOf('--book') + 1];
if (!BOOK) { console.error('--book <id> required'); process.exit(1); }

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }

const snapPath = resolve(REPO_ROOT, '.claude/docs/snapshots', `dedup-${BOOK}.json`);
const snap = JSON.parse(readFileSync(snapPath, 'utf8'));

const c = new MongoClient(MONGODB_URI);
await c.connect();
const db = c.db('bookstore');

let restored = 0;
for (const p of snap.pages) {
  // _id was JSON-serialized as a hex string; convert back to ObjectId.
  const idFilter = typeof p._id === 'string' && /^[0-9a-f]{24}$/.test(p._id)
    ? { _id: new ObjectId(p._id) }
    : { _id: p._id };
  const r = await db.collection('pages').updateOne(
    idFilter,
    {
      $set: { page_number: p.page_number, updated_at: new Date() },
      $unset: { is_duplicate: '', duplicate_of: '', original_page_number: '' },
    }
  );
  if (r.matchedCount > 0) restored++;
}
await db.collection('books').updateOne(
  { id: BOOK },
  { $set: { pages_count: snap.pages_count_before, updated_at: new Date() } }
);
// Also reset pages_ocr / pages_translated based on current page_number > 0 set
const ocr = await db.collection('pages').countDocuments({ book_id: BOOK, page_number: { $gt: 0 }, 'ocr.data': { $exists: true, $ne: null } });
const trans = await db.collection('pages').countDocuments({ book_id: BOOK, page_number: { $gt: 0 }, 'translation.data': { $exists: true, $ne: null } });
await db.collection('books').updateOne(
  { id: BOOK },
  { $set: { pages_ocr: ocr, pages_translated: trans } }
);
console.log(`Restored ${restored} pages. pages_count → ${snap.pages_count_before}, ocr=${ocr}, translated=${trans}.`);
await c.close();
