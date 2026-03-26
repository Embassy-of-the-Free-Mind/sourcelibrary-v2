#!/usr/bin/env node
/**
 * Dead-link health check: fetch every visible book page and report failures.
 *
 * Detects:
 *   - HTTP errors (status !== 200)
 *   - Soft errors ("Temporarily Unavailable", "Internal Server Error" in body)
 *   - Slow responses (>5s warning)
 *   - Timeouts (>10s)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/dead-link-check.mjs
 *
 * Options:
 *   --limit N       Check only the first N books (for testing)
 *   --base-url URL  Override the base URL (default: https://sourcelibrary.org)
 *
 * Closes #373
 */

import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

const BASE_URL = getArg('--base-url') || 'https://sourcelibrary.org';
const LIMIT = getArg('--limit') ? parseInt(getArg('--limit'), 10) : 0;
const CONCURRENCY = 5;
const TIMEOUT_MS = 10_000;
const SLOW_THRESHOLD_MS = 5_000;

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

// ── MongoDB: fetch all visible books ──

async function fetchVisibleBooks() {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
  });

  try {
    await client.connect();
    const db = client.db('bookstore');

    const books = await db.collection('books').find(
      {
        status: { $ne: 'deleted' },
        hidden: { $ne: true },
        pages_count: { $gt: 0 },
      },
      {
        projection: { id: 1, slug: 1, title: 1, display_title: 1 },
      }
    ).toArray();

    return books;
  } finally {
    await client.close();
  }
}

// ── URL construction (mirrors src/lib/slugify.ts bookUrl) ──

function bookUrl(book) {
  return `/book/${book.slug || book.id}`;
}

// ── HTTP check ──

async function checkBook(book) {
  const path = bookUrl(book);
  const url = `${BASE_URL}${path}`;
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'SourceLibrary-DeadLinkCheck/1.0' },
    });
    clearTimeout(timer);

    const elapsed = Date.now() - start;
    const body = await res.text();

    const result = { url, path, elapsed, status: res.status, title: book.display_title || book.title };

    // Check for soft errors in response body
    if (res.status === 200) {
      if (body.includes('Temporarily Unavailable') || body.includes('Internal Server Error')) {
        result.error = 'Soft error in response body';
        return result;
      }
    }

    if (res.status !== 200) {
      result.error = `HTTP ${res.status}`;
      return result;
    }

    if (elapsed > SLOW_THRESHOLD_MS) {
      result.slow = true;
    }

    return result;
  } catch (err) {
    const elapsed = Date.now() - start;
    return {
      url,
      path,
      elapsed,
      status: 0,
      title: book.display_title || book.title,
      error: err.name === 'AbortError' ? `Timeout (>${TIMEOUT_MS / 1000}s)` : err.message,
    };
  }
}

// ── Batched runner ──

async function runBatched(books) {
  const results = [];
  for (let i = 0; i < books.length; i += CONCURRENCY) {
    const batch = books.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(checkBook));
    results.push(...batchResults);

    // Progress indicator every 50 books
    const done = Math.min(i + CONCURRENCY, books.length);
    if (done % 50 === 0 || done === books.length) {
      process.stdout.write(`  Checked ${done}/${books.length}\r`);
    }
  }
  process.stdout.write('\n');
  return results;
}

// ── Main ──

async function main() {
  console.log('\nDead-link health check');
  console.log(`Base URL: ${BASE_URL}`);
  console.log('');

  console.log('Fetching visible books from MongoDB...');
  let books = await fetchVisibleBooks();
  console.log(`Found ${books.length} visible books with pages.`);

  if (LIMIT > 0) {
    books = books.slice(0, LIMIT);
    console.log(`Limited to first ${LIMIT} books.`);
  }

  console.log(`Checking with concurrency=${CONCURRENCY}, timeout=${TIMEOUT_MS / 1000}s\n`);

  const results = await runBatched(books);

  // Categorize
  const failures = results.filter(r => r.error);
  const slow = results.filter(r => r.slow && !r.error);
  const ok = results.filter(r => !r.error && !r.slow);

  // ── Summary ──
  console.log('─'.repeat(60));
  console.log(`  Total checked:  ${results.length}`);
  console.log(`  OK:             ${ok.length}`);
  console.log(`  Slow (>${SLOW_THRESHOLD_MS / 1000}s):    ${slow.length}`);
  console.log(`  Failed:         ${failures.length}`);
  console.log('─'.repeat(60));

  if (slow.length > 0) {
    console.log('\nSlow pages:');
    for (const r of slow.sort((a, b) => b.elapsed - a.elapsed)) {
      console.log(`  ${r.elapsed}ms  ${BASE_URL}${r.path}`);
      console.log(`           ${r.title}`);
    }
  }

  if (failures.length > 0) {
    console.log('\nBroken pages:');
    for (const r of failures) {
      console.log(`  [${r.status || 'ERR'}] ${r.error}  ${r.elapsed}ms`);
      console.log(`        ${BASE_URL}${r.path}`);
      console.log(`        ${r.title}`);
    }
  }

  if (failures.length === 0 && slow.length === 0) {
    console.log('\nAll pages healthy.');
  }

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
