#!/usr/bin/env node
/**
 * Queue translation jobs to get 519 books to 80%+ translation.
 * Targets books that already have enough OCR, sorted by fewest pages needed.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/queue-translations-to-80pct.mjs --dry-run
 *   set -a; source .env.production.local; set +a; node scripts/queue-translations-to-80pct.mjs
 *
 * Options:
 *   --dry-run    Show what would be queued without queuing
 *   --limit=N    Max books to queue (default: 519)
 */

import { MongoClient } from 'mongodb';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { nanoid } from 'nanoid';

const TRANSLATION_QUEUE_URL = process.env.SQS_PAGE_TRANSLATION_QUEUE_URL;
const MONGODB_URI = process.env.MONGODB_URI;
const AWS_REGION = process.env.AWS_REGION || 'eu-central-1';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '519');

async function main() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI not set');
  if (!TRANSLATION_QUEUE_URL && !DRY_RUN) throw new Error('SQS_PAGE_TRANSLATION_QUEUE_URL not set');

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const sqs = new SQSClient({ region: AWS_REGION });

  // Find all visible books with pages
  const allBooks = await db.collection('books').find({
    hidden: { $ne: true },
    pages_count: { $gt: 0 },
  }, {
    projection: { id: 1, title: 1, language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, job: 1 }
  }).toArray();

  // Filter to books under 80% that CAN reach 80% with existing OCR
  const candidates = allBooks
    .map(b => {
      const translated = b.pages_translated || 0;
      const ocrd = b.pages_ocr || 0;
      const pct = translated / b.pages_count;
      const target80 = Math.ceil(b.pages_count * 0.8);
      const pagesNeeded = Math.max(0, target80 - translated);
      const ocrAvailable = ocrd - translated;
      return { ...b, pct, pagesNeeded, ocrAvailable, canReach80: ocrAvailable >= pagesNeeded };
    })
    .filter(b => b.pct < 0.8 && b.canReach80 && b.pagesNeeded > 0)
    .sort((a, b) => a.pagesNeeded - b.pagesNeeded)
    .slice(0, LIMIT);

  console.log(`Found ${candidates.length} books that can reach 80% with existing OCR`);
  const totalPagesNeeded = candidates.reduce((s, b) => s + b.pagesNeeded, 0);
  console.log(`Total pages to translate: ${totalPagesNeeded.toLocaleString()}`);
  console.log(`${DRY_RUN ? 'DRY RUN — nothing will be queued' : 'LIVE — submitting to SQS'}\n`);

  let totalQueued = 0;
  let totalBooks = 0;
  let skippedActive = 0;

  for (const book of candidates) {
    // Check for active job
    if (book.job) {
      const activeJob = await db.collection('jobs').findOne({
        id: book.job.job_id,
        status: { $nin: ['completed', 'failed', 'cancelled', 'partial', 'completed_with_errors'] }
      });
      if (activeJob) {
        skippedActive++;
        continue;
      }
    }

    // Get untranslated pages with OCR, sorted by page_number
    const untranslated = await db.collection('pages').find({
      book_id: book.id,
      'ocr.data': { $exists: true, $ne: '' },
      $or: [
        { 'translation.data': { $exists: false } },
        { 'translation.data': '' },
        { 'translation.data': null }
      ]
    }, { projection: { id: 1, page_number: 1 } }).sort({ page_number: 1 }).toArray();

    if (untranslated.length === 0) continue;

    // Only queue enough pages to reach 80%
    const pagesToQueue = untranslated.slice(0, book.pagesNeeded);
    const pageIds = pagesToQueue.map(p => p.id);

    if (DRY_RUN) {
      if (totalBooks < 20 || totalBooks % 50 === 0) {
        console.log(`  [${totalBooks + 1}] "${(book.title || '').substring(0, 60)}" — ${pageIds.length} pages (${book.language || '?'})`);
      }
      totalQueued += pageIds.length;
      totalBooks++;
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
      progress: { total: pageIds.length, completed: 0, failed: 0 },
      config: {
        page_ids: pageIds,
        model: 'gemini-3-flash-preview',
        language: book.language || 'auto-detect'
      },
      initiated_by: 'script:queue-translations-to-80pct',
      created_at: new Date(),
      updated_at: new Date()
    });

    // Set active job on book
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: { job: { type: 'realtime', job_id: jobId } } }
    );

    // Send to SQS FIFO queue in batches of 10
    let sent = 0;
    for (let i = 0; i < pageIds.length; i += 10) {
      const batch = pageIds.slice(i, i + 10);
      const entries = batch.map((pageId, idx) => ({
        Id: String(idx),
        MessageBody: JSON.stringify({ bookId: book.id, pageId, jobId }),
        MessageGroupId: jobId,
        MessageDeduplicationId: `${jobId}-${pageId}`
      }));

      const result = await sqs.send(new SendMessageBatchCommand({
        QueueUrl: TRANSLATION_QUEUE_URL,
        Entries: entries
      }));

      sent += result.Successful?.length || 0;
      if (result.Failed?.length > 0) {
        console.log(`  WARNING: ${result.Failed.length} messages failed`);
      }
    }

    totalQueued += sent;
    totalBooks++;

    if (totalBooks % 25 === 0) {
      console.log(`  ... ${totalBooks} books queued, ${totalQueued.toLocaleString()} pages so far`);
    }

    // Small delay between books
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n=== DONE ===`);
  console.log(`Books queued: ${totalBooks}`);
  console.log(`Pages queued: ${totalQueued.toLocaleString()}`);
  console.log(`Skipped (active job): ${skippedActive}`);
  if (DRY_RUN) console.log('(DRY RUN — nothing actually queued)');

  await client.close();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
