#!/usr/bin/env node
/**
 * Submit Gemini Batch API OCR jobs for LARGE books with old OCR models.
 * Runs in parallel with Lambda workers for faster completion.
 *
 * Only targets books with 300+ old-OCR pages (the long tail that Lambda
 * would take days to process at concurrency 10).
 *
 * Usage:
 *   node scripts/batch-reocr-large-books.mjs                # dry run
 *   node scripts/batch-reocr-large-books.mjs --apply         # submit jobs
 *   node scripts/batch-reocr-large-books.mjs --apply --min-pages 500
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const CRON_SECRET = process.env.CRON_SECRET;
const BASE_URL = process.env.NEXT_PUBLIC_URL || 'https://sourcelibrary.org';
const apply = process.argv.includes('--apply');
const minPagesArg = process.argv.indexOf('--min-pages');
const MIN_PAGES = minPagesArg !== -1 ? parseInt(process.argv[minPagesArg + 1], 10) : 300;

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (apply && !CRON_SECRET) { console.error('CRON_SECRET not set'); process.exit(1); }

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');

  // Find books with old OCR models, only large ones
  const oldOcrBooks = await db.collection('pages').aggregate([
    { $match: {
        'ocr.data': { $exists: true, $ne: '' },
        'ocr.model': { $nin: ['gemini-3-flash-preview', 'manual', 'manual-correction'] },
    }},
    { $group: {
        _id: '$book_id',
        old_ocr_pages: { $sum: 1 },
        ocr_model: { $first: '$ocr.model' },
    }},
    { $match: { old_ocr_pages: { $gte: MIN_PAGES } } },
    { $sort: { old_ocr_pages: -1 } }, // largest first
  ]).toArray();

  console.log(`Found ${oldOcrBooks.length} books with ${MIN_PAGES}+ old-OCR pages`);
  const totalPages = oldOcrBooks.reduce((s, b) => s + b.old_ocr_pages, 0);
  console.log(`Total pages: ${totalPages}\n`);

  // Get book details
  const bookIds = oldOcrBooks.map(b => b._id);
  const books = await db.collection('books').find({ id: { $in: bookIds } })
    .project({ id: 1, title: 1, pages_count: 1, original_language: 1 })
    .toArray();
  const bookMap = Object.fromEntries(books.map(b => [b.id, b]));

  // Check for existing batch jobs to avoid double-submission
  const activeBatchJobs = await db.collection('batch_jobs').find({
    book_id: { $in: bookIds },
    type: 'ocr',
    status: { $in: ['pending', 'processing'] },
  }).project({ book_id: 1 }).toArray();
  const booksWithActiveBatch = new Set(activeBatchJobs.map(j => j.book_id));

  let submitted = 0;
  let skipped = 0;
  let errors = 0;
  let pagesQueued = 0;

  for (const entry of oldOcrBooks) {
    const book = bookMap[entry._id];
    if (!book) { skipped++; continue; }

    if (booksWithActiveBatch.has(entry._id)) {
      console.log(`  SKIP (active batch): ${book.title?.slice(0, 55)} — ${entry.old_ocr_pages} pages`);
      skipped++;
      continue;
    }

    console.log(`${apply ? 'Submitting' : '[DRY RUN]'} Batch OCR: ${book.title?.slice(0, 55)} — ${entry.old_ocr_pages} pages (was ${entry.ocr_model})`);

    if (!apply) {
      pagesQueued += entry.old_ocr_pages;
      submitted++;
      continue;
    }

    try {
      const res = await fetch(`${BASE_URL}/api/books/${entry._id}/batch-ocr-async`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CRON_SECRET}`,
        },
        body: JSON.stringify({
          force: true,
          limit: 5000, // high limit to get all pages
          model: 'gemini-3-flash-preview',
        }),
      });

      const data = await res.json();

      if (res.ok) {
        submitted++;
        pagesQueued += data.totalPages || data.processed || entry.old_ocr_pages;
        console.log(`  -> Batch job submitted: ${data.totalPages || data.processed || '?'} pages, job: ${data.jobName || data.batchJobId || '?'}`);
      } else {
        console.error(`  -> ERROR ${res.status}: ${data.error || JSON.stringify(data)}`);
        errors++;
      }

      // Delay between submissions to avoid overwhelming the API
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`  -> FETCH ERROR: ${err.message}`);
      errors++;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Submitted: ${submitted}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total pages queued for batch OCR: ${pagesQueued}`);
  if (!apply) console.log('\nDry run — use --apply to submit batch jobs');

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
