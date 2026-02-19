#!/usr/bin/env node

/**
 * Re-OCR pages still on old gemini-2.5-flash model via Lambda workers.
 * Also retranslates pages where OCR was updated after translation.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/reprocess-old-ocr.mjs --mode=ocr
 *   set -a; source .env.production.local; set +a; node scripts/reprocess-old-ocr.mjs --mode=translate
 *   set -a; source .env.production.local; set +a; node scripts/reprocess-old-ocr.mjs --mode=both
 *
 * Options:
 *   --mode=ocr|translate|both   Which task to run (default: ocr)
 *   --limit=N                   Max books to process (default: all)
 *   --dry-run                   Show what would be done without doing it
 *   --min-pages=N               Only process books with at least N affected pages (default: 1)
 *   --delay=N                   Delay in ms between API calls (default: 500)
 *   --skip=N                    Skip first N books (resume after crash)
 */

import { MongoClient } from 'mongodb';

const BASE_URL = 'https://sourcelibrary.org';
const CRON_SECRET = process.env.CRON_SECRET;
const MONGODB_URI = process.env.MONGODB_URI;

if (!CRON_SECRET) {
  console.error('ERROR: CRON_SECRET not set. Source .env.production.local first.');
  process.exit(1);
}
if (!MONGODB_URI) {
  console.error('ERROR: MONGODB_URI not set. Source .env.production.local first.');
  process.exit(1);
}

// Parse args
const args = process.argv.slice(2);
const getArg = (name) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : undefined;
};
const hasFlag = (name) => args.includes(`--${name}`);

const mode = getArg('mode') || 'ocr';
const limit = getArg('limit') ? parseInt(getArg('limit')) : Infinity;
const dryRun = hasFlag('dry-run');
const minPages = getArg('min-pages') ? parseInt(getArg('min-pages')) : 1;
const delay = getArg('delay') ? parseInt(getArg('delay')) : 500;
const skip = getArg('skip') ? parseInt(getArg('skip')) : 0;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function queueJob(bookId, pageIds, action, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/api/jobs/queue-books`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CRON_SECRET}`
        },
        body: JSON.stringify({ bookId, pageIds, action }),
        signal: AbortSignal.timeout(120000) // 2 minute timeout
      });

      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || res.statusText };
      }
      return { success: true, ...data };
    } catch (err) {
      if (attempt < retries) {
        console.log(`    Retry ${attempt}/${retries} after error: ${err.message}`);
        await sleep(3000 * attempt);
        continue;
      }
      return { success: false, error: `Network error after ${retries} attempts: ${err.message}` };
    }
  }
}

async function findOldOcrPages(db) {
  console.log('\n=== Finding pages with old OCR model (gemini-2.5-flash) ===');

  const results = await db.collection('pages').aggregate([
    {
      $match: {
        'ocr.data': { $exists: true, $ne: '' },
        'ocr.model': 'gemini-2.5-flash'
      }
    },
    {
      $group: {
        _id: '$book_id',
        pageIds: { $push: '$id' },
        count: { $sum: 1 }
      }
    },
    { $match: { count: { $gte: minPages } } },
    { $sort: { count: -1 } }
  ]).toArray();

  console.log(`Found ${results.length} books with ${results.reduce((s, r) => s + r.count, 0)} old-model pages (min ${minPages} pages/book)`);
  return results;
}

async function findStaleTranslations(db) {
  console.log('\n=== Finding pages with stale translations (OCR newer than translation) ===');

  const results = await db.collection('pages').aggregate([
    {
      $match: {
        'ocr.data': { $exists: true, $ne: '' },
        'ocr.updated_at': { $exists: true },
        'translation.data': { $exists: true, $ne: '' },
        'translation.updated_at': { $exists: true },
        $expr: { $gt: ['$ocr.updated_at', '$translation.updated_at'] }
      }
    },
    {
      $group: {
        _id: '$book_id',
        pageIds: { $push: '$id' },
        count: { $sum: 1 }
      }
    },
    { $match: { count: { $gte: minPages } } },
    { $sort: { count: -1 } }
  ]).toArray();

  console.log(`Found ${results.length} books with ${results.reduce((s, r) => s + r.count, 0)} stale translations (min ${minPages} pages/book)`);
  return results;
}

async function getBookInfo(db, bookIds) {
  const books = await db.collection('books').find(
    { id: { $in: bookIds } },
    { projection: { id: 1, title: 1, language: 1, job: 1 } }
  ).toArray();

  const map = {};
  books.forEach(b => { map[b.id] = b; });
  return map;
}

async function processBooks(bookGroups, action, bookMap) {
  const actionLabel = action === 'ocr' ? 'Re-OCR' : 'Retranslate';
  let queued = 0, skipped = 0, failed = 0;
  let totalPages = 0;

  const toProcess = bookGroups.slice(skip, skip + limit);

  console.log(`\n--- ${actionLabel}: ${toProcess.length} books ---`);

  for (const group of toProcess) {
    const book = bookMap[group._id];
    const title = (book?.title || 'Unknown').substring(0, 50);
    const hasActiveJob = !!book?.job;

    if (hasActiveJob) {
      console.log(`  SKIP (active job): ${title} (${group.count} pages)`);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  [DRY RUN] Would queue ${action} for "${title}" (${group.count} pages)`);
      queued++;
      totalPages += group.count;
      continue;
    }

    const result = await queueJob(group._id, group.pageIds, action);

    if (result.success) {
      console.log(`  OK: "${title}" — ${result.pageCount} pages queued (job ${result.jobId})`);
      queued++;
      totalPages += group.count;
    } else {
      console.log(`  FAIL: "${title}" — ${result.error}`);
      failed++;
    }

    await sleep(delay);
  }

  console.log(`\n${actionLabel} summary: ${queued} books queued (${totalPages} pages), ${skipped} skipped, ${failed} failed`);
  return { queued, skipped, failed, totalPages };
}

async function main() {
  console.log(`Mode: ${mode} | Limit: ${limit === Infinity ? 'all' : limit} | Skip: ${skip} | Min pages: ${minPages} | Dry run: ${dryRun}`);

  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');

  try {
    let ocrGroups = [];
    let translateGroups = [];

    if (mode === 'ocr' || mode === 'both') {
      ocrGroups = await findOldOcrPages(db);
    }

    if (mode === 'translate' || mode === 'both') {
      translateGroups = await findStaleTranslations(db);
    }

    // Get book info for all affected books
    const allBookIds = [...new Set([
      ...ocrGroups.map(g => g._id),
      ...translateGroups.map(g => g._id)
    ])];
    const bookMap = await getBookInfo(db, allBookIds);

    // Process OCR first (retranslation depends on current OCR)
    if (ocrGroups.length > 0) {
      await processBooks(ocrGroups, 'ocr', bookMap);
    }

    if (translateGroups.length > 0) {
      // If running both, note that OCR jobs will conflict with translation jobs on same books
      if (mode === 'both' && ocrGroups.length > 0) {
        console.log('\nWARNING: OCR jobs are now in progress. Translation jobs for the same books will be skipped (active job conflict).');
        console.log('Run --mode=translate separately after OCR completes.');
      }
      await processBooks(translateGroups, 'translation', bookMap);
    }

  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
