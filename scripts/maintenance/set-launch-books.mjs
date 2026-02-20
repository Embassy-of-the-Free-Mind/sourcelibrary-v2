#!/usr/bin/env node

/**
 * set-launch-books.mjs
 *
 * Composes the launch set of exactly 1,234 visible books.
 * Priority: EFM books first, then top non-EFM by read_count.
 *
 * Usage:
 *   node scripts/maintenance/set-launch-books.mjs              # dry run
 *   node scripts/maintenance/set-launch-books.mjs --apply      # execute
 *   node scripts/maintenance/set-launch-books.mjs --status     # show current counts
 */

import { MongoClient } from 'mongodb';

const TARGET_VISIBLE = 1234;

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Source .env.production.local first.');
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const statusOnly = process.argv.includes('--status');

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Current state
  const totalBooks = await books.countDocuments();
  const hiddenBooks = await books.countDocuments({ hidden: true });
  const visibleBooks = totalBooks - hiddenBooks;
  const efmBooks = await books.countDocuments({
    'image_source.provider': { $in: ['efm', 'EFM', 'Embassy of the Free Mind'] },
    pages_count: { $gt: 0 },
  });

  console.log('=== Current State ===');
  console.log(`Total books: ${totalBooks}`);
  console.log(`Currently visible: ${visibleBooks}`);
  console.log(`Currently hidden: ${hiddenBooks}`);
  console.log(`EFM books (with pages): ${efmBooks}`);
  console.log(`Target visible: ${TARGET_VISIBLE}`);
  console.log();

  if (statusOnly) {
    // Show breakdown of hidden reasons
    const reasons = await books.aggregate([
      { $match: { hidden: true } },
      { $group: { _id: '$hidden_reason', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray();
    console.log('Hidden reasons:');
    for (const r of reasons) {
      console.log(`  ${r._id || '(no reason)'}: ${r.count}`);
    }
    await client.close();
    return;
  }

  // Step 1: Find books that should NOT be touched (already hidden for specific reasons)
  const preserveHidden = await books.countDocuments({
    hidden: true,
    hidden_reason: { $in: ['efm_duplicate', 'quality'] },
  });
  console.log(`Preserving ${preserveHidden} books hidden for specific reasons (efm_duplicate, quality)`);

  // Step 2: Identify EFM books with pages
  const efmBookIds = await books.find(
    {
      'image_source.provider': { $in: ['efm', 'EFM', 'Embassy of the Free Mind'] },
      pages_count: { $gt: 0 },
    },
    { projection: { id: 1 } }
  ).toArray();
  const efmIdSet = new Set(efmBookIds.map(b => b.id));

  console.log(`EFM books to show: ${efmIdSet.size}`);

  // Step 3: Find top non-EFM books by read_count
  const nonEfmNeeded = TARGET_VISIBLE - efmIdSet.size;
  let topNonEfmIds = [];

  if (nonEfmNeeded > 0) {
    const topNonEfm = await books.find(
      {
        id: { $nin: [...efmIdSet] },
        pages_count: { $gt: 0 },
        // Don't un-hide books that were hidden for specific reasons
        $or: [
          { hidden: { $ne: true } },
          { hidden_reason: 'launch_curation' },
          { hidden_reason: { $exists: false } },
        ],
      },
      { projection: { id: 1, read_count: 1 } }
    )
      .sort({ read_count: -1, pages_ocr: -1, created_at: -1 })
      .limit(nonEfmNeeded)
      .toArray();

    topNonEfmIds = topNonEfm.map(b => b.id);
    console.log(`Non-EFM books to show: ${topNonEfmIds.length} (of ${nonEfmNeeded} needed)`);
  } else {
    console.log(`EFM books alone exceed target (${efmIdSet.size} >= ${TARGET_VISIBLE})`);
    console.log('No non-EFM books will be shown.');
  }

  const showIds = new Set([...efmIdSet, ...topNonEfmIds]);
  const actualVisible = showIds.size;

  console.log();
  console.log('=== Plan ===');
  console.log(`Will show: ${actualVisible} books`);
  console.log(`  EFM: ${efmIdSet.size}`);
  console.log(`  Non-EFM: ${topNonEfmIds.length}`);
  console.log(`Will hide: ${totalBooks - actualVisible - preserveHidden} books (launch_curation)`);
  console.log(`Already hidden (preserved): ${preserveHidden} books`);

  if (!apply) {
    console.log();
    console.log('DRY RUN — no changes made. Use --apply to execute.');
    await client.close();
    return;
  }

  console.log();
  console.log('=== Applying ===');

  // Step 4: Hide all books that are NOT in the show set and NOT already hidden for specific reasons
  const hideResult = await books.updateMany(
    {
      id: { $nin: [...showIds] },
      $or: [
        { hidden: { $ne: true } },
        { hidden_reason: 'launch_curation' },
        { hidden_reason: { $exists: false } },
      ],
    },
    {
      $set: {
        hidden: true,
        hidden_reason: 'launch_curation',
      },
    }
  );
  console.log(`Hidden: ${hideResult.modifiedCount} books`);

  // Step 5: Un-hide books that should be visible
  const showResult = await books.updateMany(
    {
      id: { $in: [...showIds] },
      hidden: true,
      // Only un-hide books hidden for launch_curation, not for other reasons
      $or: [
        { hidden_reason: 'launch_curation' },
        { hidden_reason: { $exists: false } },
      ],
    },
    {
      $set: { hidden: false },
      $unset: { hidden_reason: '' },
    }
  );
  console.log(`Un-hidden: ${showResult.modifiedCount} books`);

  // Final count
  const finalVisible = await books.countDocuments({ hidden: { $ne: true } });
  const finalHidden = await books.countDocuments({ hidden: true });
  console.log();
  console.log('=== Final State ===');
  console.log(`Visible: ${finalVisible}`);
  console.log(`Hidden: ${finalHidden}`);
  console.log(`Total: ${finalVisible + finalHidden}`);

  if (finalVisible !== TARGET_VISIBLE) {
    console.log(`WARNING: Visible count (${finalVisible}) != target (${TARGET_VISIBLE})`);
  }

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
