#!/usr/bin/env node
/**
 * Find pages from the H13 outage batch (Feb 19 ~13:00 UTC) where
 * Gemini OCR succeeded but MongoDB save failed.
 *
 * Strategy: Find failed jobs from H13, get their failed_page_ids,
 * then check which of those pages still lack ocr.data.
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }

const client = new MongoClient(uri, { maxPoolSize: 1 });
const timeout = setTimeout(() => { console.error('Script timeout (60s)'); client.close(); process.exit(1); }, 60000);

try {
  await client.connect();
  const db = client.db('bookstore');

  // H13 window: Feb 19, 12:00-15:00 UTC
  const h13Start = new Date('2026-02-19T12:00:00Z');
  const h13End = new Date('2026-02-19T15:00:00Z');

  // Find OCR jobs from H13 that had failures
  const failedJobs = await db.collection('jobs').find({
    type: 'ocr',
    created_at: { $gte: h13Start, $lte: h13End },
    'progress.failed': { $gt: 0 },
  }).project({ id: 1, book_id: 1, book_title: 1, failed_page_ids: 1, 'progress.total': 1, 'progress.completed': 1, 'progress.failed': 1, status: 1 }).toArray();

  console.log(`H13 OCR jobs with failures: ${failedJobs.length}`);

  const totalFailed = failedJobs.reduce((s, j) => s + (j.progress?.failed || 0), 0);
  const totalCompleted = failedJobs.reduce((s, j) => s + (j.progress?.completed || 0), 0);
  console.log(`Total failed pages (from progress): ${totalFailed}`);
  console.log(`Total completed pages: ${totalCompleted}`);

  // Collect all failed page IDs
  const allFailedPageIds = [];
  const bookMap = {};
  for (const job of failedJobs) {
    const fpids = job.failed_page_ids || [];
    allFailedPageIds.push(...fpids);
    if (!bookMap[job.book_id]) bookMap[job.book_id] = { title: job.book_title, failedPages: 0 };
    bookMap[job.book_id].failedPages += fpids.length;
  }

  console.log(`\nUnique failed page IDs collected: ${new Set(allFailedPageIds).size}`);
  console.log(`Books affected: ${Object.keys(bookMap).length}`);

  if (allFailedPageIds.length === 0) {
    console.log('\nNo failed_page_ids recorded. Checking if jobs track failures differently...');
    // Maybe jobs don't have failed_page_ids — check a sample
    const sample = failedJobs.slice(0, 3);
    for (const j of sample) {
      console.log(`  Job ${j.id}: status=${j.status}, progress=${JSON.stringify(j.progress)}, failed_page_ids=${(j.failed_page_ids||[]).length}`);
    }
  }

  // Check which of those pages still lack OCR
  const uniqueFailedIds = [...new Set(allFailedPageIds)];
  if (uniqueFailedIds.length > 0) {
    const pagesStillMissingOcr = await db.collection('pages').countDocuments({
      id: { $in: uniqueFailedIds },
      $or: [
        { 'ocr.data': { $exists: false } },
        { 'ocr.data': null },
        { 'ocr.data': '' }
      ]
    });

    const pagesWithOcr = await db.collection('pages').countDocuments({
      id: { $in: uniqueFailedIds },
      'ocr.data': { $exists: true, $ne: null, $ne: '' }
    });

    console.log(`\nOf ${uniqueFailedIds.length} failed pages:`);
    console.log(`  Still missing OCR: ${pagesStillMissingOcr}`);
    console.log(`  Already have OCR (re-processed): ${pagesWithOcr}`);
    console.log(`  Unaccounted: ${uniqueFailedIds.length - pagesStillMissingOcr - pagesWithOcr}`);
  }

  // Alternative approach: check gemini_usage for success records without matching page data
  console.log('\n--- Cross-referencing gemini_usage ---');
  const successLogs = await db.collection('gemini_usage').countDocuments({
    type: 'ocr',
    status: 'success',
    timestamp: { $gte: h13Start, $lte: h13End },
  });
  const failLogs = await db.collection('gemini_usage').countDocuments({
    type: 'ocr',
    status: 'failed',
    timestamp: { $gte: h13Start, $lte: h13End },
  });
  console.log(`gemini_usage H13 OCR: ${successLogs} success, ${failLogs} failed`);

  // Now check: for each H13 book, how many pages currently lack OCR?
  console.log('\n--- Books from H13 still needing OCR ---');
  const h13BookIds = Object.keys(bookMap);
  if (h13BookIds.length > 0) {
    const booksNeedingOcr = [];
    // Batch query: get books and their page counts
    const books = await db.collection('books').find({ id: { $in: h13BookIds } })
      .project({ id: 1, title: 1, pages_count: 1, pages_ocr: 1 })
      .toArray();

    for (const book of books) {
      const totalPages = await db.collection('pages').countDocuments({ book_id: book.id });
      const pagesWithOcr = await db.collection('pages').countDocuments({
        book_id: book.id,
        'ocr.data': { $exists: true, $ne: null, $ne: '' }
      });
      const missing = totalPages - pagesWithOcr;
      if (missing > 0) {
        booksNeedingOcr.push({ id: book.id, title: book.title, total: totalPages, ocr: pagesWithOcr, missing });
      }
    }

    booksNeedingOcr.sort((a, b) => b.missing - a.missing);
    console.log(`Books still needing OCR: ${booksNeedingOcr.length} / ${books.length}`);
    console.log(`Total pages missing OCR: ${booksNeedingOcr.reduce((s, b) => s + b.missing, 0)}`);

    // Show top 20
    console.log('\nTop books by missing pages:');
    for (const b of booksNeedingOcr.slice(0, 20)) {
      console.log(`  ${b.id} | ${b.title?.substring(0, 50)} | ${b.ocr}/${b.total} OCR'd | ${b.missing} missing`);
    }
  }

} finally {
  clearTimeout(timeout);
  await client.close();
}
