#!/usr/bin/env node
/**
 * De-duplicate gallery_images within each book.
 *
 * Cause: extraction pipeline ran multiple times on the same page, producing
 * multiple gallery_images entries with the same (book_id, page_id, image_url)
 * tuple. We keep the OLDEST entry as canonical (preserve metadata) and mark
 * the rest with book_visible=false + is_duplicate=true so they drop out of
 * gallery list views but remain in the collection for rollback.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/dedup-gallery-within-book.mjs --provider bph --dry-run
 *   node scripts/dedup-gallery-within-book.mjs --provider bph --apply
 */

import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROVIDER = args[args.indexOf('--provider') + 1] || 'bph';

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');

// Find duplicate groups: same (book_id, page_id, image_url) with n > 1
const cursor = db.collection('gallery_images').aggregate([
  { $match: { book_provider: PROVIDER, image_url: { $ne: null, $ne: '' } } },
  { $group: { _id: { book_id: '$book_id', page_id: '$page_id', image_url: '$image_url' }, count: { $sum: 1 }, ids: { $push: { id: '$_id', updated_at: '$updated_at' } } } },
  { $match: { count: { $gt: 1 } } },
], { allowDiskUse: true });

let groups = 0;
let toHide = 0;
const idsToHide = [];

for await (const g of cursor) {
  groups++;
  // Sort by updated_at ascending — keep the oldest (first one created)
  g.ids.sort((a, b) => new Date(a.updated_at || 0) - new Date(b.updated_at || 0));
  const dupIds = g.ids.slice(1).map(x => x.id);
  toHide += dupIds.length;
  idsToHide.push(...dupIds);
  if (groups % 200 === 0) console.log(`  ${groups} groups, ${toHide} duplicates so far`);
}

console.log(`\nFound ${groups} duplicate groups, would hide ${toHide} gallery entries (provider=${PROVIDER}).`);

if (!APPLY) {
  console.log('[dry-run] add --apply to mark them is_duplicate + book_visible=false');
  await c.close();
  process.exit(0);
}

const r = await db.collection('gallery_images').updateMany(
  { _id: { $in: idsToHide } },
  { $set: { is_duplicate: true, book_visible: false, dedup_hidden_at: new Date(), updated_at: new Date() } }
);
console.log(`Marked ${r.modifiedCount} gallery entries as duplicate.`);
await c.close();
