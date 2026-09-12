#!/usr/bin/env node
/**
 * Books with both `visible: true` AND `hidden: true` are a data-quality leak —
 * `hidden_reason` (mostly "unprocessed" or "no-pages-catalog-stub") reveals the
 * intent was to hide them, but `visible` was never unset. The homepage filter
 * checks only `visible: true`, so these books leak into public counts and lists.
 *
 * This script treats `hidden: true` as authoritative and sets `visible: false`
 * on every such book.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/fix-conflicting-visibility.mjs           # dry-run
 *   node scripts/maintenance/fix-conflicting-visibility.mjs --apply   # write
 */
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

const client = await MongoClient.connect(uri);
const db = client.db('bookstore');
const books = db.collection('books');

const query = { visible: true, hidden: true };
const total = await books.countDocuments(query);

const byReason = await books.aggregate([
  { $match: query },
  { $group: { _id: '$hidden_reason', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]).toArray();

const inflating = await books.countDocuments({ ...query, pages_translated: { $gt: 0 } });

console.log(`Conflicting visible:true && hidden:true: ${total}`);
console.log('By hidden_reason:');
for (const r of byReason) console.log(`  ${(r._id ?? '(unset)').padEnd(35)} ${r.n}`);
console.log(`Of these, currently inflating homepage counts (pages_translated > 0): ${inflating}`);

if (!APPLY) {
  console.log('\nDry-run only. Re-run with --apply to set visible:false on all conflicting books.');
  await client.close();
  process.exit(0);
}

// updated_at bump is load-bearing: the Supabase catalog sync is incremental
// on updated_at, so a hide without it never propagates to books_catalog
// (the browse LISTING predicate) and the book stays publicly listed.
const res = await books.updateMany(query, { $set: { visible: false, updated_at: new Date() } });
console.log(`\nUpdated ${res.modifiedCount} books (matched ${res.matchedCount}).`);

const remaining = await books.countDocuments({ visible: true, hidden: true });
console.log(`Remaining conflicting after update: ${remaining}`);

await client.close();
