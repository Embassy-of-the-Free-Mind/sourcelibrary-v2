#!/usr/bin/env node
/**
 * IIIF Discovery Status — show progress across all sources.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/iiif-discovery/status.mjs
 *   node scripts/iiif-discovery/status.mjs --source erara
 */

import { withMongo } from '../lib/mongo.mjs';
import { getProgress } from './lib/candidate-store.mjs';

const source = process.argv.find(a => a.startsWith('--source='))?.split('=')[1]
  || (process.argv.includes('--source') ? process.argv[process.argv.indexOf('--source') + 1] : null);

await withMongo(async (db) => {
  const progress = await getProgress(db, source);

  if (Object.keys(progress).length === 0) {
    console.log('No candidates found. Run a discovery script first.');
    return;
  }

  console.log('\n=== IIIF Discovery Progress ===\n');

  let grandTotal = 0;
  let grandImported = 0;

  for (const [src, stats] of Object.entries(progress)) {
    const { total, discovered = 0, queued = 0, importing = 0, imported = 0, skipped = 0, failed = 0 } = stats;
    grandTotal += total;
    grandImported += imported;

    const pct = total > 0 ? ((imported / total) * 100).toFixed(1) : '0.0';
    console.log(`${src}:`);
    console.log(`  Total: ${total.toLocaleString()}`);
    console.log(`  Discovered: ${discovered.toLocaleString()} | Queued: ${queued.toLocaleString()} | Importing: ${importing.toLocaleString()}`);
    console.log(`  Imported: ${imported.toLocaleString()} (${pct}%) | Skipped: ${skipped.toLocaleString()} | Failed: ${failed.toLocaleString()}`);
    console.log('');
  }

  if (Object.keys(progress).length > 1) {
    const pct = grandTotal > 0 ? ((grandImported / grandTotal) * 100).toFixed(1) : '0.0';
    console.log(`--- Grand Total: ${grandTotal.toLocaleString()} candidates, ${grandImported.toLocaleString()} imported (${pct}%) ---`);
  }

  // Also show current books collection size
  const booksCount = await db.collection('books').countDocuments({ hidden: { $ne: true } });
  console.log(`\nBooks collection: ${booksCount.toLocaleString()} books`);
  console.log(`Target: 100,000 books (${((booksCount / 100000) * 100).toFixed(1)}%)`);
});
