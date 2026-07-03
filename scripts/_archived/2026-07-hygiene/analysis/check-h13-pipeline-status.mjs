#!/usr/bin/env node
/**
 * Check pipeline status of the 35 H13 books still needing OCR.
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }

const client = new MongoClient(uri, { maxPoolSize: 1 });
const timeout = setTimeout(() => { console.error('Script timeout (60s)'); client.close(); process.exit(1); }, 60000);

try {
  await client.connect();
  const db = client.db('bookstore');

  // H13 window
  const h13Start = new Date('2026-02-19T12:00:00Z');
  const h13End = new Date('2026-02-19T15:00:00Z');

  // Get books from H13 jobs that still have pages missing OCR
  const failedJobs = await db.collection('jobs').find({
    type: 'ocr',
    created_at: { $gte: h13Start, $lte: h13End },
    'progress.failed': { $gt: 0 },
  }).project({ book_id: 1 }).toArray();

  const h13BookIds = [...new Set(failedJobs.map(j => j.book_id))];

  const booksNeedingOcr = [];
  for (const bookId of h13BookIds) {
    const totalPages = await db.collection('pages').countDocuments({ book_id: bookId });
    const pagesWithOcr = await db.collection('pages').countDocuments({
      book_id: bookId,
      'ocr.data': { $exists: true, $ne: null, $ne: '' }
    });
    if (totalPages - pagesWithOcr > 0) {
      booksNeedingOcr.push(bookId);
    }
  }

  // Get pipeline status for these books
  const books = await db.collection('books').find({ id: { $in: booksNeedingOcr } })
    .project({ id: 1, title: 1, 'pipeline_auto.status': 1, language: 1, provider: 1 })
    .toArray();

  const statusCounts = {};
  for (const book of books) {
    const status = book.pipeline_auto?.status || 'not_enrolled';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  console.log('Pipeline status of 35 books needing OCR:');
  for (const [status, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${count}`);
  }

  // List book IDs that are NOT in the pipeline or stuck
  console.log('\nBooks not actively processing:');
  const needsAction = books.filter(b => {
    const s = b.pipeline_auto?.status;
    return !s || s === 'failed' || s === 'needs_attention' || s === 'complete' || s === 'archive_complete';
  });

  for (const b of needsAction) {
    console.log(`  ${b.id} | ${b.pipeline_auto?.status || 'not_enrolled'} | ${b.title?.substring(0, 60)}`);
  }

  // Print all book IDs for easy re-enrollment
  console.log(`\nAll ${booksNeedingOcr.length} book IDs needing OCR:`);
  console.log(JSON.stringify(booksNeedingOcr));

} finally {
  clearTimeout(timeout);
  await client.close();
}
