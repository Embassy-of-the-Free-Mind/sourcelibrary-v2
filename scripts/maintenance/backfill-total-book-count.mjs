#!/usr/bin/env node
/**
 * Backfill collections.total_book_count = ALL visible member books (regardless
 * of translation), so cards can show total holdings rather than the
 * translated-only `book_count` (which syncCollectionCounts caches with a
 * pages_translated>0 filter). Artworks are excluded (counted as artwork_count).
 *   node scripts/maintenance/backfill-total-book-count.mjs [--apply]
 */
import { MongoClient } from 'mongodb';
const APPLY = process.argv.includes('--apply');
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');

const rows = await db.collection('books').aggregate([
  { $match: { status: { $ne: 'deleted' }, visible: true, resource_type: { $exists: false } } },
  { $unwind: '$collections' },
  { $group: { _id: '$collections', n: { $sum: 1 } } },
], { allowDiskUse: true }).toArray();
const totalMap = new Map(rows.map(r => [r._id, r.n]));

const cols = await db.collection('collections')
  .find({}, { projection: { _id:1, slug:1, name:1, book_count:1, total_book_count:1, parent:1 } }).toArray();

const ops = []; let changed = 0;
const sample = [];
for (const col of cols) {
  const total = totalMap.get(col.slug) || 0;
  if ((col.total_book_count || 0) !== total) {
    changed++;
    ops.push({ updateOne: { filter: { _id: col._id }, update: { $set: { total_book_count: total, updated_at: new Date() } } } });
  }
  if (!col.parent && total !== (col.book_count||0)) sample.push({ slug: col.slug, translated: col.book_count||0, total });
}
sample.sort((a,b)=>b.total-a.total);
console.log('Top-level cards where total > translated (sample):');
for (const s of sample.slice(0,20)) console.log(`  ${s.translated} -> ${s.total}\t ${s.slug}`);
console.log(`\n${changed} collections need total_book_count set.`);
if (APPLY && ops.length) { const r = await db.collection('collections').bulkWrite(ops); console.log('modified:', r.modifiedCount); }
else console.log('DRY RUN — pass --apply to write.');
await c.close();
