#!/usr/bin/env node
/**
 * Queue books for Lambda OCR processing (realtime API, no batch quota limits).
 *
 * Sends pages to SQS via the queue-books API. Lambda workers process them
 * in parallel (10 concurrent). Uses standard Gemini API rate limits, not
 * the batch API daily quota.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/queue-lambda-ocr.mjs
 *   node scripts/queue-lambda-ocr.mjs --dry-run
 *   node scripts/queue-lambda-ocr.mjs --limit 50
 *   node scripts/queue-lambda-ocr.mjs --book-id 69804b9312c17a1925ecb6e8
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const CRON_SECRET = process.env.CRON_SECRET;
const BASE_URL = process.env.NEXT_PUBLIC_URL || 'https://sourcelibrary.org';

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!CRON_SECRET) { console.error('CRON_SECRET not set'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limIdx = args.indexOf('--limit');
const LIMIT = limIdx >= 0 ? parseInt(args[limIdx + 1], 10) : 100;
const bookIdIdx = args.indexOf('--book-id');
const BOOK_ID = bookIdIdx >= 0 ? args[bookIdIdx + 1] : null;

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${CRON_SECRET}`,
};

async function queueBook(db, book) {
  const bookId = book.id;

  // Get pages needing OCR
  const pages = await db.collection('pages')
    .find({
      book_id: bookId,
      $or: [
        { 'ocr.data': { $exists: false } },
        { 'ocr.data': null },
        { 'ocr.data': '' },
      ],
    })
    .project({ id: 1 })
    .toArray();

  if (pages.length === 0) {
    return { bookId, status: 'no_pages', title: book.title };
  }

  const pageIds = pages.map(p => p.id);

  if (DRY_RUN) {
    return { bookId, status: 'would_queue', pages: pageIds.length, title: book.title };
  }

  try {
    // Clear any stale job reference
    const existingJob = book.job?.job_id;
    if (existingJob) {
      const activeJob = await db.collection('jobs').findOne({
        id: existingJob,
        status: { $nin: ['completed', 'failed', 'cancelled', 'partial', 'completed_with_errors'] },
      });
      if (activeJob) {
        return { bookId, status: 'active_job', jobId: existingJob, title: book.title };
      }
      // Clear stale job reference
      await db.collection('books').updateOne({ id: bookId }, { $unset: { job: '' } });
    }

    const res = await fetch(`${BASE_URL}/api/jobs/queue-books`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ bookId, pageIds, action: 'ocr' }),
      signal: AbortSignal.timeout(60000),
    });

    const data = await res.json();

    if (!res.ok) {
      return { bookId, status: 'error', error: data.error, title: book.title };
    }

    // Update pipeline status
    await db.collection('books').updateOne(
      { id: bookId },
      { $set: {
        'pipeline_auto.status': 'ocr_submitted',
        'pipeline_auto.last_updated': new Date(),
      }}
    );

    return { bookId, status: 'queued', pages: pageIds.length, jobId: data.jobId, title: book.title };
  } catch (err) {
    return { bookId, status: 'error', error: err.message, title: book.title };
  }
}

async function run() {
  const start = Date.now();
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  let books;
  if (BOOK_ID) {
    books = await db.collection('books')
      .find({ id: BOOK_ID })
      .project({ id: 1, title: 1, pages_count: 1, pages_ocr: 1, read_count: 1, job: 1 })
      .toArray();
  } else {
    books = await db.collection('books')
      .find({ 'pipeline_auto.status': 'archive_complete', hidden: { $ne: true } })
      .sort({ read_count: -1 })
      .project({ id: 1, title: 1, pages_count: 1, pages_ocr: 1, read_count: 1, job: 1 })
      .limit(LIMIT)
      .toArray();
  }

  console.log(`[queue-lambda-ocr] Found ${books.length} books | Limit: ${LIMIT} | Dry run: ${DRY_RUN}`);

  let queued = 0, errors = 0, noPages = 0, activeJobs = 0, totalPages = 0;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const result = await queueBook(db, book);

    if (result.status === 'queued' || result.status === 'would_queue') {
      queued++;
      totalPages += result.pages || 0;
      console.log(`  [${i + 1}/${books.length}] ${result.title?.substring(0, 50)} -> ${result.pages} pages ${DRY_RUN ? '(dry)' : result.jobId}`);
    } else if (result.status === 'no_pages') {
      noPages++;
    } else if (result.status === 'active_job') {
      activeJobs++;
      console.log(`  [${i + 1}/${books.length}] ${result.title?.substring(0, 50)} -> SKIP (active job)`);
    } else {
      errors++;
      console.log(`  [${i + 1}/${books.length}] ${result.title?.substring(0, 50)} -> ERROR: ${result.error}`);
    }

    // Small delay to avoid overwhelming the API
    if (!DRY_RUN) await new Promise(r => setTimeout(r, 200));
  }

  const duration = Date.now() - start;
  console.log(`\n=== COMPLETE (${(duration / 1000).toFixed(0)}s) ===`);
  console.log(`Queued: ${queued} books (${totalPages} pages) | No OCR needed: ${noPages} | Active jobs: ${activeJobs} | Errors: ${errors}`);

  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
