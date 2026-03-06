#!/usr/bin/env node
/**
 * Submit EFM books for realtime Lambda translation.
 * Creates job records + enqueues to SQS FIFO translation queue.
 *
 * Usage: secret-lover run -- node _tmp-translate-efm.mjs [--limit=N] [--dry-run]
 */

import { MongoClient, ObjectId } from 'mongodb';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { createHash, randomBytes } from 'crypto';

const MONGODB_URI = process.env.MONGODB_URI;
const QUEUE_URL = process.env.SQS_PAGE_TRANSLATION_QUEUE_URL;
const AWS_REGION = process.env.AWS_REGION || 'eu-central-1';

const args = process.argv.slice(2);
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '20');
const dryRun = args.includes('--dry-run');
const offset = parseInt(args.find(a => a.startsWith('--offset='))?.split('=')[1] || '0');

function nanoid(size = 12) {
  return randomBytes(size).toString('base64url').slice(0, size);
}

function deduplicationId(bookId, pageId, jobId) {
  return createHash('sha256').update(`${bookId}:${pageId}:${jobId}`).digest('hex').slice(0, 128);
}

const sqs = new SQSClient({ region: AWS_REGION });

async function sendBatch(messages, jobId) {
  for (let i = 0; i < messages.length; i += 10) {
    const batch = messages.slice(i, i + 10);
    const cmd = new SendMessageBatchCommand({
      QueueUrl: QUEUE_URL,
      Entries: batch.map((msg, idx) => ({
        Id: `msg-${i + idx}`,
        MessageBody: JSON.stringify(msg),
        MessageGroupId: jobId,
        MessageDeduplicationId: deduplicationId(msg.bookId, msg.pageId, msg.jobId),
      })),
    });
    const result = await sqs.send(cmd);
    if (result.Failed?.length > 0) {
      console.error(`  SQS failures:`, result.Failed);
      throw new Error(`${result.Failed.length} SQS messages failed`);
    }
  }
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Find EFM books needing translation, no active job, sorted smallest first
  const candidates = await db.collection('books').find({
    $or: [
      { categories: 'efm' },
      { categories: 'EFM' },
      { tags: /efm/i },
      { 'image_source.provider': 'efm' },
      { source: /efm/i }
    ],
    pages_ocr: { $gt: 0 },
    $expr: { $gt: ['$pages_ocr', '$pages_translated'] },
    job: { $exists: false }
  }).project({ _id: 1, id: 1, title: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, language: 1 })
    .sort({ pages_ocr: 1 })
    .skip(offset)
    .limit(limit)
    .toArray();

  if (candidates.length === 0) {
    console.log('No candidates found.');
    await client.close();
    return;
  }

  const totalGap = candidates.reduce((s, b) => s + (b.pages_ocr - (b.pages_translated || 0)), 0);
  console.log(`Found ${candidates.length} books, ~${totalGap} pages to translate`);
  console.log(dryRun ? '(DRY RUN)\n' : '\n');

  let totalEnqueued = 0;
  let booksProcessed = 0;

  for (const book of candidates) {
    const bookId = book.id || book._id.toString();

    // Get pages with OCR but no translation
    const pages = await db.collection('pages').find({
      book_id: bookId,
      'ocr.data': { $exists: true, $ne: '' },
      $or: [
        { 'translation.data': { $exists: false } },
        { 'translation.data': '' },
        { 'translation.data': null }
      ]
    }).project({ id: 1, _id: 1, page_number: 1 })
      .sort({ page_number: 1 })
      .toArray();

    if (pages.length === 0) {
      console.log(`  ${bookId} | 0 pages need translation, skipping`);
      continue;
    }

    const pageIds = pages.map(p => p.id || p._id.toString());
    const jobId = nanoid(12);

    console.log(`  ${bookId} | ${pageIds.length} pages | ${book.language || '?'} | ${(book.title || '').slice(0, 55)}`);

    if (dryRun) continue;

    // Create job record
    await db.collection('jobs').insertOne({
      id: jobId,
      type: 'translation',
      book_id: bookId,
      book_title: book.title,
      status: 'pending',
      progress: { total: pageIds.length, completed: 0, failed: 0 },
      config: {
        page_ids: pageIds,
        model: 'gemini-3-flash-preview',
        language: book.language || 'auto-detect'
      },
      initiated_by: 'script',
      created_at: new Date(),
      updated_at: new Date()
    });

    // Set active job on book
    await db.collection('books').updateOne(
      { _id: book._id },
      { $set: { job: { type: 'realtime', job_id: jobId } } }
    );

    // Enqueue to SQS FIFO
    const messages = pageIds.map(pageId => ({
      bookId,
      pageId,
      jobId
    }));
    await sendBatch(messages, jobId);

    totalEnqueued += pageIds.length;
    booksProcessed++;

    // Pace: don't flood the queue
    if (booksProcessed % 5 === 0) {
      console.log(`  --- ${booksProcessed} books submitted, ${totalEnqueued} pages enqueued ---`);
    }
  }

  console.log(`\nDone. ${booksProcessed} books, ${totalEnqueued} pages enqueued.`);
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
