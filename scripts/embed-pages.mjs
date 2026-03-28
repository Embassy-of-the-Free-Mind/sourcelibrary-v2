#!/usr/bin/env node
/**
 * Phase 2-3: Embed page-level OCR and translation text.
 *
 * Stores vectors on page documents for semantic search across the library.
 * - OCR embeddings: cross-lingual search (find Latin from English queries)
 * - Translation embeddings: English semantic search + RAG
 *
 * Cost: ~$55 for 1.2M translation pages, ~$120 for 2.6M OCR pages.
 * Storage: ~15 GB (translation) + ~31 GB (OCR) at 12KB per BSON double array.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/embed-pages.mjs --field translation
 *   set -a; source .env.production.local; set +a; node scripts/embed-pages.mjs --field ocr
 *
 * Options:
 *   --field F       "ocr" or "translation" (required)
 *   --limit N       Process at most N pages (default: all)
 *   --dry-run       Count pages without embedding
 *   --book-id ID    Only process pages for this book
 *   --batch-size N  Pages per API call (default: 100, max 100)
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

const FIELD = getArg('field');
if (!FIELD || !['ocr', 'translation'].includes(FIELD)) {
  console.error('Usage: node scripts/embed-pages.mjs --field ocr|translation');
  process.exit(1);
}

const DRY_RUN = args.includes('--dry-run');
const LIMIT = getArg('limit') ? parseInt(getArg('limit')) : Infinity;
const BOOK_ID = getArg('book-id');
const BATCH_SIZE = Math.min(getArg('batch-size') ? parseInt(getArg('batch-size')) : 100, 100);

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

async function batchEmbed(texts) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const results = [];

  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    let lastErr;

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
          console.warn(`[embed] Rate limited, retrying (${retry + 1}/3)`);
          await sleep(2000 * (retry + 1));
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

  const mongoClient = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await mongoClient.connect();
  const db = mongoClient.db('bookstore');

  const sourceField = FIELD === 'ocr' ? 'ocr.data' : 'translation.data';
  const embeddingPath = `embedding.${FIELD}`;

  // Find pages that have source data but no embedding yet
  const filter = {
    [sourceField]: { $exists: true, $ne: '' },
    [embeddingPath]: { $exists: false },
  };
  if (BOOK_ID) filter.book_id = BOOK_ID;

  // Estimate count (this can be slow on pages collection)
  console.log(`[embed] Counting ${FIELD} pages to embed...`);
  const total = await db.collection('pages').countDocuments(filter, { maxTimeMS: 120000 });
  console.log(`[embed] ${total.toLocaleString()} pages to embed`);

  if (DRY_RUN) {
    console.log('[embed] Dry run — exiting');
    await mongoClient.close();
    return;
  }

  const cursor = db.collection('pages')
    .find(filter, {
      projection: { id: 1, book_id: 1, page_number: 1, [sourceField]: 1 },
      noCursorTimeout: true,
    })
    .sort({ book_id: 1, page_number: 1 })
    .limit(LIMIT === Infinity ? 0 : LIMIT);

  let processed = 0;
  let failed = 0;
  let totalTokens = 0;
  const startTime = Date.now();
  let pageBatch = [];

  for await (const page of cursor) {
    pageBatch.push(page);

    if (pageBatch.length >= BATCH_SIZE) {
      await processBatch(pageBatch);
      pageBatch = [];
    }
  }

  if (pageBatch.length > 0) {
    await processBatch(pageBatch);
  }

  async function processBatch(pages) {
    const texts = pages.map(p => {
      const data = FIELD === 'ocr' ? p.ocr?.data : p.translation?.data;
      return data || '';
    }).filter(t => t.length > 0);

    if (texts.length === 0) return;

    let vectors;
    try {
      vectors = await batchEmbed(texts);
    } catch (err) {
      console.error(`[embed] Batch failed:`, err.message);
      failed += pages.length;
      return;
    }

    // Build bulk write
    const bulkOps = [];
    let vi = 0;
    for (const page of pages) {
      const data = FIELD === 'ocr' ? page.ocr?.data : page.translation?.data;
      if (!data) continue;

      bulkOps.push({
        updateOne: {
          filter: { _id: page._id },
          update: {
            $set: {
              [embeddingPath]: vectors[vi],
              'embedding.model': SEMANTIC_MODEL,
              'embedding.embedded_at': new Date(),
            },
          },
        },
      });

      totalTokens += Math.ceil(data.length / 4);
      vi++;
    }

    if (bulkOps.length > 0) {
      await db.collection('pages').bulkWrite(bulkOps, { ordered: false });
    }

    processed += bulkOps.length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (processed / (elapsed || 1)).toFixed(1);
    const cost = (totalTokens * 0.15 / 1e6).toFixed(3);
    const pct = total > 0 ? ((processed / total) * 100).toFixed(1) : '?';

    if (processed % (BATCH_SIZE * 10) === 0 || processed === total) {
      console.log(
        `[embed] ${processed.toLocaleString()}/${total.toLocaleString()} (${pct}%, ${rate}/s, ~$${cost}, ${elapsed}s)`
      );
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const cost = (totalTokens * 0.15 / 1e6).toFixed(2);
  console.log(`\n[embed] Done. ${processed.toLocaleString()} embedded, ${failed} failed, ~$${cost}, ${elapsed}s`);

  await mongoClient.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
