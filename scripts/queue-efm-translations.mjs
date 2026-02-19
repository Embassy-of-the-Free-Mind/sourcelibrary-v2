#!/usr/bin/env node
/**
 * Queue EFM books for translation via Lambda FIFO workers.
 * Creates job records in MongoDB and sends SQS messages directly.
 *
 * Usage:
 *   set -a && source .env.local && set +a && node scripts/queue-efm-translations.mjs [options]
 *
 * Options:
 *   --limit=N     Max books to queue (default: 50)
 *   --dry-run     Show what would be queued
 *   --biggest     Sort by largest gap first (default: smallest first)
 *   --book-id=ID  Queue a single book
 */

import { MongoClient } from 'mongodb';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { nanoid } from 'nanoid';

// --- Config ---
const SKIP_PAGE_TYPES = ['blank', 'illustration', 'map', 'frontispiece', 'diagram'];
const DEFAULT_MODEL = 'gemini-3-flash-preview';

// --- Parse args ---
const args = process.argv.slice(2);
const getArg = (name) => {
  const a = args.find(a => a.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const LIMIT = parseInt(getArg('limit') || '50', 10);
const DRY_RUN = hasFlag('dry-run');
const BIGGEST_FIRST = hasFlag('biggest');
const SINGLE_BOOK = getArg('book-id');

// --- SQS setup ---
const sqsClient = new SQSClient({
  region: process.env.AWS_REGION || 'eu-central-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const TRANSLATION_QUEUE_URL = process.env.SQS_PAGE_TRANSLATION_QUEUE_URL;

async function sendBatch(messages, jobId) {
  for (let i = 0; i < messages.length; i += 10) {
    const batch = messages.slice(i, i + 10);
    const entries = batch.map((msg, idx) => ({
      Id: `msg-${idx}`,
      MessageBody: JSON.stringify(msg),
      MessageGroupId: jobId,
    }));

    const result = await sqsClient.send(new SendMessageBatchCommand({
      QueueUrl: TRANSLATION_QUEUE_URL,
      Entries: entries,
    }));

    if (result.Failed?.length) {
      console.error(`  SQS batch failures: ${result.Failed.length}`);
    }
  }
}

// --- Main ---
async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI not set');
  if (!TRANSLATION_QUEUE_URL) throw new Error('SQS_PAGE_TRANSLATION_QUEUE_URL not set');

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db('bookstore');

  console.log(`=== Queue EFM Books for Translation ===`);
  console.log(`  limit=${LIMIT}, sort=${BIGGEST_FIRST ? 'biggest' : 'smallest'} first`);
  if (DRY_RUN) console.log(`  DRY RUN`);
  console.log('');

  try {
    // Get EFM books
    const efmFilter = SINGLE_BOOK
      ? { id: SINGLE_BOOK }
      : {
          $or: [
            { 'image_source.provider': 'efm' },
            { 'image_source.provider_name': /ritman|embassy|free mind/i },
          ],
          pages_count: { $gt: 0 },
          pages_ocr: { $gt: 0 },
        };

    const efmBooks = await db.collection('books').find(efmFilter)
      .project({ id: 1, title: 1, language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, _id: 0 })
      .toArray();

    // Filter to books needing translation
    const candidates = efmBooks
      .filter(b => {
        const trans = b.pages_translated || 0;
        const pc = b.pages_count || 1;
        return trans / pc < 0.8;
      })
      .map(b => ({ ...b, gap: (b.pages_ocr || 0) - (b.pages_translated || 0) }))
      .filter(b => b.gap > 0);

    // Sort
    if (BIGGEST_FIRST) {
      candidates.sort((a, b) => b.gap - a.gap);
    } else {
      candidates.sort((a, b) => a.gap - b.gap);
    }

    console.log(`Candidates: ${candidates.length} books`);

    // Check for books with active translation jobs
    const activeJobs = await db.collection('jobs').find({
      type: 'translate',
      status: { $in: ['pending', 'processing'] }
    }).project({ book_id: 1, _id: 0 }).toArray();
    const activeBookIds = new Set(activeJobs.map(j => j.book_id));

    // Also check books with active job reference
    const booksWithJobs = await db.collection('books').find({
      id: { $in: candidates.map(c => c.id) },
      'job.job_id': { $exists: true }
    }).project({ id: 1, 'job.job_id': 1, _id: 0 }).toArray();

    for (const b of booksWithJobs) {
      const job = await db.collection('jobs').findOne({ id: b.job?.job_id });
      if (job && !['completed', 'failed', 'cancelled', 'completed_with_errors'].includes(job.status)) {
        activeBookIds.add(b.id);
      }
    }

    let queued = 0;
    let totalPages = 0;
    let skipped = 0;

    for (const book of candidates) {
      if (queued >= LIMIT) break;

      if (activeBookIds.has(book.id)) {
        console.log(`  SKIP (active job): ${book.title?.substring(0, 50)}`);
        skipped++;
        continue;
      }

      // Get untranslated pages with OCR
      const pages = await db.collection('pages').find({
        book_id: book.id,
        'ocr.data': { $exists: true, $ne: '' },
        page_type: { $nin: SKIP_PAGE_TYPES },
        $or: [
          { 'translation.data': { $exists: false } },
          { 'translation.data': null },
          { 'translation.data': '' },
        ],
      }).project({ id: 1, page_number: 1, _id: 0 }).sort({ page_number: 1 }).toArray();

      if (pages.length === 0) {
        continue;
      }

      const pageIds = pages.map(p => p.id);

      console.log(`  ${DRY_RUN ? 'WOULD QUEUE' : 'QUEUING'}: ${(book.language || '?').padEnd(14)} | ${(book.title || '').substring(0, 45).padEnd(45)} | ${pageIds.length} pages`);

      if (!DRY_RUN) {
        // Create job record
        const jobId = nanoid(12);
        await db.collection('jobs').insertOne({
          id: jobId,
          type: 'translate',
          book_id: book.id,
          book_title: book.title,
          status: 'pending',
          progress: { total: pageIds.length, completed: 0, failed: 0 },
          config: {
            page_ids: pageIds,
            model: DEFAULT_MODEL,
            language: book.language || 'auto-detect',
          },
          initiated_by: 'script',
          created_at: new Date(),
          updated_at: new Date(),
        });

        // Set active job on book
        await db.collection('books').updateOne(
          { id: book.id },
          { $set: { job: { type: 'realtime', job_id: jobId } } }
        );

        // Send SQS messages
        const messages = pageIds.map(pageId => ({
          bookId: book.id,
          pageId,
          jobId,
        }));
        await sendBatch(messages, jobId);

        console.log(`    Job ${jobId}: ${pageIds.length} pages enqueued`);
      }

      queued++;
      totalPages += pageIds.length;
    }

    console.log(`\n=== Summary ===`);
    console.log(`${DRY_RUN ? 'Would queue' : 'Queued'}: ${queued} books, ${totalPages} pages`);
    console.log(`Skipped (active jobs): ${skipped}`);
    console.log(`Remaining candidates: ${candidates.length - queued - skipped}`);

  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
