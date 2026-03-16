#!/usr/bin/env node
/**
 * Queue OCR jobs directly via SQS + MongoDB (bypasses Vercel API).
 * Optimized: single aggregation to find all pages needing OCR, grouped by book.
 *
 * Usage:
 *   set -a; source .env.local; source .env.production.local; set +a
 *   node scripts/queue-ocr-direct.mjs --limit 600
 *   node scripts/queue-ocr-direct.mjs --dry-run --limit 10
 */

import { MongoClient } from 'mongodb';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { randomBytes } from 'crypto';

const MONGODB_URI = process.env.MONGODB_URI;
const SQS_QUEUE_URL = process.env.SQS_PAGE_OCR_QUEUE_URL;
const AWS_REGION = process.env.AWS_REGION || 'eu-central-1';

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!SQS_QUEUE_URL) { console.error('SQS_PAGE_OCR_QUEUE_URL not set'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limIdx = args.indexOf('--limit');
const LIMIT = limIdx >= 0 ? parseInt(args[limIdx + 1], 10) : 100;

const sqs = new SQSClient({ region: AWS_REGION });

function nanoid(size = 12) {
  return randomBytes(size).toString('base64url').slice(0, size);
}

async function sendSqsBatch(messages) {
  let successful = 0, failed = 0;
  for (let i = 0; i < messages.length; i += 10) {
    const chunk = messages.slice(i, i + 10);
    const entries = chunk.map((msg, idx) => ({
      Id: `msg-${idx}`,
      MessageBody: JSON.stringify(msg),
    }));
    try {
      const result = await sqs.send(new SendMessageBatchCommand({
        QueueUrl: SQS_QUEUE_URL,
        Entries: entries,
      }));
      successful += (result.Successful || []).length;
      failed += (result.Failed || []).length;
    } catch (err) {
      console.error(`    SQS batch error: ${err.message}`);
      failed += chunk.length;
    }
  }
  return { successful, failed };
}

async function run() {
  const start = Date.now();
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 10, serverSelectionTimeoutMS: 30000 });
  await client.connect();
  const db = client.db('bookstore');

  // Step 1: Get archive_complete books
  console.log('Fetching archive_complete books...');
  const books = await db.collection('books')
    .find({ 'pipeline_auto.status': 'archive_complete', hidden: { $ne: true } })
    .sort({ read_count: -1 })
    .project({ id: 1, title: 1, pages_count: 1, job: 1 })
    .limit(LIMIT)
    .toArray();

  console.log(`Found ${books.length} archive_complete books (${((Date.now() - start)/1000).toFixed(1)}s)`);

  // Filter out books with active jobs
  const booksToProcess = [];
  const activeJobIds = new Set();
  for (const book of books) {
    if (book.job?.job_id) {
      const activeJob = await db.collection('jobs').findOne({
        id: book.job.job_id,
        status: { $nin: ['completed', 'failed', 'cancelled', 'partial', 'completed_with_errors'] },
      });
      if (activeJob) {
        activeJobIds.add(book.id);
        continue;
      }
    }
    booksToProcess.push(book);
  }
  console.log(`${booksToProcess.length} books to process (${activeJobIds.size} have active jobs) (${((Date.now() - start)/1000).toFixed(1)}s)`);

  // Step 2: Single aggregation to get all pages needing OCR for these books
  const bookIds = booksToProcess.map(b => b.id);
  console.log('Fetching pages needing OCR (single aggregation)...');
  const pagesByBook = await db.collection('pages').aggregate([
    {
      $match: {
        book_id: { $in: bookIds },
        $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }],
      }
    },
    {
      $group: {
        _id: '$book_id',
        pageIds: { $push: '$id' },
        count: { $sum: 1 },
      }
    }
  ], { allowDiskUse: true }).toArray();

  const pageMap = new Map(pagesByBook.map(g => [g._id, g.pageIds]));
  console.log(`Found ${pagesByBook.reduce((s, g) => s + g.count, 0)} pages across ${pagesByBook.length} books needing OCR (${((Date.now() - start)/1000).toFixed(1)}s)`);

  // Step 3: Queue each book
  let queued = 0, noPages = 0, totalPages = 0, totalSqsSent = 0, errors = 0;

  for (let i = 0; i < booksToProcess.length; i++) {
    const book = booksToProcess[i];
    const pageIds = pageMap.get(book.id);

    if (!pageIds || pageIds.length === 0) {
      noPages++;
      continue;
    }

    if (DRY_RUN) {
      queued++;
      totalPages += pageIds.length;
      console.log(`  [${i + 1}/${booksToProcess.length}] ${book.title?.substring(0, 55)} -> ${pageIds.length} pages (dry)`);
      continue;
    }

    // Create job record
    const jobId = nanoid();
    try {
      await db.collection('jobs').insertOne({
        id: jobId,
        type: 'ocr',
        status: 'processing',
        book_id: book.id,
        book_title: book.title,
        progress: { total: pageIds.length, completed: 0, failed: 0 },
        config: { page_ids: pageIds },
        failed_page_ids: [],
        created_at: new Date(),
        updated_at: new Date(),
        started_at: new Date(),
      });

      // Update book
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: {
          job: { type: 'realtime', job_id: jobId },
          'pipeline_auto.status': 'ocr_submitted',
          'pipeline_auto.last_updated': new Date(),
        }}
      );

      // Send SQS messages
      const sqsMessages = pageIds.map(pageId => ({ bookId: book.id, pageId, jobId }));
      const sqsResult = await sendSqsBatch(sqsMessages);
      totalSqsSent += sqsResult.successful;

      if (sqsResult.failed > 0) {
        console.log(`  [${i + 1}/${booksToProcess.length}] ${book.title?.substring(0, 55)} -> ${pageIds.length} pages (${sqsResult.failed} SQS failed)`);
      }

      queued++;
      totalPages += pageIds.length;
    } catch (err) {
      errors++;
      console.error(`  [${i + 1}/${booksToProcess.length}] ERROR: ${book.title?.substring(0, 55)} -> ${err.message}`);
    }

    // Progress every 25 books
    if ((i + 1) % 25 === 0) {
      const elapsed = (Date.now() - start) / 1000;
      console.log(`  --- ${i + 1}/${booksToProcess.length} | ${queued} queued, ${totalPages} pages, ${totalSqsSent} SQS sent | ${elapsed.toFixed(0)}s ---`);
    }
  }

  const duration = (Date.now() - start) / 1000;
  console.log(`\n=== COMPLETE (${duration.toFixed(0)}s) ===`);
  console.log(`Queued: ${queued} books (${totalPages} pages, ${totalSqsSent} SQS messages)`);
  console.log(`No OCR needed: ${noPages} | Active jobs: ${activeJobIds.size} | Errors: ${errors}`);

  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
