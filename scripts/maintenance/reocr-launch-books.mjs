#!/usr/bin/env node
/**
 * Re-enroll under-OCR'd visible (launch) books back into the pipeline.
 *
 * Finds visible books where OCR coverage is below a threshold,
 * resets their pipeline_auto.status to 'archive_complete' so the
 * post-import-pipeline cron will re-submit OCR with limit: 500.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/reocr-launch-books.mjs [--apply]
 *
 * Default: dry run. Pass --apply to actually update.
 */

import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const MIN_OCR_PERCENT = 80; // Books below this % get re-enrolled

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// Find visible books with low OCR coverage using cached fields
const books = await db.collection('books').find(
  { hidden: { $ne: true }, pages_count: { $gt: 0 } },
  {
    projection: {
      id: 1, title: 1, pages_count: 1, pages_ocr: 1,
      'pipeline_auto.status': 1, 'pipeline_auto.ocr_batch_id': 1
    }
  }
).toArray();

// Calculate coverage and filter
const underOcr = books
  .map(b => ({
    id: b.id,
    title: (b.title || '').substring(0, 60),
    pages_count: b.pages_count || 0,
    pages_ocr: b.pages_ocr || 0,
    ocr_percent: b.pages_count > 0 ? Math.round((b.pages_ocr || 0) / b.pages_count * 100) : 0,
    pipeline_status: b.pipeline_auto?.status || 'none',
    ocr_batch_id: b.pipeline_auto?.ocr_batch_id,
  }))
  .filter(b => b.ocr_percent < MIN_OCR_PERCENT)
  .sort((a, b) => a.ocr_percent - b.ocr_percent);

console.log(`Total visible books: ${books.length}`);
console.log(`Books with <${MIN_OCR_PERCENT}% OCR: ${underOcr.length}\n`);

// Group by pipeline status
const byStatus = {};
for (const b of underOcr) {
  byStatus[b.pipeline_status] = (byStatus[b.pipeline_status] || 0) + 1;
}
console.log('Current pipeline status of under-OCR\'d books:');
for (const [status, count] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${status}: ${count}`);
}

// Group by OCR coverage bucket
const buckets = { '0%': 0, '1-10%': 0, '11-25%': 0, '26-50%': 0, '51-79%': 0 };
for (const b of underOcr) {
  if (b.ocr_percent === 0) buckets['0%']++;
  else if (b.ocr_percent <= 10) buckets['1-10%']++;
  else if (b.ocr_percent <= 25) buckets['11-25%']++;
  else if (b.ocr_percent <= 50) buckets['26-50%']++;
  else buckets['51-79%']++;
}
console.log('\nOCR coverage distribution:');
for (const [bucket, count] of Object.entries(buckets)) {
  console.log(`  ${bucket}: ${count}`);
}

// Show sample
console.log('\nSample (first 30):');
for (const b of underOcr.slice(0, 30)) {
  console.log(`  ${b.pages_ocr}/${b.pages_count} (${b.ocr_percent}%) | ${b.pipeline_status} | ${b.title}`);
}

// Totals
const totalPages = underOcr.reduce((sum, b) => sum + b.pages_count, 0);
const totalOcr = underOcr.reduce((sum, b) => sum + b.pages_ocr, 0);
const pagesNeeded = totalPages - totalOcr;
console.log(`\nTotal pages in these books: ${totalPages.toLocaleString()}`);
console.log(`Already OCR'd: ${totalOcr.toLocaleString()}`);
console.log(`Need OCR: ${pagesNeeded.toLocaleString()}`);
console.log(`Estimated batch API cost: ~$${(pagesNeeded * 0.0011).toFixed(2)}`);
console.log(`Estimated days at 25k/day quota: ~${Math.ceil(pagesNeeded / 25000)}`);

if (!APPLY) {
  console.log('\n--- DRY RUN --- Pass --apply to reset these books to archive_complete');
  await client.close();
  process.exit(0);
}

// Reset to archive_complete — skip books already waiting for OCR or being processed
const skipStatuses = ['archive_complete', 'ocr_submitted', 'queued', 'archiving'];
const toReset = underOcr.filter(b => !skipStatuses.includes(b.pipeline_status));
const alreadyReady = underOcr.filter(b => b.pipeline_status === 'archive_complete');
const inProgress = underOcr.filter(b => b.pipeline_status === 'ocr_submitted');

console.log(`\nAlready in archive_complete (cron will pick up): ${alreadyReady.length}`);
console.log(`Currently submitting OCR: ${inProgress.length}`);
console.log(`Will reset to archive_complete: ${toReset.length}`);

let resetCount = 0;
for (const b of toReset) {
  const result = await db.collection('books').updateOne(
    { id: b.id },
    {
      $set: {
        'pipeline_auto.status': 'archive_complete',
        'pipeline_auto.retry_count': 0,
        'pipeline_auto.error': null,
        'pipeline_auto.last_updated': new Date(),
        'pipeline_auto.source': 'admin',
      }
    }
  );
  if (result.modifiedCount > 0) resetCount++;
}

console.log(`\nReset ${resetCount} books to archive_complete`);
console.log('The post-import-pipeline cron (every 10 min) will submit OCR jobs in waves.');

await client.close();
