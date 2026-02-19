#!/usr/bin/env node
/**
 * Submit Lambda OCR jobs for books that still have old OCR models.
 * Finds all translated pages where ocr.model is not gemini-3-flash-preview
 * and submits them for re-OCR via the queue-books API.
 *
 * Usage:
 *   node scripts/reocr-old-models.mjs                # dry run
 *   node scripts/reocr-old-models.mjs --apply        # submit jobs
 *   node scripts/reocr-old-models.mjs --apply --limit 50
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const CRON_SECRET = process.env.CRON_SECRET;
const BASE_URL = process.env.NEXT_PUBLIC_URL || 'https://sourcelibrary.org';
const apply = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (apply && !CRON_SECRET) { console.error('CRON_SECRET not set'); process.exit(1); }

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');

  // Find books with pages that have old OCR models
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
    { $sort: { old_ocr_pages: 1 } }, // smallest first for fast wins
    ...(limit < Infinity ? [{ $limit: limit }] : []),
  ]).toArray();

  console.log(`Found ${oldOcrBooks.length} books with old OCR models`);

  // Get book details and check for active jobs
  const bookIds = oldOcrBooks.map(b => b._id);
  const books = await db.collection('books').find({ id: { $in: bookIds } })
    .project({ id: 1, title: 1, pages_count: 1, job: 1 })
    .toArray();
  const bookMap = Object.fromEntries(books.map(b => [b.id, b]));

  let submitted = 0;
  let skipped = 0;
  let errors = 0;
  let totalPages = 0;

  for (const entry of oldOcrBooks) {
    const book = bookMap[entry._id];
    if (!book) { skipped++; continue; }

    // Skip books with active jobs
    if (book.job) {
      console.log(`  SKIP (active job): ${book.title?.slice(0, 60)} — ${entry.old_ocr_pages} pages`);
      skipped++;
      continue;
    }

    // Find specific pages with old OCR
    const oldPages = await db.collection('pages').find({
      book_id: entry._id,
      'ocr.data': { $exists: true, $ne: '' },
      'ocr.model': { $nin: ['gemini-3-flash-preview', 'manual', 'manual-correction'] },
    }).project({ id: 1 }).toArray();

    const pageIds = oldPages.map(p => p.id);
    if (pageIds.length === 0) { skipped++; continue; }

    console.log(`${apply ? 'Submitting' : '[DRY RUN]'} OCR: ${book.title?.slice(0, 55)} — ${pageIds.length} pages (was ${entry.ocr_model})`);

    if (!apply) {
      totalPages += pageIds.length;
      submitted++;
      continue;
    }

    try {
      const res = await fetch(`${BASE_URL}/api/jobs/queue-books`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CRON_SECRET}`,
        },
        body: JSON.stringify({
          bookId: entry._id,
          pageIds,
          action: 'ocr',
        }),
      });

      const data = await res.json();

      if (res.ok) {
        submitted++;
        totalPages += pageIds.length;
        console.log(`  -> Job ${data.jobId}, ${data.pageCount} pages queued`);
      } else {
        console.error(`  -> ERROR: ${data.error}`);
        errors++;
      }

      // Small delay between submissions
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`  -> FETCH ERROR: ${err.message}`);
      errors++;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Submitted: ${submitted}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total pages queued for re-OCR: ${totalPages}`);
  if (!apply) console.log('\nDry run — use --apply to submit jobs');

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
