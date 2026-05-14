#!/usr/bin/env node
/**
 * Force-restore any page with page_number < 0 to its absolute value,
 * EXCEPT pages with page_type = 'archived-spread' (those are legitimately
 * hidden by the spread-splitter — keep them hidden).
 *
 * Scoped to BPH books (image_source.provider='bph') and the list of
 * snapshot book_ids in .claude/docs/snapshots/dedup-*.json so we only
 * touch books this session deduped.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/force-restore-hidden-pages.mjs --dry-run
 *   node scripts/force-restore-hidden-pages.mjs --apply
 */

import { MongoClient } from 'mongodb';
import { readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

// Union of dedup-XXX, dedup-pagenum-XXX, and dedup-content-XXX book ids
const ALL = readdirSync(resolve(REPO_ROOT, '.claude/docs/snapshots'));
const fromPrefix = (prefix) => ALL.filter(f => f.startsWith(prefix) && f.endsWith('.json'))
  .map(f => f.replace(prefix, '').replace(/\.json$/, ''));
const snapshotIds = Array.from(new Set([
  ...fromPrefix('dedup-pagenum-'),
  ...fromPrefix('dedup-content-'),
  ...fromPrefix('dedup-reviewed-'),
  ...fromPrefix('dedup-').filter(id => !id.startsWith('pagenum-') && !id.startsWith('content-') && !id.startsWith('reviewed-')),
]));

console.log(`Scope: ${snapshotIds.length} books with dedup snapshots`);

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');

let totalFixed = 0;
let bookCount = 0;
for (const bid of snapshotIds) {
  const negPages = await db.collection('pages').find(
    { book_id: bid, page_number: { $lt: 0 }, page_type: { $ne: 'archived-spread' } },
    { projection: { _id: 1, page_number: 1, page_type: 1 } }
  ).toArray();

  if (negPages.length === 0) {
    bookCount++;
    continue;
  }

  if (!APPLY) {
    console.log(`${bid}: would restore ${negPages.length} pages`);
    totalFixed += negPages.length;
    bookCount++;
    continue;
  }

  for (const p of negPages) {
    await db.collection('pages').updateOne(
      { _id: p._id },
      {
        $set: { page_number: Math.abs(p.page_number), updated_at: new Date() },
        $unset: { is_duplicate: '', duplicate_of: '', original_page_number: '', dedup_source: '', dedup_method: '' },
      }
    );
    totalFixed++;
  }
  // Update pages_count
  const visible = await db.collection('pages').countDocuments({ book_id: bid, page_number: { $gt: 0 } });
  await db.collection('books').updateOne({ id: bid }, { $set: { pages_count: visible, updated_at: new Date() } });
  bookCount++;
  if (bookCount % 25 === 0) console.log(`  ${bookCount}/${snapshotIds.length}, ${totalFixed} pages restored`);
}

console.log(`\nDone: scanned ${bookCount} books, ${APPLY ? 'restored' : 'would restore'} ${totalFixed} hidden pages.`);
await c.close();
