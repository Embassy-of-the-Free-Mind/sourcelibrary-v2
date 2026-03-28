#!/usr/bin/env node
/**
 * Embed page-level OCR and/or translation text in a single pass.
 *
 * For each page, embeds whichever fields have data (OCR, translation, or both).
 * Uses book-batch iteration to avoid Atlas cursor timeouts.
 *
 * Cost: ~$175 for both fields on all pages with data.
 * Storage: ~46 GB (OCR ~31 GB + translation ~15 GB) as BSON double arrays.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/embed-pages.mjs
 *   set -a; source .env.production.local; set +a; node scripts/embed-pages.mjs --field ocr
 *   set -a; source .env.production.local; set +a; node scripts/embed-pages.mjs --field translation
 *
 * Options:
 *   --field F       "ocr", "translation", or "both" (default: both)
 *   --limit N       Process at most N pages (default: all)
 *   --dry-run       Count pages without embedding
 *   --book-id ID    Only process pages for this book
 *   --batch-size N  Texts per API call (default: 100, max 100)
 *   --workers N     Concurrent books to process (default: 5)
 */

import { MongoClient } from 'mongodb';

const SEMANTIC_MODEL = 'gemini-embedding-001';
const MAX_TEXT_CHARS = 30000;

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}

const FIELD = getArg('field') || 'both';
if (!['ocr', 'translation', 'both'].includes(FIELD)) {
  console.error('Usage: node scripts/embed-pages.mjs [--field ocr|translation|both]');
  process.exit(1);
}

const DO_OCR = FIELD === 'ocr' || FIELD === 'both';
const DO_TRANS = FIELD === 'translation' || FIELD === 'both';

const DRY_RUN = args.includes('--dry-run');
const LIMIT = getArg('limit') ? parseInt(getArg('limit')) : Infinity;
const BOOK_ID = getArg('book-id');
const BATCH_SIZE = Math.min(getArg('batch-size') ? parseInt(getArg('batch-size')) : 100, 100);
const WORKERS = getArg('workers') ? parseInt(getArg('workers')) : 5;

// --- Embedding helpers ---

let apiKeys = [];
let keyIndex = 0;
const keyCooldowns = new Map();

function loadApiKeys() {
  if (process.env.GEMINI_API_KEY) apiKeys.push(process.env.GEMINI_API_KEY);
  for (let i = 2; i <= 10; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (k) apiKeys.push(k);
  }
  // Also use TIER3 key for embedding (high quota)
  if (process.env.GEMINI_API_KEY_TIER3) apiKeys.push(process.env.GEMINI_API_KEY_TIER3);
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
  return apiKeys[keyIndex];
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

let _GoogleGenerativeAI;
async function getSDK() {
  if (!_GoogleGenerativeAI) {
    const mod = await import('@google/generative-ai');
    _GoogleGenerativeAI = mod.GoogleGenerativeAI;
  }
  return _GoogleGenerativeAI;
}

async function batchEmbed(texts) {
  const GoogleGenerativeAI = await getSDK();
  const results = [];

  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    let lastErr;

    for (let retry = 0; retry < 5; retry++) {
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
          const wait = 2000 * (retry + 1);
          console.warn(`[embed] Rate limited, waiting ${wait / 1000}s (${retry + 1}/5)`);
          await sleep(wait);
          continue;
        }
        throw err;
      }
    }
    if (lastErr) throw lastErr;
  }

  return results;
}

// --- Main ---

async function main() {
  loadApiKeys();
  console.log(`[embed] Mode: ${FIELD} | batch size: ${BATCH_SIZE}`);

  const mongoClient = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await mongoClient.connect();
  const db = mongoClient.db('bookstore');

  // Get list of book IDs to process (avoids long cursor on pages)
  let bookIds;
  if (BOOK_ID) {
    bookIds = [BOOK_ID];
  } else {
    console.log('[embed] Fetching book list...');
    const bookFilter = { pages_count: { $gt: 0 } };
    if (DO_OCR) bookFilter.pages_ocr = { $gt: 0 };
    const books = await db.collection('books')
      .find(bookFilter, { projection: { id: 1 }, noCursorTimeout: true })
      .toArray();
    bookIds = books.map(b => b.id);
    console.log(`[embed] ${bookIds.length} books to scan`);
  }

  let totalProcessed = 0;
  let totalFailed = 0;
  let totalTokens = 0;
  let totalSkipped = 0;
  let booksCompleted = 0;
  const startTime = Date.now();

  // Parallel worker pool — process N books concurrently
  console.log(`[embed] Starting ${WORKERS} workers`);
  let bookIndex = 0;

  async function processBook(bookId) {
    const orConditions = [];
    if (DO_OCR) {
      orConditions.push({
        'ocr.data': { $exists: true, $ne: '' },
        'embedding.ocr': { $exists: false },
      });
    }
    if (DO_TRANS) {
      orConditions.push({
        'translation.data': { $exists: true, $ne: '' },
        'embedding.translation': { $exists: false },
      });
    }

    const projection = { _id: 1, page_number: 1 };
    if (DO_OCR) projection['ocr.data'] = 1;
    if (DO_TRANS) projection['translation.data'] = 1;

    const pages = await db.collection('pages')
      .find({ book_id: bookId, $or: orConditions }, { projection })
      .sort({ page_number: 1 })
      .toArray();

    if (pages.length === 0) return { processed: 0, failed: 0, tokens: 0, skipped: 0 };

    let result = { processed: 0, failed: 0, tokens: 0, skipped: 0 };
    for (let pi = 0; pi < pages.length; pi += BATCH_SIZE) {
      const batch = pages.slice(pi, pi + BATCH_SIZE);
      const r = await processPageBatch(db, batch);
      result.processed += r.processed;
      result.failed += r.failed;
      result.tokens += r.tokens;
      result.skipped += r.skipped;
    }
    return result;
  }

  async function worker() {
    while (true) {
      const bi = bookIndex++;
      if (bi >= bookIds.length || totalProcessed >= LIMIT) break;

      const bookId = bookIds[bi];
      try {
        const result = await processBook(bookId);
        totalProcessed += result.processed;
        totalFailed += result.failed;
        totalTokens += result.tokens;
        totalSkipped += result.skipped;
      } catch (err) {
        console.error(`[embed] Book ${bookId} error:`, err.message);
        totalFailed++;
      }

      booksCompleted++;
      if (booksCompleted % 50 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const rate = (totalProcessed / (elapsed || 1)).toFixed(1);
        const cost = (totalTokens * 0.15 / 1e6).toFixed(3);
        console.log(
          `[embed] ${booksCompleted}/${bookIds.length} books | ${totalProcessed.toLocaleString()} pages (${rate}/s, ~$${cost}, ${elapsed}s)`
        );
      }
    }
  }

  // Launch workers
  const workers = [];
  for (let i = 0; i < WORKERS; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const cost = (totalTokens * 0.15 / 1e6).toFixed(2);
  console.log(`\n[embed] Done.`);
  console.log(`  Embedded: ${totalProcessed.toLocaleString()}`);
  console.log(`  Skipped (already done): ${totalSkipped.toLocaleString()}`);
  console.log(`  Failed: ${totalFailed}`);
  console.log(`  Cost: ~$${cost}`);
  console.log(`  Time: ${elapsed}s`);

  await mongoClient.close();
}

async function processPageBatch(db, pages) {
  // Collect all texts to embed, tracking which page/field each belongs to
  const embedJobs = []; // { pageIdx, field, text }

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];

    if (DO_OCR && page.ocr?.data && !page.embedding?.ocr) {
      embedJobs.push({ pageIdx: i, field: 'ocr', text: page.ocr.data });
    }
    if (DO_TRANS && page.translation?.data && !page.embedding?.translation) {
      embedJobs.push({ pageIdx: i, field: 'translation', text: page.translation.data });
    }
  }

  if (embedJobs.length === 0) {
    return { processed: 0, failed: 0, tokens: 0, skipped: pages.length };
  }

  // Embed all texts in one batch call
  let vectors;
  try {
    vectors = await batchEmbed(embedJobs.map(j => j.text));
  } catch (err) {
    console.error(`[embed] Batch failed:`, err.message);
    return { processed: 0, failed: pages.length, tokens: 0, skipped: 0 };
  }

  // Group embeddings by page for bulk write
  const pageUpdates = new Map(); // pageIdx -> { ocr?: vector, translation?: vector }
  let tokens = 0;

  for (let i = 0; i < embedJobs.length; i++) {
    const job = embedJobs[i];
    const update = pageUpdates.get(job.pageIdx) || {};
    update[job.field] = vectors[i];
    pageUpdates.set(job.pageIdx, update);
    tokens += Math.ceil(job.text.length / 4);
  }

  // Build bulk write ops
  const bulkOps = [];
  for (const [pageIdx, updates] of pageUpdates) {
    const page = pages[pageIdx];
    const $set = {
      'embedding.model': SEMANTIC_MODEL,
      'embedding.embedded_at': new Date(),
    };
    if (updates.ocr) $set['embedding.ocr'] = updates.ocr;
    if (updates.translation) $set['embedding.translation'] = updates.translation;

    bulkOps.push({
      updateOne: {
        filter: { _id: page._id },
        update: { $set },
      },
    });
  }

  if (bulkOps.length > 0) {
    await db.collection('pages').bulkWrite(bulkOps, { ordered: false });
  }

  return { processed: bulkOps.length, failed: 0, tokens, skipped: 0 };
}

if (!DRY_RUN) {
  main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
} else {
  // Dry run mode
  (async () => {
    loadApiKeys();
    const mongoClient = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    await mongoClient.connect();
    const db = mongoClient.db('bookstore');

    if (DO_OCR) {
      const ocrCount = await db.collection('pages').countDocuments(
        { 'ocr.data': { $exists: true, $ne: '' }, 'embedding.ocr': { $exists: false } },
        { maxTimeMS: 300000 }
      );
      console.log(`[dry-run] OCR pages to embed: ${ocrCount.toLocaleString()}`);
    }
    if (DO_TRANS) {
      const transCount = await db.collection('pages').countDocuments(
        { 'translation.data': { $exists: true, $ne: '' }, 'embedding.translation': { $exists: false } },
        { maxTimeMS: 300000 }
      );
      console.log(`[dry-run] Translation pages to embed: ${transCount.toLocaleString()}`);
    }

    await mongoClient.close();
  })().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
