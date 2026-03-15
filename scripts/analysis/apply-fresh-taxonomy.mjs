#!/usr/bin/env node
/**
 * Apply fresh taxonomy to MongoDB — replaces ALL existing taxonomy with
 * new clustering results from complete-taxonomy.json.
 *
 * Steps:
 * 1. Clear taxonomy from ALL books
 * 2. Write new taxonomy for 5,993 books
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/analysis/apply-fresh-taxonomy.mjs [--dry-run]
 */

import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', 'output');

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const taxonomyPath = join(OUTPUT_DIR, 'complete-taxonomy.json');
  let data;
  try {
    data = JSON.parse(readFileSync(taxonomyPath, 'utf-8'));
  } catch (e) {
    console.error(`Missing ${taxonomyPath}`);
    console.error('Run: python3 scripts/analysis/finalize-taxonomy.py');
    process.exit(1);
  }

  console.log(`Loaded: ${data.total_books} assignments across ${data.n_clusters} clusters`);
  console.log(`Method: ${data.method}\n`);

  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Step 1: Count existing taxonomy
  const existingCount = await books.countDocuments({ taxonomy: { $exists: true } });
  console.log(`Existing books with taxonomy: ${existingCount}`);

  if (dryRun) {
    // Show sample assignments
    console.log('\nSample assignments:');
    const byCluster = {};
    for (const a of data.assignments) {
      const name = a.cluster_name;
      if (!byCluster[name]) byCluster[name] = [];
      byCluster[name].push(a);
    }
    const sorted = Object.entries(byCluster).sort((a, b) => b[1].length - a[1].length);
    for (const [name, books] of sorted.slice(0, 10)) {
      console.log(`  ${name}: ${books.length} books`);
    }
    console.log(`  ... ${sorted.length} total clusters`);
    console.log('\n[DRY RUN] No changes written.');
    await client.close();
    return;
  }

  // Step 2: Clear ALL existing taxonomy
  console.log('\nClearing all existing taxonomy...');
  const clearResult = await books.updateMany(
    { taxonomy: { $exists: true } },
    { $unset: { taxonomy: '' } }
  );
  console.log(`  Cleared taxonomy from ${clearResult.modifiedCount} books`);

  // Step 3: Write new taxonomy
  console.log(`\nWriting new taxonomy for ${data.assignments.length} books...`);
  const bulkOps = [];
  for (const a of data.assignments) {
    const taxonomy = {
      cluster: a.cluster_name,
      cluster_id: a.cluster,
      probability: a.probability,
    };
    if (a.method) {
      taxonomy.method = a.method;
    }
    bulkOps.push({
      updateOne: {
        filter: { id: a.id },
        update: { $set: { taxonomy } },
      },
    });
  }

  // Write in batches
  const BATCH = 500;
  let updated = 0;
  for (let i = 0; i < bulkOps.length; i += BATCH) {
    const batch = bulkOps.slice(i, i + BATCH);
    const result = await books.bulkWrite(batch);
    updated += result.modifiedCount;
    process.stdout.write(`  Written: ${Math.min(i + BATCH, bulkOps.length)}/${bulkOps.length}\r`);
  }
  console.log(`\nUpdated ${updated} books with fresh taxonomy.`);

  // Step 4: Verify
  const totalWithTax = await books.countDocuments({ taxonomy: { $exists: true }, hidden: { $ne: true } });
  const hdbscan = await books.countDocuments({ 'taxonomy.method': { $exists: false }, taxonomy: { $exists: true }, hidden: { $ne: true } });
  const nearest = await books.countDocuments({ 'taxonomy.method': 'nearest-centroid', hidden: { $ne: true } });
  const clusters = await books.aggregate([
    { $match: { taxonomy: { $exists: true }, hidden: { $ne: true } } },
    { $group: { _id: '$taxonomy.cluster' } },
    { $count: 'n' },
  ]).toArray();

  console.log(`\nTaxonomy coverage:`);
  console.log(`  HDBSCAN (core): ${hdbscan}`);
  console.log(`  Nearest-centroid (noise): ${nearest}`);
  console.log(`  Total: ${totalWithTax}`);
  console.log(`  Distinct clusters: ${clusters[0]?.n || 0}`);

  await client.close();
  console.log('Done.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
