#!/usr/bin/env node
/**
 * Queue OCR + translation for top priority EFM books.
 * - Books with <80% OCR: submit OCR via Lambda SQS
 * - Books with 80%+ OCR but <80% translation: submit translation via Lambda SQS
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/queue-efm-priority.mjs --dry-run
 *   set -a; source .env.production.local; set +a; node scripts/queue-efm-priority.mjs
 */

import { MongoClient } from 'mongodb';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { nanoid } from 'nanoid';

const OCR_QUEUE_URL = process.env.SQS_PAGE_OCR_QUEUE_URL;
const TRANSLATION_QUEUE_URL = process.env.SQS_PAGE_TRANSLATION_QUEUE_URL;
const MONGODB_URI = process.env.MONGODB_URI;
const AWS_REGION = process.env.AWS_REGION || 'eu-central-1';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const TOP_N = parseInt(args.find(a => a.startsWith('--top='))?.split('=')[1] || '100');

async function main() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI not set');
  if (!DRY_RUN && !OCR_QUEUE_URL) throw new Error('SQS_PAGE_OCR_QUEUE_URL not set');
  if (!DRY_RUN && !TRANSLATION_QUEUE_URL) throw new Error('SQS_PAGE_TRANSLATION_QUEUE_URL not set');

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const sqs = new SQSClient({ region: AWS_REGION });

  // Get all EFM books not yet at 80% translated
  const books = await db.collection('books').find({
    hidden: { $ne: true },
    pages_count: { $gt: 0 },
    'image_source.provider_name': 'Embassy of the Free Mind',
  }, {
    projection: {
      id: 1, title: 1, language: 1, year: 1, published: 1,
      pages_count: 1, pages_ocr: 1, pages_translated: 1,
      read_count: 1, likes_count: 1, gallery_image_count: 1,
      reading_summary: 1, index: 1, quality_score: 1, job: 1
    }
  }).toArray();

  // Score and filter
  const candidates = books.map(b => {
    const translated = b.pages_translated || 0;
    const ocrd = b.pages_ocr || 0;
    const pct = translated / b.pages_count;
    const ocrPct = ocrd / b.pages_count;
    if (pct >= 0.8) return null;

    let score = 0;
    score += Math.min((b.read_count || 0) * 5, 200);
    score += (b.likes_count || 0) * 20;
    score += Math.min((b.gallery_image_count || 0) * 3, 100);
    score += b.reading_summary ? 15 : 0;
    score += b.index ? 15 : 0;
    score += (b.quality_score || 0) * 10;
    const yr = b.year || parseInt(b.published) || 1700;
    if (yr < 1500) score += 30;
    else if (yr < 1600) score += 20;
    else if (yr < 1700) score += 10;
    if (b.pages_count > 800) score -= 20;

    const needsOcr = ocrPct < 0.8;
    return { ...b, score, pct, ocrPct, needsOcr, yr };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, TOP_N);

  const ocrBooks = candidates.filter(b => b.needsOcr);
  const transBooks = candidates.filter(b => !b.needsOcr);

  console.log(`Top ${TOP_N} EFM priority books:`);
  console.log(`  Need OCR: ${ocrBooks.length} books`);
  console.log(`  Translation-ready: ${transBooks.length} books`);
  console.log(`  ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  let totalOcrQueued = 0, totalTransQueued = 0;
  let ocrBooksQueued = 0, transBooksQueued = 0;
  let skipped = 0;

  // --- OCR JOBS ---
  console.log('=== Submitting OCR jobs ===');
  for (const book of ocrBooks) {
    // Check active job
    if (book.job) {
      const activeJob = await db.collection('jobs').findOne({
        id: book.job.job_id,
        status: { $nin: ['completed', 'failed', 'cancelled', 'partial', 'completed_with_errors'] }
      });
      if (activeJob) { skipped++; continue; }
    }

    // Get pages without OCR that have images
    const pages = await db.collection('pages').find({
      book_id: book.id,
      $or: [
        { 'ocr.data': { $exists: false } },
        { 'ocr.data': '' },
        { 'ocr.data': null }
      ],
      $or: [
        { cropped_photo: { $exists: true, $ne: '' } },
        { archived_photo: { $exists: true, $ne: '' } },
        { photo: { $exists: true, $ne: '' } },
        { photo_original: { $exists: true, $ne: '' } }
      ]
    }, { projection: { id: 1, page_number: 1 } }).sort({ page_number: 1 }).toArray();

    if (pages.length === 0) continue;
    const pageIds = pages.map(p => p.id);

    if (DRY_RUN) {
      console.log(`  [OCR] "${(book.title || '').substring(0, 50)}" — ${pageIds.length} pages (score:${book.score})`);
      totalOcrQueued += pageIds.length;
      ocrBooksQueued++;
      continue;
    }

    const jobId = nanoid(12);
    await db.collection('jobs').insertOne({
      id: jobId,
      type: 'ocr',
      book_id: book.id,
      book_title: book.title,
      status: 'pending',
      progress: { total: pageIds.length, completed: 0, failed: 0 },
      config: { page_ids: pageIds, model: 'gemini-3-flash-preview', language: book.language || 'auto-detect' },
      initiated_by: 'script:queue-efm-priority',
      created_at: new Date(),
      updated_at: new Date()
    });

    await db.collection('books').updateOne(
      { id: book.id },
      { $set: { job: { type: 'realtime', job_id: jobId } } }
    );

    // Send to OCR standard queue (not FIFO)
    let sent = 0;
    for (let i = 0; i < pageIds.length; i += 10) {
      const batch = pageIds.slice(i, i + 10);
      const entries = batch.map((pageId, idx) => ({
        Id: String(idx),
        MessageBody: JSON.stringify({ bookId: book.id, pageId, jobId })
      }));

      const result = await sqs.send(new SendMessageBatchCommand({
        QueueUrl: OCR_QUEUE_URL,
        Entries: entries
      }));
      sent += result.Successful?.length || 0;
    }

    totalOcrQueued += sent;
    ocrBooksQueued++;
    if (ocrBooksQueued % 10 === 0) {
      console.log(`  ... ${ocrBooksQueued} OCR books queued, ${totalOcrQueued.toLocaleString()} pages`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // --- TRANSLATION JOBS ---
  console.log('\n=== Submitting translation jobs ===');
  for (const book of transBooks) {
    if (book.job) {
      const activeJob = await db.collection('jobs').findOne({
        id: book.job.job_id,
        status: { $nin: ['completed', 'failed', 'cancelled', 'partial', 'completed_with_errors'] }
      });
      if (activeJob) { skipped++; continue; }
    }

    const pages = await db.collection('pages').find({
      book_id: book.id,
      'ocr.data': { $exists: true, $ne: '' },
      $or: [
        { 'translation.data': { $exists: false } },
        { 'translation.data': '' },
        { 'translation.data': null }
      ]
    }, { projection: { id: 1, page_number: 1 } }).sort({ page_number: 1 }).toArray();

    if (pages.length === 0) continue;
    const pageIds = pages.map(p => p.id);

    if (DRY_RUN) {
      console.log(`  [TRANS] "${(book.title || '').substring(0, 50)}" — ${pageIds.length} pages (score:${book.score})`);
      totalTransQueued += pageIds.length;
      transBooksQueued++;
      continue;
    }

    const jobId = nanoid(12);
    await db.collection('jobs').insertOne({
      id: jobId,
      type: 'translation',
      book_id: book.id,
      book_title: book.title,
      status: 'pending',
      progress: { total: pageIds.length, completed: 0, failed: 0 },
      config: { page_ids: pageIds, model: 'gemini-3-flash-preview', language: book.language || 'auto-detect' },
      initiated_by: 'script:queue-efm-priority',
      created_at: new Date(),
      updated_at: new Date()
    });

    await db.collection('books').updateOne(
      { id: book.id },
      { $set: { job: { type: 'realtime', job_id: jobId } } }
    );

    // Translation FIFO queue
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
    }

    totalTransQueued += sent;
    transBooksQueued++;
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n=== DONE ===`);
  console.log(`OCR: ${ocrBooksQueued} books, ${totalOcrQueued.toLocaleString()} pages`);
  console.log(`Translation: ${transBooksQueued} books, ${totalTransQueued.toLocaleString()} pages`);
  console.log(`Skipped (active job): ${skipped}`);
  if (DRY_RUN) console.log('(DRY RUN)');

  await client.close();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
