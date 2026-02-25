#!/usr/bin/env node
/**
 * Bulk generate indexes for books that have OCR but no index.
 * Calls the production /api/books/{id}/index endpoint for each book.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/bulk-enrich.mjs
 *
 * Options:
 *   --limit=N         Max books to process (default: 50)
 *   --min-ocr=N       Min OCR percentage (default: 0.8)
 *   --max-pages=N     Max pages per book (default: 600, avoids Vercel timeout)
 *   --concurrency=N   Parallel requests (default: 1)
 *   --dry-run         List books without processing
 *   --book-id=ID      Process a specific book
 *   --translated      Only books with 50%+ translation (higher quality indexes)
 */

import { MongoClient } from 'mongodb';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);

const LIMIT = parseInt(args.limit || '50');
const MIN_OCR = parseFloat(args['min-ocr'] || '0.8');
const MAX_PAGES = parseInt(args['max-pages'] || '600');
const CONCURRENCY = parseInt(args.concurrency || '1');
const DRY_RUN = args['dry-run'] === 'true';
const BOOK_ID = args['book-id'];
const TRANSLATED_ONLY = args.translated === 'true';
const BASE_URL = process.env.BASE_URL || 'https://sourcelibrary.org';
const CRON_SECRET = process.env.CRON_SECRET;

if (!CRON_SECRET) {
  console.error('CRON_SECRET not set — needed for auth. Source .env.production.local first.');
  process.exit(1);
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  let books;
  if (BOOK_ID) {
    books = await db.collection('books').find(
      { id: BOOK_ID },
      { projection: { id: 1, title: 1, author: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1 } }
    ).toArray();
  } else {
    const matchStage = {
      'index.generatedAt': { $exists: false },
      pages_count: { $gt: 0, $lte: MAX_PAGES },
      pages_ocr: { $gt: 0 }
    };

    const pipeline = [
      { $match: matchStage },
      { $addFields: {
        ocr_pct: { $divide: ['$pages_ocr', '$pages_count'] },
        trans_pct: { $cond: [{ $gt: ['$pages_translated', 0] }, { $divide: ['$pages_translated', '$pages_count'] }, 0] }
      }},
      { $match: { ocr_pct: { $gte: MIN_OCR } } },
    ];

    if (TRANSLATED_ONLY) {
      pipeline.push({ $match: { trans_pct: { $gte: 0.5 } } });
    }

    pipeline.push(
      { $sort: { read_count: -1, pages_translated: -1 } },
      { $limit: LIMIT },
      { $project: { id: 1, title: 1, author: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, read_count: 1 } }
    );

    books = await db.collection('books').aggregate(pipeline).toArray();
  }

  console.log(`Found ${books.length} books to enrich (max ${MAX_PAGES} pages, ${TRANSLATED_ONLY ? 'translated only' : 'all OCR\'d'})`);
  if (books.length === 0) {
    await client.close();
    return;
  }

  if (DRY_RUN) {
    books.forEach((b, i) => {
      console.log(`  ${i + 1}. ${b.title?.substring(0, 60)} (${b.pages_count}pp, ${b.pages_ocr} OCR, ${b.pages_translated || 0} trans, ${b.read_count || 0} reads)`);
    });
    await client.close();
    return;
  }

  let success = 0;
  let failed = 0;
  let skipped = 0;
  const total = books.length;
  const startTime = Date.now();

  for (let i = 0; i < books.length; i += CONCURRENCY) {
    const batch = books.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (book) => {
        const start = Date.now();
        const idx = i + batch.indexOf(book) + 1;
        console.log(`[${idx}/${total}] ${book.title?.substring(0, 55)} (${book.pages_count}pp)...`);

        try {
          // Skip POST (cache clear) — only needed for re-indexing. Just call GET.
          // GET auto-generates if index is missing or stale.
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 290000); // 290s (just under Vercel's 300s limit)

          const res = await fetch(`${BASE_URL}/api/books/${book.id}/index`, {
            signal: controller.signal,
          });
          clearTimeout(timeout);

          const elapsed = ((Date.now() - start) / 1000).toFixed(1);

          if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}: ${text.substring(0, 200)}`);
          }

          const data = await res.json();
          const sections = data.sectionSummaries?.length || '?';
          const quotes = data.bookSummary?.quotes?.length || '?';
          console.log(`  ✓ ${elapsed}s — ${sections} sections, ${quotes} quotes`);
          return { book, data, elapsed };
        } catch (err) {
          const elapsed = ((Date.now() - start) / 1000).toFixed(1);
          if (err.name === 'AbortError') {
            console.error(`  ✗ ${elapsed}s — TIMEOUT (book too large for Vercel)`);
          } else {
            console.error(`  ✗ ${elapsed}s — ${err.message?.substring(0, 100)}`);
          }
          throw err;
        }
      })
    );

    results.forEach(r => {
      if (r.status === 'fulfilled') success++;
      else failed++;
    });

    // Brief delay between requests
    if (i + CONCURRENCY < books.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\nDone in ${totalElapsed}s: ${success} succeeded, ${failed} failed out of ${total}`);
  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
