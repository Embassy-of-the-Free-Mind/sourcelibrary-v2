#!/usr/bin/env node

/**
 * Bulk OCR via Lambda (SQS standard queue)
 *
 * Finds pages missing OCR for specified books and enqueues them
 * to the OCR Lambda worker via SQS.
 *
 * Usage:
 *   node scripts/batch/bulk-ocr-lambda.mjs --book-ids=id1,id2,id3
 *   node scripts/batch/bulk-ocr-lambda.mjs --provider=efm --incomplete-only
 *   node scripts/batch/bulk-ocr-lambda.mjs --dry-run
 */

import { MongoClient } from 'mongodb';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { nanoid } from 'nanoid';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.production.local
try {
  const envPath = resolve(process.cwd(), '.env.production.local');
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} catch (e) { /* ignore */ }

// Map AWS credentials
if (process.env.AWS_ACCESS_KEY_ID_SOURCELIBRARY) {
  process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID_SOURCELIBRARY;
}
if (process.env.AWS_SECRET_ACCESS_KEY_SOURCELIBRARY) {
  process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY_SOURCELIBRARY;
}

const AWS_REGION = process.env.AWS_REGION || 'eu-central-1';
const QUEUE_URL = process.env.SQS_PAGE_OCR_QUEUE_URL;

// Parse args
function getArg(name) {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const BOOK_IDS = getArg('book-ids')?.split(',').filter(Boolean) || [];
const PROVIDER = getArg('provider');
const DRY_RUN = hasFlag('dry-run');
const INCOMPLETE_ONLY = hasFlag('incomplete-only') || true; // default: only pages missing OCR
const LIMIT = parseInt(getArg('limit') || '0', 10);

// SQS client
const sqsClient = new SQSClient({ region: AWS_REGION });

async function sendToQueue(messages, jobId) {
  let sent = 0, failed = 0;
  for (let i = 0; i < messages.length; i += 10) {
    const chunk = messages.slice(i, i + 10);
    const entries = chunk.map((msg, idx) => ({
      Id: `msg-${i + idx}`,
      MessageBody: JSON.stringify(msg),
    }));
    try {
      const result = await sqsClient.send(new SendMessageBatchCommand({
        QueueUrl: QUEUE_URL,
        Entries: entries,
      }));
      sent += (result.Successful || []).length;
      const fails = result.Failed || [];
      if (fails.length > 0) {
        console.error(`    SQS batch failures:`, fails.map(f => f.Message));
        failed += fails.length;
      }
    } catch (err) {
      console.error(`    SQS send error: ${err.message}`);
      failed += chunk.length;
    }
  }
  return { sent, failed };
}

async function main() {
  if (!QUEUE_URL) {
    console.error('ERROR: SQS_PAGE_OCR_QUEUE_URL not set');
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 60000,
    maxPoolSize: 2,
  });
  await client.connect();
  const db = client.db('bookstore');

  console.log(`\n=== Bulk OCR (Lambda Standard Queue) ===`);
  console.log(`Queue: ${QUEUE_URL}`);
  console.log(`Dry run: ${DRY_RUN}\n`);

  // Build book query
  let bookQuery = { pages_count: { $gt: 0 } };
  if (BOOK_IDS.length > 0) {
    bookQuery.id = { $in: BOOK_IDS };
  } else if (PROVIDER) {
    bookQuery['image_source.provider'] = PROVIDER;
    // Only books with incomplete OCR
    bookQuery.$expr = { $lt: ['$pages_ocr', '$pages_count'] };
  }

  const books = await db.collection('books')
    .find(bookQuery, {
      projection: { id: 1, title: 1, language: 1, pages_count: 1, pages_ocr: 1, job: 1, _id: 0 },
    })
    .sort({ pages_count: 1 })
    .toArray();

  console.log(`Found ${books.length} books matching query`);

  // Filter books with active OCR jobs
  const candidates = [];
  for (const b of books) {
    const missing = (b.pages_count || 0) - (b.pages_ocr || 0);
    if (missing <= 0) continue;

    if (b.job?.job_id) {
      const activeJob = await db.collection('jobs').findOne({
        id: b.job.job_id,
        status: { $nin: ['completed', 'failed', 'cancelled', 'partial', 'completed_with_errors'] }
      });
      if (activeJob) continue;
    }
    candidates.push({ ...b, missing });
  }

  const batch = LIMIT > 0 ? candidates.slice(0, LIMIT) : candidates;
  console.log(`${batch.length} books need OCR (${candidates.length} candidates)\n`);

  let totalSubmitted = 0, totalPages = 0, totalFailed = 0;

  for (let bi = 0; bi < batch.length; bi++) {
    const book = batch[bi];

    // Find pages missing OCR
    const pages = await db.collection('pages').find({
      book_id: book.id,
      $or: [
        { 'ocr.data': { $exists: false } },
        { 'ocr.data': '' },
        { 'ocr.data': null },
      ]
    }, { projection: { id: 1, page_number: 1, _id: 0 } })
      .sort({ page_number: 1 })
      .toArray();

    if (pages.length === 0) {
      console.log(`[${bi + 1}/${batch.length}] ${book.title?.substring(0, 55)} — no pages missing OCR, skipping`);
      continue;
    }

    console.log(`[${bi + 1}/${batch.length}] ${book.title?.substring(0, 55)} (${book.language || '?'}) — ${pages.length} pages`);

    if (DRY_RUN) continue;

    // Create job record
    const jobId = nanoid();
    const pageIds = pages.map(p => p.id);

    await db.collection('jobs').insertOne({
      id: jobId,
      type: 'ocr',
      status: 'processing',
      book_id: book.id,
      book_title: book.title,
      progress: { total: pageIds.length, completed: 0, failed: 0 },
      config: { page_ids: pageIds, language: book.language || 'Unknown' },
      initiated_by: 'bulk-ocr-script',
      created_at: new Date(),
      updated_at: new Date(),
      started_at: new Date(),
    });

    // Set book.job
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: { job: { type: 'realtime', job_id: jobId }, updated_at: new Date() } }
    );

    // Build SQS messages
    const messages = pageIds.map(pageId => ({
      bookId: book.id,
      pageId,
      jobId,
    }));

    const { sent, failed } = await sendToQueue(messages, jobId);
    console.log(`  → job ${jobId} | ${sent} enqueued, ${failed} failed`);

    totalSubmitted++;
    totalPages += sent;
    totalFailed += failed;

    // If first book fails completely, abort (credential issue)
    if (bi === 0 && sent === 0 && failed > 0) {
      console.error('\nFirst book failed completely — aborting (check AWS credentials)');
      break;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Books submitted: ${totalSubmitted}`);
  console.log(`Pages enqueued: ${totalPages}`);
  if (totalFailed > 0) console.log(`SQS failures: ${totalFailed}`);

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
