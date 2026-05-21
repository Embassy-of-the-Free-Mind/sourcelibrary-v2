#!/usr/bin/env node

/**
 * Read-only: count rows tagged with each source-provider tenant id across the
 * collections that carry `tenantId`. Surfaces the real blast radius for the
 * follow-up data-migration PR (the one that will rewrite tenantId references
 * to the `default` tenant).
 *
 * Issue #1905 claims 734 gallery_images + 98 books + 134 collections for
 * internet-archive alone. This script verifies and prints per-provider counts
 * across all source-provider tenants.
 *
 * Implementation note: a single $group aggregation per collection (one pass
 * over the collection) is dramatically faster than per-tenant countDocuments
 * calls when `tenantId` isn't indexed.
 *
 * Usage:
 *   node scripts/maintenance/measure-source-provider-scope.mjs \
 *     --mongo-uri "$MONGODB_URI" --db bookstore
 */

import { MongoClient } from 'mongodb';
import 'dotenv/config';

// `pages` (downstream of books, millions of rows) is excluded by default —
// the per-book ratio is consistent enough that the books count is sufficient
// for sizing the migration. Pass --include-pages to scan it.
const COLLECTIONS_BASE = [
  'gallery_images',
  'books',
  'collections',
  'library_catalog_records',
];
const COLLECTIONS_OPTIONAL = ['pages'];

function parseArgs(argv) {
  const args = {
    mongoUri: process.env.MONGODB_URI || process.env.MONGODB_URL || '',
    dbName: process.env.DB_NAME || process.env.MONGODB_DB || 'bookstore',
    includePages: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--mongo-uri' && next) { args.mongoUri = next.trim(); i += 1; }
    else if (a === '--db' && next) { args.dbName = next.trim(); i += 1; }
    else if (a === '--include-pages') { args.includePages = true; }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.mongoUri) throw new Error('Missing MONGODB_URI');
  const collectionsToCount = args.includePages
    ? [...COLLECTIONS_BASE, ...COLLECTIONS_OPTIONAL]
    : COLLECTIONS_BASE;

  const client = new MongoClient(args.mongoUri, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 600_000,
  });

  await client.connect();
  const db = client.db(args.dbName);

  // Identify source-provider tenant ids. Prefer the kind: 'source' filter
  // (post-migration); fall back to "every tenant that isn't bph/kloss/default"
  // (pre-migration) so this script works in both states.
  const sourceRows = await db.collection('tenants')
    .find({
      $or: [
        { kind: 'source' },
        { slug: { $nin: ['bph', 'kloss-collection', 'default'] }, kind: { $exists: false } },
      ],
      status: { $ne: 'deleted' },
    })
    .project({ id: 1, slug: 1, name: 1, kind: 1 })
    .toArray();

  console.log(`Source-provider tenant rows: ${sourceRows.length}`);
  console.log('---');

  const sourceIds = new Set(sourceRows.map((r) => r.id));
  const slugById = new Map(sourceRows.map((r) => [r.id, r.slug]));

  // For each collection, run one $group pass grouping by tenantId. Then
  // pick out the source-provider ids.
  const perCollection = {}; // { collection: { tenantId: count } }
  for (const coll of collectionsToCount) {
    console.log(`Scanning ${coll}…`);
    const t0 = Date.now();
    const cursor = db.collection(coll).aggregate(
      [{ $group: { _id: '$tenantId', n: { $sum: 1 } } }],
      { allowDiskUse: true, maxTimeMS: 600_000 }
    );
    const counts = {};
    for await (const row of cursor) {
      if (row._id && sourceIds.has(row._id)) {
        counts[row._id] = row.n;
      }
    }
    perCollection[coll] = counts;
    console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${Object.keys(counts).length} source-provider buckets`);
  }

  console.log('---');
  const header = ['slug'.padEnd(28), ...collectionsToCount.map((c) => c.padStart(14))].join(' | ');
  console.log(header);
  console.log('-'.repeat(header.length));

  const totals = Object.fromEntries(collectionsToCount.map((c) => [c, 0]));
  // Sort by total descending for readability
  const sortedRows = [...sourceRows].sort((a, b) => {
    const totalA = collectionsToCount.reduce((s, c) => s + (perCollection[c][a.id] || 0), 0);
    const totalB = collectionsToCount.reduce((s, c) => s + (perCollection[c][b.id] || 0), 0);
    return totalB - totalA;
  });
  for (const row of sortedRows) {
    const counts = collectionsToCount.map((c) => perCollection[c][row.id] || 0);
    for (let i = 0; i < collectionsToCount.length; i += 1) totals[collectionsToCount[i]] += counts[i];
    console.log([row.slug.padEnd(28), ...counts.map((n) => String(n).padStart(14))].join(' | '));
  }
  console.log('-'.repeat(header.length));
  console.log(['TOTAL'.padEnd(28), ...collectionsToCount.map((c) => String(totals[c]).padStart(14))].join(' | '));

  await client.close();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
