#!/usr/bin/env node
/**
 * Submit Lambda FIFO translation jobs for EFM books at ocr_complete.
 * Uses queue-books API which sends pages to the FIFO translation queue
 * for sequential processing with previous-page context.
 *
 * Usage:
 *   node scripts/submit-efm-translations.mjs                # dry run
 *   node scripts/submit-efm-translations.mjs --apply        # submit jobs
 *   node scripts/submit-efm-translations.mjs --apply --limit 50  # first 50
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const CRON_SECRET = process.env.CRON_SECRET;
const BASE_URL = process.env.NEXT_PUBLIC_URL || 'https://sourcelibrary.org';
const apply = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

if (!MONGODB_URI) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');

  // Find EFM books at ocr_complete (or metadata_enriched — they also need translation)
  // Skip books that already have an active job (book.job field exists)
  const books = await db.collection('books').find({
    'image_source.provider': 'efm',
    'pipeline_auto.status': { $in: ['ocr_complete', 'metadata_enriched'] },
    pages_count: { $gt: 0 },
    'job': { $exists: false },
  }).project({
    id: 1, title: 1, pages_count: 1, pages_translated: 1, original_language: 1,
  }).sort({ pages_count: 1 }) // smallest first for fast wins
    .limit(limit)
    .toArray();

  console.log(`Found ${books.length} EFM books needing translation`);

  let submitted = 0;
  let skipped = 0;
  let errors = 0;
  let totalPages = 0;

  for (const book of books) {
    // Find pages with OCR but no translation
    const untranslatedPages = await db.collection('pages').find({
      book_id: book.id,
      'ocr.data': { $exists: true, $ne: '' },
      $or: [
        { 'translation.data': { $exists: false } },
        { 'translation.data': '' },
        { 'translation.data': null },
      ],
    }).project({ id: 1 }).toArray();

    const pageIds = untranslatedPages.map(p => p.id);

    if (pageIds.length === 0) {
      skipped++;
      continue;
    }

    console.log(`${apply ? 'Submitting' : '[DRY RUN]'} ${book.title?.slice(0, 60)} — ${pageIds.length} pages (${book.original_language || '?'})`);

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
          bookId: book.id,
          pageIds,
          action: 'translation',
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

      // Small delay to avoid hammering SQS
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`  -> FETCH ERROR: ${err.message}`);
      errors++;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Submitted: ${submitted}`);
  console.log(`Skipped (already translated): ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total pages queued: ${totalPages}`);
  if (!apply) console.log('\nDry run — use --apply to submit jobs');

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
