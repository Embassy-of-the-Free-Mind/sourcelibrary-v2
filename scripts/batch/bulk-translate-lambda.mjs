#!/usr/bin/env node
/**
 * Bulk translation via Lambda FIFO workers — direct SQS submission.
 *
 * Finds books with OCR but no translation, creates job records in MongoDB,
 * and enqueues pages directly to the SQS FIFO translation queue.
 *
 * Lambda workers process pages sequentially per book (FIFO messageGroupId = jobId),
 * providing previous-page context for translation continuity.
 *
 * Usage:
 *   secret-lover run -- node scripts/batch/bulk-translate-lambda.mjs [options]
 *
 * The script sources .env.production.local for MONGODB_URI + SQS URLs,
 * and maps AWS_ACCESS_KEY_ID_SOURCELIBRARY → AWS_ACCESS_KEY_ID automatically.
 *
 * Options:
 *   --offset=N       Start at book offset N (default: 0)
 *   --limit=N        Max books to submit (default: 50)
 *   --dry-run        Show what would be submitted
 *   --book-id=ID     Process a single book
 *   --max-pages=N    Skip books with more than N untranslated pages (default: 9999)
 *   --smallest       Sort smallest books first (default — fastest to complete)
 *   --largest        Sort largest books first
 *
 * Requires env: MONGODB_URI, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, SQS_PAGE_TRANSLATION_QUEUE_URL
 */

import { MongoClient } from 'mongodb';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { nanoid } from 'nanoid';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { SKIP_TRANSLATION_PAGE_TYPES } from '../lib/translate-core.mjs';

// Load .env.production.local for MONGODB_URI + SQS URLs
try {
  const envPath = resolve(import.meta.dirname || '.', '../../.env.production.local');
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    let val = trimmed.slice(eqIdx + 1);
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* env file optional if vars already set */ }

// Map Source Library AWS creds to standard names
if (!process.env.AWS_ACCESS_KEY_ID && process.env.AWS_ACCESS_KEY_ID_SOURCELIBRARY) {
  process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID_SOURCELIBRARY;
}
if (!process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_SECRET_ACCESS_KEY_SOURCELIBRARY) {
  process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY_SOURCELIBRARY;
}

const SKIP_PAGE_TYPES = SKIP_TRANSLATION_PAGE_TYPES; // canonical (#3734)
const AWS_REGION = process.env.AWS_REGION || 'eu-central-1';
const QUEUE_URL = process.env.SQS_PAGE_TRANSLATION_QUEUE_URL;
const DEFAULT_MODEL = 'gemini-3-flash-preview';

// --- Parse args ---
const args = process.argv.slice(2);
const getArg = (name) => {
  const a = args.find(a => a.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const OFFSET = parseInt(getArg('offset') || '0', 10);
const LIMIT = parseInt(getArg('limit') || '50', 10);
const DRY_RUN = hasFlag('dry-run');
const SINGLE_BOOK = getArg('book-id');
const MAX_PAGES = parseInt(getArg('max-pages') || '9999', 10);
const SORT_LARGEST = hasFlag('largest');

// --- SQS ---
const sqsClient = new SQSClient({ region: AWS_REGION });

async function sendToFifoQueue(messages, jobId) {
  // Send in batches of 10 (SQS limit)
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < messages.length; i += 10) {
    const chunk = messages.slice(i, i + 10);
    const entries = chunk.map((msg, idx) => ({
      Id: `msg-${i + idx}`,
      MessageBody: JSON.stringify(msg),
      MessageGroupId: jobId,
      // Content-based dedup — each page ID is unique so each message is unique
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
    console.error('ERROR: SQS_PAGE_TRANSLATION_QUEUE_URL not set');
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log(`\n=== Bulk Translation (Lambda FIFO) ===`);
  console.log(`Queue: ${QUEUE_URL}`);
  console.log(`Sort: ${SORT_LARGEST ? 'largest first' : 'smallest first'} | Dry run: ${DRY_RUN}\n`);

  // Find books with OCR'd but untranslated pages
  let bookQuery;
  if (SINGLE_BOOK) {
    bookQuery = { id: SINGLE_BOOK };
  } else {
    bookQuery = {
      pages_count: { $gt: 0 },
      pages_ocr: { $gt: 0 },
    };
  }

  const books = await db.collection('books')
    .find(bookQuery, {
      projection: {
        id: 1, title: 1, language: 1, pages_count: 1,
        pages_ocr: 1, pages_translated: 1, job: 1, _id: 0,
      },
    })
    .sort({ pages_count: SORT_LARGEST ? -1 : 1 })
    .toArray();

  // Filter to books needing translation and without active jobs
  const candidates = [];
  for (const b of books) {
    const translated = b.pages_translated || 0;
    const ocr = b.pages_ocr || 0;
    const untranslated = ocr - translated;
    if (untranslated <= 0) continue;
    if (untranslated > MAX_PAGES) continue;

    // Skip books with active jobs
    if (b.job?.job_id) {
      const activeJob = await db.collection('jobs').findOne({
        id: b.job.job_id,
        status: { $nin: ['completed', 'failed', 'cancelled', 'partial', 'completed_with_errors'] }
      });
      if (activeJob) {
        continue;
      }
    }

    candidates.push({ ...b, untranslated });
  }

  console.log(`Found ${candidates.length} books needing translation`);
  console.log(`Processing offset=${OFFSET}, limit=${LIMIT}\n`);

  const batch = candidates.slice(OFFSET, OFFSET + LIMIT);

  let totalSubmitted = 0;
  let totalPages = 0;
  let totalFailed = 0;

  for (let bi = 0; bi < batch.length; bi++) {
    const book = batch[bi];
    const prefix = `[${bi + 1}/${batch.length}]`;

    // Fetch actual untranslated page IDs
    const pages = await db.collection('pages')
      .find({
        book_id: book.id,
        'ocr.data': { $exists: true, $nin: [null, ''] },
        page_type: { $nin: SKIP_PAGE_TYPES },
        $or: [
          { 'translation.data': { $exists: false } },
          { 'translation.data': null },
          { 'translation.data': '' },
        ],
      })
      .sort({ page_number: 1 })
      .project({ id: 1 })
      .toArray();

    if (pages.length === 0) {
      console.log(`${prefix} ${book.title?.substring(0, 50)} — no untranslated pages, skipping`);
      continue;
    }

    const pageIds = pages.map(p => p.id);
    console.log(`${prefix} ${book.title?.substring(0, 50)} (${book.language || '?'}) — ${pageIds.length} pages`);

    if (DRY_RUN) {
      totalSubmitted++;
      totalPages += pageIds.length;
      continue;
    }

    // Create job record
    const jobId = nanoid(12);
    await db.collection('jobs').insertOne({
      id: jobId,
      type: 'translation',
      book_id: book.id,
      book_title: book.title,
      status: 'pending',
      progress: {
        total: pageIds.length,
        completed: 0,
        failed: 0,
      },
      config: {
        page_ids: pageIds,
        model: DEFAULT_MODEL,
        language: book.language || 'auto-detect',
      },
      initiated_by: 'bulk-translate-script',
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Set active job on book
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: { job: { type: 'realtime', job_id: jobId } } }
    );

    // Enqueue pages to FIFO queue
    const sqsMessages = pageIds.map(pageId => ({
      bookId: book.id,
      pageId,
      jobId,
    }));

    const { sent, failed } = await sendToFifoQueue(sqsMessages, jobId);
    console.log(`  → job ${jobId} | ${sent} enqueued, ${failed} failed`);

    if (sent > 0) {
      // Update job to processing
      await db.collection('jobs').updateOne(
        { id: jobId },
        { $set: { status: 'processing', started_at: new Date(), updated_at: new Date() } }
      );
      totalSubmitted++;
      totalPages += sent;
    } else {
      // SQS completely failed — clean up the orphan job
      await db.collection('jobs').deleteOne({ id: jobId });
      await db.collection('books').updateOne(
        { id: book.id },
        { $unset: { job: '' } }
      );
      totalFailed += failed;

      // If first book fails with cred error, abort early
      if (totalSubmitted === 0) {
        console.error('\n*** First book SQS failed — likely credential issue. Aborting. ***');
        break;
      }
    }

    totalFailed += failed;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Books submitted: ${totalSubmitted}${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`Pages enqueued: ${totalPages}`);
  if (totalFailed > 0) console.log(`Pages failed to enqueue: ${totalFailed}`);
  if (OFFSET + LIMIT < candidates.length) {
    console.log(`\nMore books available (${candidates.length - OFFSET - LIMIT} remaining) — next run: --offset=${OFFSET + LIMIT}`);
  }

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
