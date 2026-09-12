#!/usr/bin/env node
/**
 * Coverage of the citation copy clause (#4360/#4361): how many live books can
 * name the library whose physical copy their scan shows, and how many still
 * carry an AGGREGATOR (Internet Archive, Google Books, …) as their
 * "contributing library" — a holding that does not exist, which the citation
 * layer therefore suppresses.
 *
 * Read-only. Exit 0 always (reporting, not gating); the aggregator list here
 * mirrors src/lib/holding-library.ts (AGGREGATORS).
 *
 *   node --env-file=.env.production.local scripts/audit/holding-library-coverage.mjs
 */
import { MongoClient } from 'mongodb';

const AGGREGATOR_VALUES = [
  'internet archive', 'archive.org', 'google books', 'google',
  'hathitrust', 'project gutenberg', 'wikimedia commons', 'wikisource',
  'e-rara (swiss electronic library)', 'e-rara',
  'iiif source',
  // Null-holder tokens IA metadata itself serves — suppressed read-side.
  'unknown library', 'unknown',
];

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const books = db.collection('books');
const LIVE = { visible: true, pages_count: { $gt: 0 } };

const total = await books.countDocuments(LIVE);

// Same coalescing as resolveHoldingCopy: image_source.* wins, the top-level
// legacy twin fills in (3,860 live books rely on it until phase 6 runs).
const LIB_EXPR = { $ifNull: ['$image_source.contributing_library', { $ifNull: ['$contributing_library', ''] }] };
const MARK_EXPR = { $ifNull: ['$image_source.shelfmark', { $ifNull: ['$shelfmark', ''] }] };

const [row] = await books.aggregate([
  { $match: LIVE },
  { $project: { lib: { $toLower: { $toString: LIB_EXPR } }, mark: MARK_EXPR } },
  { $group: {
    _id: null,
    withLibrary: { $sum: { $cond: [{ $gt: [{ $strLenCP: '$lib' }, 0] }, 1, 0] } },
    withShelfmark: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $toString: '$mark' } }, 0] }, 1, 0] } },
    aggregator: { $sum: { $cond: [{ $in: ['$lib', AGGREGATOR_VALUES] }, 1, 0] } },
  } },
]).toArray();
const { withLibrary, withShelfmark, aggregator: aggTotal } = row;

const aggRows = await books.aggregate([
  { $match: LIVE },
  { $project: { lib: { $toLower: { $toString: LIB_EXPR } } } },
  { $match: { lib: { $in: AGGREGATOR_VALUES } } },
  { $group: { _id: '$lib', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]).toArray();

const citable = withLibrary - aggTotal;
const pct = n => `${((n / total) * 100).toFixed(1)}%`;

console.log(`Live books:                      ${total}`);
console.log(`contributing_library present:    ${withLibrary} (${pct(withLibrary)}) [either field location]`);
console.log(`  …but an aggregator, not a holder: ${aggTotal}`);
console.log(`Copy clause CITABLE (real holder): ${citable} (${pct(citable)})`);
console.log(`shelfmark present:               ${withShelfmark} (${pct(withShelfmark)})`);
if (aggRows.length) {
  console.log('\nAggregator values still standing as holders (run backfill phase 4):');
  for (const r of aggRows) console.log(`  ${String(r.n).padStart(6)}  ${r._id}`);
}

// Top holders — variant spellings show up here as near-duplicate rows.
const top = await books.aggregate([
  { $match: { ...LIVE, 'image_source.contributing_library': { $nin: [null, ''] } } },
  { $group: { _id: '$image_source.contributing_library', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
  { $limit: 15 },
]).toArray();
console.log('\nTop contributing libraries (watch for variant spellings of one institution):');
for (const r of top) console.log(`  ${String(r.n).padStart(6)}  ${r._id}`);

await client.close();
