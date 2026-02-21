#!/usr/bin/env node
/**
 * Realtime Enrichment — calls production API endpoints to generate
 * summaries, indexes, entities, and chapters for books.
 *
 * Targets books that have translations but lack enrichment.
 * Uses HTTP calls to production endpoints (handles auth via CRON_SECRET).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/batch/realtime-enrich.mjs [options]
 *
 * Targeting options:
 *   --book-id=ID          Single book only
 *   --status=STATUS       Filter by pipeline_auto.status (e.g. translate_complete)
 *   --offset=N            Skip first N eligible books
 *   --skip-chapters       Skip chapter extraction
 *   --skip-index          Skip summary/index generation
 *   --chapters-only       Only extract chapters (skip summary/index)
 *
 * Control options:
 *   --limit=N             Max books (default: 100)
 *   --concurrency=N       Parallel books (default: 5)
 *   --dry-run             Show what would be processed
 */

import { MongoClient } from 'mongodb';

// --- Config ---
const BASE_URL = 'https://sourcelibrary.org';
const REQUEST_TIMEOUT = 120000; // 2 min per request (Vercel maxDuration)

// --- Parse args ---
const args = process.argv.slice(2);
const getArg = (name) => {
  const a = args.find(a => a.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const MAX_BOOKS = parseInt(getArg('limit') || '100', 10);
const CONCURRENCY = parseInt(getArg('concurrency') || '5', 10);
const DRY_RUN = hasFlag('dry-run');
const SINGLE_BOOK = getArg('book-id');
const OFFSET = parseInt(getArg('offset') || '0', 10);
const PIPELINE_STATUS = getArg('status');
const SKIP_CHAPTERS = hasFlag('skip-chapters');
const SKIP_INDEX = hasFlag('skip-index');
const CHAPTERS_ONLY = hasFlag('chapters-only');

// Auth header for production API
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET && !DRY_RUN) {
  console.error('CRON_SECRET not set in environment');
  process.exit(1);
}

const authHeaders = {
  'Authorization': `Bearer ${CRON_SECRET}`,
  'Content-Type': 'application/json',
};

// --- API callers ---
async function enrichBook(bookId) {
  const url = `${BASE_URL}/api/books/${bookId}/index`;
  const response = await fetch(url, {
    method: 'POST', // POST forces regeneration
    headers: authHeaders,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Index ${response.status}: ${text.substring(0, 200)}`);
  }

  return response.json();
}

async function extractChapters(bookId) {
  const url = `${BASE_URL}/api/books/${bookId}/extract-chapters`;
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Chapters ${response.status}: ${text.substring(0, 200)}`);
  }

  return response.json();
}

// --- Process one book ---
async function processBook(book, db, stats) {
  const bookId = book.id;
  const title = (book.title || bookId).substring(0, 50);
  const startTime = Date.now();

  let indexResult = null;
  let chaptersResult = null;

  // Step 1: Summary + Index (unless skip-index or chapters-only)
  if (!SKIP_INDEX && !CHAPTERS_ONLY) {
    try {
      indexResult = await enrichBook(bookId);
      stats.indexOk++;
    } catch (err) {
      stats.indexFail++;
      stats.errors.push(`${title}: index: ${err.message?.substring(0, 100)}`);

      // If index fails, still try chapters unless it's a 404
      if (err.message?.includes('404')) {
        return { title, indexResult: null, chaptersResult: null, error: err.message };
      }
    }
  }

  // Step 2: Chapters (unless skip-chapters)
  if (!SKIP_CHAPTERS && (book.pages_count || 0) >= 10) {
    try {
      chaptersResult = await extractChapters(bookId);
      stats.chaptersOk++;
    } catch (err) {
      stats.chaptersFail++;
      // Non-critical — don't add to errors unless it's unexpected
      if (!err.message?.includes('404') && !err.message?.includes('No pages')) {
        stats.errors.push(`${title}: chapters: ${err.message?.substring(0, 100)}`);
      }
    }
  }

  // Step 3: Update pipeline status
  const newStatus = CHAPTERS_ONLY ? 'chapters_complete' :
    (!SKIP_CHAPTERS && (book.pages_count || 0) >= 10) ? 'chapters_complete' : 'enriched';

  try {
    const currentStatus = book.pipeline_auto?.status;
    const validTransitions = {
      'translate_complete': ['metadata_enriched', 'enriched', 'chapters_complete'],
      'metadata_enriched': ['enriched', 'chapters_complete'],
      'enriched': ['chapters_complete'],
      'chapters': ['chapters_complete'],
    };

    const allowed = validTransitions[currentStatus] || [];
    if (allowed.includes(newStatus) || !currentStatus) {
      await db.collection('books').updateOne(
        { id: bookId },
        {
          $set: {
            'pipeline_auto.status': newStatus,
            'pipeline_auto.last_updated': new Date(),
            updated_at: new Date(),
          },
        }
      );
      stats.statusUpdated++;
    }
  } catch (e) {
    // Non-critical
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  stats.completed++;

  // Progress line
  const total = stats.completed + stats.indexFail + stats.chaptersFail;
  const globalElapsed = ((Date.now() - stats.startTime) / 1000).toFixed(0);
  const bpm = globalElapsed > 0 ? (stats.completed / (globalElapsed / 60)).toFixed(1) : '0';
  const indexStatus = indexResult ? 'idx' : (SKIP_INDEX || CHAPTERS_ONLY ? '-' : 'FAIL');
  const chapStatus = chaptersResult ? `${chaptersResult.chaptersCount}ch` : (SKIP_CHAPTERS ? '-' : 'skip');
  process.stdout.write(
    `\r  ${stats.completed}/${stats.total} | ${bpm} b/min | ${title.substring(0, 35).padEnd(35)} ${indexStatus} ${chapStatus} | ${globalElapsed}s`
  );

  return { title, indexResult, chaptersResult, elapsed };
}

// --- Main ---
async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI not set');

  const client = new MongoClient(mongoUri, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  console.log(`=== Realtime Enrichment ===`);
  console.log(`  limit=${MAX_BOOKS} concurrency=${CONCURRENCY} offset=${OFFSET}`);
  if (SINGLE_BOOK) console.log(`  book=${SINGLE_BOOK}`);
  if (PIPELINE_STATUS) console.log(`  status=${PIPELINE_STATUS}`);
  if (SKIP_INDEX) console.log(`  skip-index`);
  if (SKIP_CHAPTERS) console.log(`  skip-chapters`);
  if (CHAPTERS_ONLY) console.log(`  chapters-only`);
  if (DRY_RUN) console.log(`  DRY RUN`);
  console.log('');

  try {
    // --- Find eligible books ---
    const bookFilter = { hidden: { $ne: true } }; // Only visible (launch set) books

    if (SINGLE_BOOK) {
      bookFilter.id = SINGLE_BOOK;
    } else if (PIPELINE_STATUS) {
      bookFilter['pipeline_auto.status'] = PIPELINE_STATUS;
    } else if (CHAPTERS_ONLY) {
      // Books that are enriched but don't have chapters yet
      bookFilter['pipeline_auto.status'] = { $in: ['enriched', 'chapters'] };
    } else {
      // Default: books needing enrichment (translate_complete or metadata_enriched)
      bookFilter['pipeline_auto.status'] = {
        $in: ['translate_complete', 'metadata_enriched', 'enriched'],
      };
    }

    // Don't filter on index freshness — pipeline status is the authority.
    // Books at translate_complete may have stale indexes from earlier runs
    // but need the full enrich + pipeline advancement.

    const books = await db.collection('books')
      .find(bookFilter)
      .project({
        id: 1, _id: 0, title: 1, language: 1, pages_count: 1,
        pages_ocr: 1, pages_translated: 1,
        'pipeline_auto.status': 1, 'index.generatedAt': 1,
        chapters_extracted_at: 1,
      })
      .sort({ read_count: -1 }) // popular books first
      .skip(OFFSET)
      .limit(MAX_BOOKS)
      .toArray();

    console.log(`Books found: ${books.length}`);

    if (books.length === 0) {
      console.log('Nothing to enrich.');
      await client.close();
      return;
    }

    if (DRY_RUN) {
      const statusCounts = {};
      for (const b of books) {
        const s = b.pipeline_auto?.status || 'unknown';
        statusCounts[s] = (statusCounts[s] || 0) + 1;
        const hasIndex = b.index?.generatedAt ? 'idx' : '   ';
        const hasChapters = b.chapters_extracted_at ? 'ch' : '  ';
        const pct = b.pages_count > 0 ? Math.round((b.pages_translated || 0) / b.pages_count * 100) : 0;
        console.log(
          `  ${(b.title || b.id).substring(0, 55).padEnd(57)} ` +
          `${s.padEnd(22)} ${hasIndex} ${hasChapters} ${pct}% tr`
        );
      }

      console.log('\nBy pipeline status:');
      for (const [s, c] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${s.padEnd(25)} ${c}`);
      }

      const estCost = books.length * 0.05;
      const estMinutes = Math.round(books.length / CONCURRENCY * 0.75);
      console.log(`\nEstimated cost: $${estCost.toFixed(2)}`);
      console.log(`Estimated time: ~${estMinutes} minutes at concurrency ${CONCURRENCY}`);

      await client.close();
      return;
    }

    // --- Process books in parallel batches ---
    const stats = {
      completed: 0, indexOk: 0, indexFail: 0,
      chaptersOk: 0, chaptersFail: 0, statusUpdated: 0,
      total: books.length, errors: [],
      startTime: Date.now(),
    };

    for (let i = 0; i < books.length; i += CONCURRENCY) {
      const batch = books.slice(i, i + CONCURRENCY);
      const batchNum = Math.floor(i / CONCURRENCY) + 1;

      if (i > 0) {
        console.log(''); // newline between batches
      }

      await Promise.allSettled(
        batch.map(book => processBook(book, db, stats))
      );
    }

    const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(0);
    console.log(`\n\n=== Summary ===`);
    console.log(`Books processed: ${stats.completed}/${stats.total}`);
    console.log(`Index: ${stats.indexOk} ok, ${stats.indexFail} failed`);
    console.log(`Chapters: ${stats.chaptersOk} ok, ${stats.chaptersFail} failed`);
    console.log(`Pipeline status updated: ${stats.statusUpdated}`);
    console.log(`Elapsed: ${elapsed}s (${(stats.completed / (elapsed / 60)).toFixed(1)} books/min)`);

    if (stats.errors.length > 0) {
      console.log(`\nErrors (${stats.errors.length}):`);
      for (const e of stats.errors.slice(0, 20)) {
        console.log(`  ${e}`);
      }
      if (stats.errors.length > 20) console.log(`  ... and ${stats.errors.length - 20} more`);
    }
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
