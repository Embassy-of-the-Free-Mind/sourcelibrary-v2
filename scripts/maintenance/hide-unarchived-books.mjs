#!/usr/bin/env node
/**
 * Hide books that have no archived images.
 *
 * Books are hidden with `hidden_reason: 'unarchived'` so they can be
 * automatically un-hidden when archiving completes (see pipeline-orchestrator).
 *
 * A book is considered "unarchived" if:
 *   - It has pages (pages_count > 0)
 *   - None of its pages have `archived_photo` set (or all are `failed:...`)
 *   - It's not already hidden for another reason
 *
 * Usage:
 *   node scripts/maintenance/hide-unarchived-books.mjs              # dry run
 *   node scripts/maintenance/hide-unarchived-books.mjs --apply      # actually hide
 *   node scripts/maintenance/hide-unarchived-books.mjs --stats      # just show stats
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }

const DRY_RUN = !process.argv.includes('--apply');
const STATS_ONLY = process.argv.includes('--stats');

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');

  // Get all visible books with pages
  const visibleBooks = await db.collection('books').find(
    { hidden: { $ne: true }, pages_count: { $gt: 0 } },
    { projection: { id: 1, title: 1, pages_count: 1, thumbnail: 1, thumbnail_blob: 1 } }
  ).toArray();

  console.log(`Visible books with pages: ${visibleBooks.length}`);

  // Get set of book_ids that have at least one archived page (fast distinct query)
  console.log('Checking which books have archived pages...');
  const booksWithArchived = new Set(
    await db.collection('pages').distinct('book_id', {
      archived_photo: { $exists: true, $ne: null, $not: /^failed:/ }
    })
  );
  console.log(`Books with at least one archived page: ${booksWithArchived.size}`);

  // Build a map (we don't need exact counts, just archived vs not)
  const archivedMap = new Map();
  for (const bid of booksWithArchived) {
    archivedMap.set(bid, 1); // at least 1
  }

  // Categorize: zero archived pages vs has some
  const unarchived = [];
  let hasArchived = 0;

  for (const book of visibleBooks) {
    const bookId = book.id || book._id.toString();
    if (archivedMap.has(bookId)) {
      hasArchived++;
    } else {
      unarchived.push(book);
    }
  }

  console.log(`\nHas archived pages: ${hasArchived}`);
  console.log(`Zero archived pages: ${unarchived.length}`);

  // Also count books with no thumbnail at all
  const noThumb = unarchived.filter(b => !b.thumbnail && !b.thumbnail_blob);
  const hasExternalThumb = unarchived.filter(b => b.thumbnail || b.thumbnail_blob);
  console.log(`\nOf the ${unarchived.length} unarchived books:`);
  console.log(`  No thumbnail at all: ${noThumb.length}`);
  console.log(`  Have external thumbnail: ${hasExternalThumb.length}`);

  if (STATS_ONLY) {
    console.log('\nSample unarchived books:');
    unarchived.slice(0, 20).forEach(b =>
      console.log(`  - ${b.title?.slice(0, 70)} (${b.pages_count} pages)`)
    );
    await client.close();
    return;
  }

  // Hide unarchived books
  const toHide = unarchived;
  console.log(`\n${DRY_RUN ? '[DRY RUN] Would hide' : 'Hiding'} ${toHide.length} unarchived books`);

  if (!DRY_RUN) {
    const bookIds = toHide.map(b => b.id || b._id.toString());

    // Batch update
    const result = await db.collection('books').updateMany(
      { id: { $in: bookIds } },
      { $set: { hidden: true, hidden_reason: 'unarchived', updated_at: new Date() } }
    );
    console.log(`Updated: ${result.modifiedCount} books`);

    // Also enroll them in the pipeline if not already
    const enrolled = await db.collection('books').updateMany(
      {
        id: { $in: bookIds },
        'pipeline_auto.status': { $exists: false }
      },
      { $set: { 'pipeline_auto.status': 'queued', 'pipeline_auto.queued_at': new Date() } }
    );
    console.log(`Enrolled in pipeline: ${enrolled.modifiedCount} books`);
  } else {
    console.log('\nSample books that would be hidden:');
    toHide.slice(0, 30).forEach(b =>
      console.log(`  - ${b.title?.slice(0, 70)} (${b.pages_count} pages)`)
    );
    console.log(`\nRun with --apply to actually hide these books.`);
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
