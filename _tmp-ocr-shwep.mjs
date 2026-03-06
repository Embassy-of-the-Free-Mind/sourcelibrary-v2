#!/usr/bin/env node
/**
 * Submit Lambda OCR jobs for SHWEP books at archive_complete status.
 * Bypasses Next.js API auth by going directly to MongoDB + SQS.
 */

import { MongoClient } from 'mongodb';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { nanoid } from 'nanoid';

const MONGODB_URI = process.env.MONGODB_URI;
const SQS_PAGE_OCR_QUEUE_URL = process.env.SQS_PAGE_OCR_QUEUE_URL;
const AWS_REGION = process.env.AWS_REGION || 'eu-central-1';

if (!MONGODB_URI) throw new Error('MONGODB_URI required');
if (!SQS_PAGE_OCR_QUEUE_URL) throw new Error('SQS_PAGE_OCR_QUEUE_URL required');

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '50');

const client = new MongoClient(MONGODB_URI);
const sqs = new SQSClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function main() {
  await client.connect();
  const db = client.db('bookstore');

  // Find SHWEP books at archive_complete needing OCR
  const books = await db.collection('books').find({
    collections: 'shwep',
    'pipeline_auto.status': 'archive_complete',
  }).project({ id: 1, title: 1, language: 1, pages_count: 1 }).limit(LIMIT).toArray();

  console.log(`Found ${books.length} SHWEP books at archive_complete`);
  if (books.length === 0) {
    await client.close();
    return;
  }

  let totalPages = 0;
  let jobsCreated = 0;

  for (const book of books) {
    // Check for existing active job
    if (!DRY_RUN) {
      const existingJob = await db.collection('jobs').findOne({
        book_id: book.id,
        status: { $in: ['pending', 'processing'] },
      });
      if (existingJob) {
        console.log(`  SKIP ${book.id} "${book.title}" — active job exists`);
        continue;
      }
    }

    // Get pages needing OCR
    const pages = await db.collection('pages').find({
      book_id: book.id,
      $or: [
        { 'ocr.data': { $exists: false } },
        { 'ocr.data': '' },
      ],
    }).project({ id: 1 }).toArray();

    const pageIds = pages.map(p => p.id);
    if (pageIds.length === 0) {
      console.log(`  SKIP ${book.id} "${book.title}" — all pages have OCR`);
      continue;
    }

    console.log(`  ${book.id} "${book.title}" — ${pageIds.length} pages need OCR`);
    totalPages += pageIds.length;

    if (DRY_RUN) continue;

    // Create job record
    const jobId = nanoid(12);
    await db.collection('jobs').insertOne({
      id: jobId,
      type: 'ocr',
      book_id: book.id,
      book_title: book.title,
      status: 'pending',
      progress: { total: pageIds.length, completed: 0, failed: 0 },
      config: {
        page_ids: pageIds,
        model: 'gemini-3-flash-preview',
        language: book.language || 'auto-detect',
      },
      initiated_by: 'script',
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Set active job on book
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: {
        job: { type: 'realtime', job_id: jobId },
        'pipeline_auto.status': 'ocr_submitted',
        'pipeline_auto.last_updated': new Date(),
        updated_at: new Date(),
      } }
    );

    // Enqueue pages to SQS in batches of 10
    for (let i = 0; i < pageIds.length; i += 10) {
      const batch = pageIds.slice(i, i + 10);
      const entries = batch.map((pageId, idx) => ({
        Id: String(idx),
        MessageBody: JSON.stringify({
          bookId: book.id,
          pageId,
          jobId,
        }),
      }));

      await sqs.send(new SendMessageBatchCommand({
        QueueUrl: SQS_PAGE_OCR_QUEUE_URL,
        Entries: entries,
      }));
    }

    jobsCreated++;
    console.log(`    -> Created job ${jobId}, enqueued ${pageIds.length} pages`);
  }

  console.log(`\nDone. ${jobsCreated} jobs created, ${totalPages} total pages queued.`);
  if (DRY_RUN) console.log('(DRY RUN — nothing submitted)');

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
