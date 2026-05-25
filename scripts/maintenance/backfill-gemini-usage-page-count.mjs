#!/usr/bin/env node
/**
 * Backfill: set page_count = page_ids.length on legacy gemini_usage records
 * that were written before the supabase-usage-logger migration (PR #944,
 * 2026-04-10). Those direct-Mongo writes never populated page_count, so
 * type=translation pages in `gemini_usage_daily` underreport by ~55%.
 *
 * Safe: only updates rows where page_ids is a non-empty array AND
 * page_count is missing or zero. Idempotent.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-gemini-usage-page-count.mjs --dry-run
 *   node scripts/maintenance/backfill-gemini-usage-page-count.mjs
 */
import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const BATCH_SIZE = 5000;

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const usage = db.collection('gemini_usage');

const FILTER = {
  $and: [
    { page_ids: { $exists: true, $type: 'array', $ne: [] } },
    { $or: [
      { page_count: { $exists: false } },
      { page_count: null },
      { page_count: 0 },
    ]},
  ],
};

const total = await usage.countDocuments(FILTER);
console.log(`Eligible rows: ${total.toLocaleString()}${DRY_RUN ? ' (DRY RUN — no writes)' : ''}`);

if (total === 0) {
  await c.close();
  process.exit(0);
}

// Breakdown by type for visibility
const byType = await usage.aggregate([
  { $match: FILTER },
  { $group: { _id: '$type', count: { $sum: 1 } } },
  { $sort: { count: -1 } },
]).toArray();
console.log('Breakdown by type:');
for (const r of byType) console.log(`  ${r._id || 'unknown'}: ${r.count.toLocaleString()}`);

if (DRY_RUN) {
  // Show 3 sample docs that would be updated
  console.log('\nSample docs (would be updated):');
  const samples = await usage.find(FILTER).limit(3).toArray();
  for (const s of samples) {
    console.log(`  ${s._id} type=${s.type} page_ids.length=${s.page_ids.length} page_count=${s.page_count ?? 'MISSING'}`);
  }
  await c.close();
  process.exit(0);
}

console.log(`\nApplying update in batches of ${BATCH_SIZE.toLocaleString()}...`);
const startedAt = Date.now();
let processed = 0;

// MongoDB updateMany with $set + $size requires an aggregation pipeline (5.0+)
while (processed < total) {
  // Pull a batch of _ids to update (avoids re-querying the same docs after update)
  const batch = await usage.find(FILTER, { projection: { _id: 1, page_ids: 1 } })
    .limit(BATCH_SIZE)
    .toArray();

  if (batch.length === 0) break;

  const bulkOps = batch.map(doc => ({
    updateOne: {
      filter: { _id: doc._id },
      update: { $set: { page_count: doc.page_ids.length } },
    },
  }));

  const result = await usage.bulkWrite(bulkOps, { ordered: false });
  processed += result.modifiedCount;

  const pct = (processed / total * 100).toFixed(1);
  const rate = processed / ((Date.now() - startedAt) / 1000);
  console.log(`  ${processed.toLocaleString()} / ${total.toLocaleString()} (${pct}%)  ${rate.toFixed(0)} docs/s`);
}

console.log(`\nDone. Updated ${processed.toLocaleString()} docs in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
console.log('\nNext: rebuild gemini_usage_daily so downstream analytics reflect the fix:');
console.log('  node scripts/maintenance/backfill-usage-daily.mjs --since 2026-01-02');

await c.close();
