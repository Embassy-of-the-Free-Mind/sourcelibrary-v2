#!/usr/bin/env node
/**
 * Find and fix the 5 H13 books that are past OCR phase but still missing pages.
 * Submits batch OCR for just the missing pages.
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }

const client = new MongoClient(uri, { maxPoolSize: 1 });
const timeout = setTimeout(() => { console.error('Script timeout (60s)'); client.close(); process.exit(1); }, 60000);

const DRY_RUN = !process.argv.includes('--execute');

try {
  await client.connect();
  const db = client.db('bookstore');

  // Books at later pipeline stages that still need OCR
  const laterStages = ['ocr_complete', 'metadata_enriched', 'translate_submitted', 'translate_complete', 'enriching', 'enriched', 'chapters', 'chapters_complete', 'images_submitted', 'images_complete', 'complete'];

  const h13Start = new Date('2026-02-19T12:00:00Z');
  const h13End = new Date('2026-02-19T15:00:00Z');

  const failedJobs = await db.collection('jobs').find({
    type: 'ocr',
    created_at: { $gte: h13Start, $lte: h13End },
    'progress.failed': { $gt: 0 },
  }).project({ book_id: 1 }).toArray();

  const h13BookIds = [...new Set(failedJobs.map(j => j.book_id))];

  const books = await db.collection('books').find({
    id: { $in: h13BookIds },
    'pipeline_auto.status': { $in: laterStages }
  }).project({ id: 1, title: 1, 'pipeline_auto.status': 1, language: 1 }).toArray();

  console.log(`Books past OCR phase but potentially missing pages: ${books.length}`);

  let totalMissing = 0;
  for (const book of books) {
    // Find pages missing OCR
    const missingPages = await db.collection('pages').find({
      book_id: book.id,
      $or: [
        { 'ocr.data': { $exists: false } },
        { 'ocr.data': null },
        { 'ocr.data': '' }
      ]
    }).project({ id: 1, page_number: 1 }).toArray();

    if (missingPages.length === 0) {
      console.log(`  ${book.id} | ${book.pipeline_auto?.status} | ${book.title?.substring(0, 50)} | OK (no missing pages)`);
      continue;
    }

    totalMissing += missingPages.length;
    const pageNums = missingPages.map(p => p.page_number).sort((a, b) => a - b);
    console.log(`  ${book.id} | ${book.pipeline_auto?.status} | ${book.title?.substring(0, 50)} | ${missingPages.length} missing (pages: ${pageNums.slice(0, 10).join(',')}${pageNums.length > 10 ? '...' : ''})`);

    if (!DRY_RUN) {
      // Reset pipeline to archive_complete so cron picks it up for OCR
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { 'pipeline_auto.status': 'archive_complete', 'pipeline_auto.retry_count': 0, updated_at: new Date() } }
      );
      console.log(`    -> Reset to archive_complete`);
    }
  }

  console.log(`\nTotal missing pages across later-stage books: ${totalMissing}`);
  if (DRY_RUN) console.log('(dry run — add --execute to reset pipeline status)');

} finally {
  clearTimeout(timeout);
  await client.close();
}
