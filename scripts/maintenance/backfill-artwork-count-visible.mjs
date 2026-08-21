#!/usr/bin/env node
/**
 * Fix collections.artwork_count to count only VISIBLE artworks, matching what the
 * public /collections/[id] page shows (src/app/collections/[id]/page.tsx artFilter).
 *
 * The bug: syncCollectionCounts counted `{ resource_type: { $exists: true } }` with
 * NO visibility filter, so hidden artworks inflated the card "· N artworks" label
 * (~14.6K phantom counts across the library; natural-philosophy read 1697 vs a true
 * 800, and six collections advertised artworks they had 0 of publicly). This applies
 * the corrected filter as a one-time backfill; sync-worker.mjs is fixed to match.
 *
 *   node scripts/maintenance/backfill-artwork-count-visible.mjs [--apply]
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
// Kept in sync with ART_EXCLUDED_RESOURCE_TYPES (src/lib/collections-utils.ts).
const ART_EXCLUDED_RESOURCE_TYPES = ['photograph', 'object', 'sculpture', 'architectural', 'decorative', 'ritual-object'];

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const Books = db.collection('books');
const Cols = db.collection('collections');

const rows = await Books.aggregate([
  { $match: { resource_type: { $exists: true, $nin: ART_EXCLUDED_RESOURCE_TYPES }, visible: true, status: { $ne: 'deleted' } } },
  { $unwind: '$collections' },
  { $group: { _id: '$collections', n: { $sum: 1 } } },
], { allowDiskUse: true }).toArray();
const correctMap = new Map(rows.map(r => [r._id, r.n]));

const cols = await Cols.find({}).project({ _id: 1, slug: 1, artwork_count: 1, parent: 1 }).toArray();
const before = cols.filter(c => (c.artwork_count || 0) !== (correctMap.get(c.slug) || 0))
  .map(c => ({ slug: c.slug, from: c.artwork_count || 0, to: correctMap.get(c.slug) || 0 }));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(`scripts/output/artwork-count-backfill-${stamp}.json`, JSON.stringify(before, null, 2));

const ops = [];
for (const col of cols) {
  const correct = correctMap.get(col.slug) || 0;
  if ((col.artwork_count || 0) !== correct) {
    ops.push({ updateOne: { filter: { _id: col._id }, update: { $set: { artwork_count: correct, updated_at: new Date() } } } });
  }
}
console.log(`${ops.length} collections need artwork_count corrected (backup: scripts/output/artwork-count-backfill-${stamp}.json)`);
for (const b of before.filter(b => Math.abs(b.from - b.to) >= 30).sort((a, b) => (b.from - b.to) - (a.from - a.to)).slice(0, 15)) {
  console.log(`   ${String(b.from).padStart(4)} -> ${String(b.to).padStart(4)}   ${b.slug}`);
}
if (APPLY && ops.length) { const r = await Cols.bulkWrite(ops); console.log('modified:', r.modifiedCount); }
else console.log('DRY RUN — pass --apply to write.');
await c.close();
