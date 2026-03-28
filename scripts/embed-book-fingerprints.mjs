#!/usr/bin/env node
/**
 * Phase 1: Compute book fingerprints from sampled OCR page embeddings.
 *
 * For each book with OCR, samples ~5 pages spread evenly, embeds their text
 * with gemini-embedding-001, and stores the averaged vector as the book's
 * semantic fingerprint. Enables edition matching, work_id expansion,
 * duplicate detection, and semantic book search.
 *
 * Cost: ~$5 for 13K books (~32.5M tokens).
 * Storage: ~375 MB (13K × 3072 doubles).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/embed-book-fingerprints.mjs
 *
 * Options:
 *   --limit N       Process at most N books (default: all)
 *   --dry-run       Count books without embedding
 *   --book-id ID    Process a single book
 *   --samples N     Pages to sample per book (default: 5)
 *   --concurrency N Books to process per batch API call (default: 20)
 */

import { MongoClient } from 'mongodb';

const SEMANTIC_MODEL = 'gemini-embedding-001';
const SEMANTIC_DIMENSIONS = 3072;
const MAX_TEXT_CHARS = 30000;

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}
const DRY_RUN = args.includes('--dry-run');
const LIMIT = getArg('limit') ? parseInt(getArg('limit')) : Infinity;
const BOOK_ID = getArg('book-id');
const SAMPLES_PER_BOOK = getArg('samples') ? parseInt(getArg('samples')) : 5;
const CONCURRENCY = getArg('concurrency') ? parseInt(getArg('concurrency')) : 20;

// --- Gemini embedding helpers (inline to avoid TS import issues in .mjs) ---

let apiKeys = [];
let keyIndex = 0;
const keyCooldowns = new Map();

function loadApiKeys() {
  if (process.env.GEMINI_API_KEY) apiKeys.push(process.env.GEMINI_API_KEY);
  for (let i = 2; i <= 10; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (k) apiKeys.push(k);
  }
  if (apiKeys.length === 0) throw new Error('No GEMINI_API_KEY configured');
  console.log(`[embed] ${apiKeys.length} API keys loaded`);
}

function getNextKey() {
  const now = Date.now();
  for (let attempts = 0; attempts < apiKeys.length; attempts++) {
    const key = apiKeys[keyIndex];
    keyIndex = (keyIndex + 1) % apiKeys.length;
    const cooldown = keyCooldowns.get(key);
    if (!cooldown || now - cooldown > 60000) {
      keyCooldowns.delete(key);
      return key;
    }
  }
  // All in cooldown, use oldest
  return apiKeys[keyIndex];
}

async function batchEmbed(texts) {
  // Dynamic import to avoid ESM/CJS issues
  const { GoogleGenerativeAI } = await import('@google/generative-ai');

  const results = [];
  const BATCH_SIZE = 100;

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    let lastErr;

    // Retry with different keys on rate limit
    for (let retry = 0; retry < 3; retry++) {
      const key = getNextKey();
      const client = new GoogleGenerativeAI(key);
      const model = client.getGenerativeModel({ model: SEMANTIC_MODEL });

      try {
        const result = await model.batchEmbedContents({
          requests: batch.map(text => ({
            content: { role: 'user', parts: [{ text: text.slice(0, MAX_TEXT_CHARS) }] },
            taskType: 'RETRIEVAL_DOCUMENT',
          })),
        });
        results.push(...result.embeddings.map(e => e.values));
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const msg = err.message || String(err);
        if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
          keyCooldowns.set(key, Date.now());
          console.warn(`[embed] Rate limited on key ...${key.slice(-6)}, retrying (${retry + 1}/3)`);
          await sleep(2000 * (retry + 1));
          continue;
        }
        throw err; // Non-rate-limit error, bail
      }
    }

    if (lastErr) throw lastErr;
  }

  return results;
}

function averageVectors(vectors) {
  if (vectors.length === 0) throw new Error('No vectors');
  if (vectors.length === 1) return vectors[0];

  const dims = vectors[0].length;
  const avg = new Float64Array(dims);
  for (const v of vectors) {
    for (let i = 0; i < dims; i++) avg[i] += v[i];
  }

  let norm = 0;
  for (let i = 0; i < dims; i++) {
    avg[i] /= vectors.length;
    norm += avg[i] * avg[i];
  }
  norm = Math.sqrt(norm);

  return Array.from(avg, v => norm > 0 ? v / norm : 0);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// --- Main ---

async function samplePages(db, bookId, pagesCount, samplesPerBook) {
  // Pick evenly-spaced page numbers
  const step = Math.max(1, Math.floor(pagesCount / (samplesPerBook + 1)));
  const pageNumbers = [];
  for (let i = 1; i <= samplesPerBook; i++) {
    pageNumbers.push(i * step);
  }

  // Fetch OCR text for those pages
  const pages = await db.collection('pages')
    .find(
      { book_id: bookId, page_number: { $in: pageNumbers }, 'ocr.data': { $exists: true, $ne: '' } },
      { projection: { page_number: 1, 'ocr.data': 1 } }
    )
    .toArray();

  // If we didn't get enough, grab the first N pages with OCR
  if (pages.length < 2) {
    const fallback = await db.collection('pages')
      .find(
        { book_id: bookId, 'ocr.data': { $exists: true, $ne: '' } },
        { projection: { page_number: 1, 'ocr.data': 1 } }
      )
      .sort({ page_number: 1 })
      .limit(samplesPerBook)
      .toArray();
    return fallback;
  }

  return pages;
}

async function main() {
  loadApiKeys();

  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // Find books to process
  const filter = {
    pages_ocr: { $gt: 0 },
    'embedding.fingerprint': { $exists: false },
  };
  if (BOOK_ID) filter.id = BOOK_ID;

  // Stream books with minimal projection
  const cursor = db.collection('books')
    .find(filter, {
      projection: { id: 1, title: 1, pages_count: 1, pages_ocr: 1 },
      noCursorTimeout: true,
    })
    .limit(LIMIT === Infinity ? 0 : LIMIT);

  // Count first
  const total = BOOK_ID ? 1 : await db.collection('books').countDocuments(filter);
  console.log(`[embed] ${total} books to process (${SAMPLES_PER_BOOK} samples each)`);

  if (DRY_RUN) {
    console.log('[embed] Dry run — exiting');
    await client.close();
    return;
  }

  let processed = 0;
  let failed = 0;
  let totalTokensEstimate = 0;
  const startTime = Date.now();

  // Process in batches of CONCURRENCY books
  let bookBatch = [];

  for await (const book of cursor) {
    bookBatch.push(book);

    if (bookBatch.length >= CONCURRENCY) {
      await processBatch(db, bookBatch);
      bookBatch = [];
    }
  }

  // Process remaining
  if (bookBatch.length > 0) {
    await processBatch(db, bookBatch);
  }

  async function processBatch(db, books) {
    // 1. Sample pages for all books in this batch
    const bookPages = [];
    for (const book of books) {
      const pages = await samplePages(db, book.id, book.pages_count, SAMPLES_PER_BOOK);
      if (pages.length === 0) {
        console.warn(`[embed] ${book.id} "${book.title?.slice(0, 40)}" — no OCR pages found, skipping`);
        failed++;
        continue;
      }
      bookPages.push({ book, pages });
    }

    if (bookPages.length === 0) return;

    // 2. Flatten all texts for a single batch embed call
    const allTexts = [];
    const bookBoundaries = []; // [startIndex, endIndex] per book
    for (const { pages } of bookPages) {
      const start = allTexts.length;
      for (const p of pages) {
        allTexts.push(p.ocr.data);
      }
      bookBoundaries.push([start, allTexts.length]);
    }

    // 3. Embed all texts at once
    let allVectors;
    try {
      allVectors = await batchEmbed(allTexts);
    } catch (err) {
      console.error(`[embed] Batch embed failed:`, err.message);
      failed += bookPages.length;
      return;
    }

    // 4. Compute fingerprints and write to DB
    const bulkOps = [];
    for (let i = 0; i < bookPages.length; i++) {
      const { book, pages } = bookPages[i];
      const [start, end] = bookBoundaries[i];
      const vectors = allVectors.slice(start, end);
      const fingerprint = averageVectors(vectors);

      bulkOps.push({
        updateOne: {
          filter: { id: book.id },
          update: {
            $set: {
              'embedding.fingerprint': fingerprint,
              'embedding.model': SEMANTIC_MODEL,
              'embedding.dimensions': SEMANTIC_DIMENSIONS,
              'embedding.sampled_pages': pages.length,
              'embedding.embedded_at': new Date(),
            },
          },
        },
      });

      const charCount = pages.reduce((sum, p) => sum + (p.ocr?.data?.length || 0), 0);
      totalTokensEstimate += Math.ceil(charCount / 4);
    }

    if (bulkOps.length > 0) {
      await db.collection('books').bulkWrite(bulkOps);
    }

    processed += bookPages.length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (processed / (elapsed || 1)).toFixed(1);
    const costEstimate = (totalTokensEstimate * 0.15 / 1e6).toFixed(3);
    console.log(
      `[embed] ${processed}/${total} books (${rate}/s, ~$${costEstimate}, ${elapsed}s elapsed)`
    );
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const costEstimate = (totalTokensEstimate * 0.15 / 1e6).toFixed(2);
  console.log(`\n[embed] Done. ${processed} embedded, ${failed} failed, ~$${costEstimate} estimated cost, ${totalElapsed}s`);

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
