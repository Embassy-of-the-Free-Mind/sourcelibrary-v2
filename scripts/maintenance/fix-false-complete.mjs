#!/usr/bin/env node
/**
 * Fix books falsely marked "complete" with 0 OCR pages.
 * - Empty shells (0 pages): mark as needs_attention
 * - Real pages but 0 OCR: reset to archive_complete for re-processing
 *
 * Usage:
 *   secret-lover run -- node scripts/fix-false-complete.mjs [--execute]
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }

const dryRun = !process.argv.includes('--execute');
if (dryRun) console.log('DRY RUN — pass --execute to apply changes\n');

const client = new MongoClient(uri, { maxPoolSize: 1 });
const timeout = setTimeout(() => { console.error('Timeout'); client.close(); process.exit(1); }, 120000);

try {
  await client.connect();
  const db = client.db('bookstore');

  // Find all "complete" books with cached pages_ocr = 0
  const falseComplete = await db.collection('books').find({
    'pipeline_auto.status': 'complete',
    $or: [{ pages_ocr: 0 }, { pages_ocr: { $exists: false } }]
  }).project({
    id: 1, title: 1, language: 1, pages_count: 1, pages_ocr: 1,
  }).toArray();

  console.log(`Found ${falseComplete.length} "complete" books with cached pages_ocr=0\n`);

  let emptyShells = 0;
  let realBooksReset = 0;

  for (const book of falseComplete) {
    // Check actual page count
    const totalPages = await db.collection('pages').countDocuments({ book_id: book.id });

    // Check if any page actually has OCR (in case cached count is stale)
    const anyOcr = await db.collection('pages').findOne({
      book_id: book.id,
      'ocr.data': { $exists: true, $ne: null, $ne: '' }
    }, { projection: { id: 1 } });

    if (anyOcr) {
      // Cached pages_ocr is wrong — book actually has OCR. Skip (sync-page-counts will fix)
      console.log(`SKIP ${book.id} | ${book.title?.substring(0, 50)} | has OCR, cached count stale`);
      continue;
    }

    if (totalPages === 0) {
      // Empty shell — failed import
      console.log(`EMPTY ${book.id} | ${book.title?.substring(0, 50)} | 0 pages → needs_attention`);
      if (!dryRun) {
        await db.collection('books').updateOne({ id: book.id }, {
          $set: {
            'pipeline_auto.status': 'needs_attention',
            'pipeline_auto.error': 'Empty book: 0 pages. Likely a failed import.',
            'pipeline_auto.last_updated': new Date(),
          }
        });
      }
      emptyShells++;
    } else {
      // Real pages but no OCR — reset to archive_complete
      console.log(`RESET ${book.id} | ${book.title?.substring(0, 50)} | ${totalPages} pages, 0 OCR → archive_complete`);
      if (!dryRun) {
        await db.collection('books').updateOne({ id: book.id }, {
          $set: {
            'pipeline_auto.status': 'archive_complete',
            'pipeline_auto.error': 'Reset from falsely-complete: had 0 OCR pages.',
            'pipeline_auto.retry_count': 0,
            'pipeline_auto.last_updated': new Date(),
          },
          $unset: {
            'pipeline_auto.completed_at': '',
          }
        });
      }
      realBooksReset++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Empty shells → needs_attention: ${emptyShells}`);
  console.log(`Real books → archive_complete: ${realBooksReset}`);
  console.log(`Skipped (stale cache): ${falseComplete.length - emptyShells - realBooksReset}`);
  if (dryRun) console.log('\nDRY RUN — pass --execute to apply changes');

} finally {
  clearTimeout(timeout);
  await client.close();
}
