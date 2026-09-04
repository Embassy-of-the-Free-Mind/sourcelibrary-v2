#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/backfill-gemini-usage-page-count.mjs — fills `page_count`
 * on usage rows from `page_ids`; a different field, a different source, and it cannot
 * repair the date. Also checked: backfill-usage-daily.mjs (rolls rows UP into usage_daily,
 * assumes the date field is already readable — this script is what makes that true),
 * backfill-batch-costs.mjs and reconcile-batch-usage.mjs (both close out placeholder
 * SPEND, never the timestamp), and scripts/audit/spend-reconcile.mjs. No existing script
 * repairs the date field on `gemini_usage`.
 *
 * backfill-gemini-usage-timestamp — make every `gemini_usage` row date-queryable.
 *
 * WHAT THE DEFECT ACTUALLY IS (#4593 was filed with it inverted).
 * -------------------------------------------------------------
 * The issue reported that writers "dropped `created_at`", leaving every date-scoped
 * read — including the $5/day dial — seeing $0. Measured against the collection on
 * 2026-09-05, that is not what happened:
 *
 *   - 4,229,556 of 4,230,937 rows carry `timestamp` as a real BSON Date. Every live
 *     reader queries `timestamp` (14 read sites in src/ and scripts/), and they all
 *     work. `created_at` on this collection is read by NOTHING.
 *   - The dial does not use either field: `scripts/lib/spend-guard.mjs` selects Mongo
 *     rows by ObjectId time range on purpose (old rows stored `timestamp` as a string),
 *     and Supabase rows by `timestamp`. It was never blind to these rows.
 *   - The rows that ARE invisible are the inverse of the claim: 1,381 rows from
 *     2026-03 written before the Supabase-shaped row schema (#567 Phase 3) carry
 *     `created_at` and NO `timestamp`, so a `timestamp`-scoped read skips them.
 *
 * So the repair is one-directional and small: copy `created_at` into `timestamp` on
 * those legacy rows. Nothing is invented — `created_at` is the real write time, exact
 * to the millisecond, and it is left in place as provenance. Rows with NEITHER field
 * are reported and skipped: an `_id` timestamp would be a plausible guess, and a
 * plausible guess in a spend record is worse than a gap you can see.
 *
 * WHAT READS THIS, AND WHEN (writing to a store a job reads is actuation).
 * -----------------------------------------------------------------------
 * `backfill-usage-daily.mjs` and `scripts/workers/sync-worker.mjs` roll these rows up
 * into `usage_daily` by day, and the admin usage dashboards read them live. After this
 * runs, a March 2026 window that reported $0.00 will report $2.72 — that is the whole
 * visible effect, and it is a correction, not new spend. The dial is unaffected either
 * way, because it never read these fields.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/backfill-gemini-usage-timestamp.mjs
 *   node --env-file=.env.production.local scripts/maintenance/backfill-gemini-usage-timestamp.mjs --apply
 *
 * Default is a dry run, which doubles as the standing detector: exit 2 means rows are
 * date-invisible, exit 0 means the collection is fully queryable by `timestamp`.
 */

import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not set — run with --env-file=.env.production.local');
  process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 30000 });
await client.connect();
const col = client.db(process.env.MONGODB_DB || 'bookstore').collection('gemini_usage');

const total = await col.estimatedDocumentCount();
const missingTs = { timestamp: { $exists: false } };
const repairable = { ...missingTs, created_at: { $exists: true } };
const unrepairable = { ...missingTs, created_at: { $exists: false } };

const [nMissing, nRepairable, nUnrepairable] = await Promise.all([
  col.countDocuments(missingTs),
  col.countDocuments(repairable),
  col.countDocuments(unrepairable),
]);

console.log(`gemini_usage rows ................. ${total.toLocaleString()}`);
console.log(`  without a queryable timestamp ... ${nMissing.toLocaleString()}`);
console.log(`    repairable from created_at .... ${nRepairable.toLocaleString()}`);
console.log(`    NOT repairable (no date field)  ${nUnrepairable.toLocaleString()}`);

if (nUnrepairable > 0) {
  // Say it plainly rather than reaching for the ObjectId: these rows have no
  // recorded write time, and inventing one would make the gap unfindable.
  console.log('\n  Rows with no date field are LEFT ALONE. Their write time is not');
  console.log('  recoverable from the row, and an ObjectId-derived guess would look');
  console.log('  exactly like a recorded time to every later reader.');
}

if (nRepairable === 0) {
  console.log('\nNothing to repair.');
  await client.close();
  process.exit(nMissing > 0 ? 2 : 0);
}

if (!APPLY) {
  const sample = await col.find(repairable, { projection: { created_at: 1, type: 1, cost_usd: 1 } })
    .limit(3).toArray();
  console.log('\nSample of what would be written:');
  for (const s of sample) {
    console.log(`  ${s._id}  timestamp <- created_at = ${new Date(s.created_at).toISOString()}  (${s.type})`);
  }
  console.log('\nDRY RUN — re-run with --apply to write.');
  await client.close();
  process.exit(2);
}

// $set from another field, in one pass. Aggregation-pipeline update so the value
// comes from the row itself and can never be a clock read on this machine.
const res = await col.updateMany(repairable, [{ $set: { timestamp: '$created_at' } }]);
console.log(`\nmatched ${res.matchedCount}, modified ${res.modifiedCount}`);

const after = await col.countDocuments(missingTs);
console.log(`rows still without a timestamp: ${after.toLocaleString()} (expected ${nUnrepairable.toLocaleString()})`);
await client.close();
process.exit(after > nUnrepairable ? 2 : 0);
