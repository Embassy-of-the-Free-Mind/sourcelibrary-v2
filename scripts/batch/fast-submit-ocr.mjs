#!/usr/bin/env node
/**
 * Fast OCR Submission — submits ALL archive_complete books for OCR in parallel.
 * Bypasses the pipeline orchestrator's sequential submission for speed.
 * Updates pipeline_auto status directly.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/fast-submit-ocr.mjs
 *   node scripts/fast-submit-ocr.mjs --dry-run
 *   node scripts/fast-submit-ocr.mjs --concurrency 20
 *   node scripts/fast-submit-ocr.mjs --limit 100
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const CRON_SECRET = process.env.CRON_SECRET;
const BASE_URL = process.env.NEXT_PUBLIC_URL || 'https://sourcelibrary.org';

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!CRON_SECRET) { console.error('CRON_SECRET not set'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const concIdx = args.indexOf('--concurrency');
const CONCURRENCY = concIdx >= 0 ? parseInt(args[concIdx + 1], 10) : 10;
const limIdx = args.indexOf('--limit');
const LIMIT = limIdx >= 0 ? parseInt(args[limIdx + 1], 10) : 9999;

console.log(`[fast-submit-ocr] Concurrency: ${CONCURRENCY} | Limit: ${LIMIT} | Dry run: ${DRY_RUN}`);

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${CRON_SECRET}`,
};

async function submitOne(book, db) {
  const bookId = book.id;
  try {
    const res = await fetch(`${BASE_URL}/api/books/${bookId}/batch-ocr-async`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ limit: 500, force: false }),
      signal: AbortSignal.timeout(120000), // 2 min timeout
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: `invalid JSON (${text.length} chars)` }; }

    if (!res.ok) {
      if (data.error === 'no_valid_image_urls') {
        await db.collection('books').updateOne(
          { id: bookId },
          { $set: { 'pipeline_auto.status': 'needs_attention', 'pipeline_auto.error': data.message, 'pipeline_auto.last_updated': new Date() } }
        );
        return { bookId, status: 'needs_attention', error: data.message };
      }
      return { bookId, status: 'error', error: `HTTP ${res.status}: ${data.error || text.substring(0, 100)}` };
    }

    if (data.jobName) {
      await db.collection('books').updateOne(
        { id: bookId },
        { $set: {
          'pipeline_auto.status': 'ocr_submitted',
          'pipeline_auto.ocr_job_name': data.jobName,
          'pipeline_auto.retry_count': 0,
          'pipeline_auto.last_updated': new Date(),
        }}
      );
      return { bookId, status: 'submitted', jobName: data.jobName, title: book.title };
    }

    if (data.processed === 0 || data.message?.includes('No pages need OCR')) {
      await db.collection('books').updateOne(
        { id: bookId },
        { $set: { 'pipeline_auto.status': 'ocr_complete', 'pipeline_auto.last_updated': new Date() } }
      );
      return { bookId, status: 'already_done', title: book.title };
    }

    return { bookId, status: 'unexpected', data };
  } catch (err) {
    return { bookId, status: 'error', error: err.message };
  }
}

async function run() {
  const start = Date.now();
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // Find all visible archive_complete books
  const books = await db.collection('books')
    .find({ 'pipeline_auto.status': 'archive_complete', hidden: { $ne: true } })
    .sort({ read_count: -1 })
    .project({ id: 1, title: 1, pages_count: 1, pages_ocr: 1 })
    .limit(LIMIT)
    .toArray();

  console.log(`Found ${books.length} books ready for OCR submission`);

  if (DRY_RUN) {
    for (const b of books.slice(0, 20)) {
      console.log(`  Would submit: ${b.title} (${b.pages_count} pages, ${b.pages_ocr} OCR'd)`);
    }
    if (books.length > 20) console.log(`  ... and ${books.length - 20} more`);
    await client.close();
    return;
  }

  let submitted = 0, errors = 0, alreadyDone = 0, needsAttention = 0;

  // Process in parallel batches
  for (let i = 0; i < books.length; i += CONCURRENCY) {
    const batch = books.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(b => submitOne(b, db)));

    for (const r of results) {
      if (r.status === 'submitted') {
        submitted++;
      } else if (r.status === 'already_done') {
        alreadyDone++;
      } else if (r.status === 'needs_attention') {
        needsAttention++;
      } else {
        errors++;
        console.log(`  ERROR ${r.bookId}: ${r.error}`);
      }
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    console.log(`[${i + batch.length}/${books.length}] Submitted: ${submitted} | Done: ${alreadyDone} | Errors: ${errors} | ${elapsed}s`);
  }

  const duration = Date.now() - start;
  console.log(`\n=== COMPLETE (${(duration / 1000).toFixed(0)}s) ===`);
  console.log(`Submitted: ${submitted} | Already done: ${alreadyDone} | Needs attention: ${needsAttention} | Errors: ${errors}`);

  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
