#!/usr/bin/env node
/**
 * Fast version of queue-lambda-ocr — processes books in parallel batches.
 * 5x-10x faster than the sequential version.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/queue-lambda-ocr-fast.mjs --limit 2000
 *   node scripts/queue-lambda-ocr-fast.mjs --limit 2000 --concurrency 10
 *   node scripts/queue-lambda-ocr-fast.mjs --dry-run --limit 100
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
const concIdx = args.indexOf('--concurrency');
const CONCURRENCY = concIdx >= 0 ? parseInt(args[concIdx + 1], 10) : 5;

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${CRON_SECRET}`,
};

async function queueBook(db, book, idx, total) {
  const bookId = book.id;

  // Check for active job first
  const existingJob = book.job?.job_id;
  if (existingJob) {
    const activeJob = await db.collection('jobs').findOne({
      id: existingJob,
      status: { $nin: ['completed', 'failed', 'cancelled', 'partial', 'completed_with_errors'] },
    });
    if (activeJob) {
      return { bookId, status: 'active_job', title: book.title };
    }
    await db.collection('books').updateOne({ id: bookId }, { $unset: { job: '' } });
  }

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
    const res = await fetch(`${BASE_URL}/api/jobs/queue-books`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ bookId, pageIds, action: 'ocr' }),
      signal: AbortSignal.timeout(180000),
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
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 20, serverSelectionTimeoutMS: 30000 });
  await client.connect();
  const db = client.db('bookstore');

  const books = await db.collection('books')
    .find({ 'pipeline_auto.status': 'archive_complete', hidden: { $ne: true } })
    .sort({ read_count: -1 })
    .project({ id: 1, title: 1, pages_count: 1, pages_ocr: 1, read_count: 1, job: 1 })
    .limit(LIMIT)
    .toArray();

  console.log(`[queue-lambda-ocr-fast] Found ${books.length} books | Limit: ${LIMIT} | Concurrency: ${CONCURRENCY} | Dry run: ${DRY_RUN}`);

  let queued = 0, errors = 0, noPages = 0, activeJobs = 0, totalPages = 0;
  let processed = 0;

  // Process in parallel batches
  for (let i = 0; i < books.length; i += CONCURRENCY) {
    const batch = books.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((book, j) => queueBook(db, book, i + j, books.length))
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      processed++;

      if (result.status === 'queued' || result.status === 'would_queue') {
        queued++;
        totalPages += result.pages || 0;
        console.log(`  [${processed}/${books.length}] ${result.title?.substring(0, 50)} -> ${result.pages} pages ${DRY_RUN ? '(dry)' : result.jobId || ''}`);
      } else if (result.status === 'no_pages') {
        noPages++;
      } else if (result.status === 'active_job') {
        activeJobs++;
      } else {
        errors++;
        console.log(`  [${processed}/${books.length}] ${result.title?.substring(0, 50)} -> ERROR: ${result.error}`);
      }
    }

    // Progress report every 50 books
    if (processed % 50 === 0 || processed === books.length) {
      const elapsed = (Date.now() - start) / 1000;
      const rate = processed / elapsed;
      const eta = (books.length - processed) / rate;
      console.log(`  --- Progress: ${processed}/${books.length} (${queued} queued, ${totalPages} pages) | ${elapsed.toFixed(0)}s elapsed, ~${eta.toFixed(0)}s remaining ---`);
    }
  }

  const duration = Date.now() - start;
  console.log(`\n=== COMPLETE (${(duration / 1000).toFixed(0)}s) ===`);
  console.log(`Queued: ${queued} books (${totalPages} pages) | No OCR needed: ${noPages} | Active jobs: ${activeJobs} | Errors: ${errors}`);

  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
