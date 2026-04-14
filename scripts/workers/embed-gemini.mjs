#!/usr/bin/env node
/**
 * Embed pages for semantic search using Gemini embedding-2-preview.
 *
 * Embeds BOTH ocr.data and translation.data per page into Supabase
 * page_translations table. Uses Gemini API (free tier, 768 dims).
 *
 * Replaces the old e5-base backfill (embed-translations.mjs).
 * The Gemini model is much better for Latin, Greek, Arabic, Sanskrit.
 *
 * Cost: $0 (free tier, rate-limited to ~13 texts/sec sustained).
 * Time: ~5-6 days for full 3M-page backfill.
 *
 * Modes:
 *   --full        Process all pages with OCR or translation
 *   --incremental Process pages newer than latest in Supabase (default)
 *   --book ID     Process a single book
 *   --limit N     Stop after N pages
 *   --dry-run     Count pages without embedding
 *
 * Env: MONGODB_URI, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY
 *
 * Run on Hetzner:
 *   set -a; source .env.production.local; set +a
 *   node scripts/workers/embed-gemini.mjs --full
 */

import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

// ── Config ──────────────────────────────────────────────────────────

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const GEMINI_KEY = process.env.GEMINI_API_KEY;

if (!MONGODB_URI || !SUPABASE_KEY || !GEMINI_KEY) {
  console.error('Missing env: MONGODB_URI, SUPABASE_SERVICE_ROLE_KEY, or GEMINI_API_KEY');
  process.exit(1);
}

const args = process.argv.slice(2);
const FULL_MODE = args.includes('--full');
const DRY_RUN = args.includes('--dry-run');
const BOOK_ID = args.find((_, i, a) => a[i - 1] === '--book');
const LIMIT = parseInt(args.find((_, i, a) => a[i - 1] === '--limit') || '0') || 0;

const BATCH_SIZE = 50; // Gemini batchEmbedContents limit is 100, use 50 for safety
const DIMS = 768;
const MODEL = 'gemini-embedding-2-preview';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents?key=${GEMINI_KEY}`;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ── Gemini Embedding ────────────────────────────────────────────────

let rateLimitBackoff = 0;

async function embedBatch(texts) {
  const requests = texts.map(t => ({
    model: `models/${MODEL}`,
    content: { parts: [{ text: t }] },
    outputDimensionality: DIMS,
  }));

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
    signal: AbortSignal.timeout(30000),
  });

  if (res.status === 429) {
    rateLimitBackoff = Math.min(rateLimitBackoff + 5, 60);
    console.log(`  Rate limited — backing off ${rateLimitBackoff}s`);
    await sleep(rateLimitBackoff * 1000);
    return embedBatch(texts); // Retry
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 300)}`);
  }

  rateLimitBackoff = Math.max(0, rateLimitBackoff - 1); // Decay backoff on success

  const data = await res.json();
  if (!data.embeddings || data.embeddings.length !== texts.length) {
    throw new Error(`Expected ${texts.length} embeddings, got ${data.embeddings?.length || 0}`);
  }
  return data.embeddings.map(e => e.values);
}

// ── Helpers ──────────────────────────────────────────────────────────

function cleanText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/<[^>]+>/g, ' ')    // strip HTML/XML tags
    .replace(/\s+/g, ' ')        // collapse whitespace
    .trim()
    .slice(0, 8000);             // Gemini embedding-2 supports 8192 tokens
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getLastSyncTime() {
  const { data } = await supabase
    .from('page_translations')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);
  return data?.[0]?.updated_at ? new Date(data[0].updated_at) : null;
}

// ── Main ─────────────────────────────────────────────────────────────

const start = Date.now();
console.log(`Embedding model: ${MODEL} (${DIMS} dims)`);
console.log(`Mode: ${FULL_MODE ? 'full' : BOOK_ID ? 'book ' + BOOK_ID : 'incremental'}`);

const mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 3 });
await mongoClient.connect();
const db = mongoClient.db('bookstore');

// Build query — need pages with OCR or translation
const pageQuery = {
  $or: [
    { 'ocr.data': { $exists: true, $type: 'string' } },
    { 'translation.data': { $exists: true, $type: 'string' } },
  ],
};

if (BOOK_ID) {
  pageQuery.book_id = BOOK_ID;
  console.log(`Processing book: ${BOOK_ID}`);
} else if (!FULL_MODE) {
  const lastSync = await getLastSyncTime();
  if (lastSync) {
    // Use $or with both updated_at fields for incremental
    pageQuery.$and = [
      pageQuery.$or ? { $or: pageQuery.$or } : {},
      {
        $or: [
          { 'translation.updated_at': { $gt: lastSync } },
          { 'ocr.updated_at': { $gt: lastSync } },
        ],
      },
    ];
    delete pageQuery.$or;
    console.log(`Incremental from: ${lastSync.toISOString()}`);
  } else {
    console.log('No existing data — doing full backfill');
  }
}

if (DRY_RUN) {
  if (BOOK_ID) {
    const count = await db.collection('pages').countDocuments(pageQuery);
    console.log(`Would process ${count.toLocaleString()} pages`);
  } else {
    console.log('Counting skipped (too slow on full collection). Use --book ID to count.');
  }
  await mongoClient.close();
  process.exit(0);
}

// Book metadata cache
const bookCache = new Map();
async function getBook(bookId) {
  if (bookCache.has(bookId)) return bookCache.get(bookId);
  const book = await db.collection('books').findOne(
    { id: bookId },
    { projection: { title: 1, display_title: 1, author: 1, language: 1, year: 1 } }
  );
  const meta = book ? {
    title: book.display_title || book.title || 'Untitled',
    author: book.author || null,
    language: book.language || null,
    year: typeof book.year === 'number' ? book.year : null,
  } : { title: 'Unknown', author: null, language: null, year: null };
  bookCache.set(bookId, meta);
  return meta;
}

// Stream pages
const cursor = db.collection('pages')
  .find(pageQuery)
  .project({
    id: 1,
    book_id: 1,
    page_number: 1,
    'ocr.data': 1,
    'translation.data': 1,
    'translation.updated_at': 1,
    'ocr.updated_at': 1,
  })
  .batchSize(BATCH_SIZE * 2);

let processed = 0;
let embedded = 0;
let skipped = 0;
let errors = 0;
let batch = [];

for await (const page of cursor) {
  if (LIMIT && processed >= LIMIT) break;

  const ocrText = cleanText(page.ocr?.data);
  const translationText = cleanText(page.translation?.data);

  // Skip pages with no usable text
  if (ocrText.length < 20 && translationText.length < 20) {
    skipped++;
    processed++;
    continue;
  }

  const book = await getBook(page.book_id);

  // We embed whichever text is best: prefer translation, fall back to OCR
  // (embedding both would double storage; translation captures the meaning)
  const textToEmbed = translationText.length >= 20 ? translationText : ocrText;

  batch.push({ page, text: textToEmbed, book, hasTranslation: translationText.length >= 20 });

  if (batch.length >= BATCH_SIZE) {
    await processBatch(batch);
    batch = [];
  }

  processed++;
  if (processed % 500 === 0) {
    const elapsed = (Date.now() - start) / 1000;
    const rate = (embedded / elapsed).toFixed(1);
    console.log(`  ${processed.toLocaleString()} processed — ${embedded.toLocaleString()} embedded — ${skipped} skipped — ${rate}/sec — ${errors} errors`);
  }
}

if (batch.length > 0) await processBatch(batch);

await mongoClient.close();
const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`\nDone: ${embedded.toLocaleString()} embedded, ${skipped} skipped, ${errors} errors, ${elapsed}s`);

// After a large full backfill, rebuild the HNSW index if it's missing
if (FULL_MODE && embedded > 10000) {
  await rebuildHnswIndex();
}

// ── HNSW index rebuild ──────────────────────────────────────────────

async function rebuildHnswIndex() {
  const pgUrl = process.env.SUPABASE_DB_URL;
  if (!pgUrl) {
    console.log('\nSUPABASE_DB_URL not set — skipping HNSW index rebuild.');
    console.log('Run manually: CREATE INDEX idx_pt_embedding ON page_translations USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);');
    return;
  }

  try {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: pgUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();

    // Check if index already exists
    const { rows } = await client.query(
      "SELECT 1 FROM pg_indexes WHERE tablename = 'page_translations' AND indexname = 'idx_pt_embedding'"
    );

    if (rows.length > 0) {
      console.log('\nHNSW index already exists — skipping rebuild.');
      await client.end();
      return;
    }

    console.log('\nRebuilding HNSW index (this may take hours for millions of vectors)...');
    // Set a long statement timeout for index creation
    await client.query('SET statement_timeout = 0');
    await client.query(
      'CREATE INDEX idx_pt_embedding ON page_translations USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64)'
    );
    console.log('HNSW index rebuilt successfully.');
    await client.end();
  } catch (e) {
    console.error('HNSW index rebuild failed:', e.message);
    console.log('Run manually: CREATE INDEX idx_pt_embedding ON page_translations USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);');
  }
}

// ── Batch processor ──────────────────────────────────────────────────

async function processBatch(items) {
  try {
    const texts = items.map(i => i.text);
    const embeddings = await embedBatch(texts);

    const rows = items.map((item, i) => ({
      page_id: item.page.id,
      book_id: item.page.book_id,
      page_number: item.page.page_number,
      translation: (item.hasTranslation ? item.text : '').slice(0, 50000),
      embedding: JSON.stringify(embeddings[i]),
      book_title: item.book.title,
      book_author: item.book.author,
      book_language: item.book.language,
      book_year: item.book.year,
      updated_at: item.page.translation?.updated_at || item.page.ocr?.updated_at || new Date(),
    }));

    const { error } = await supabase
      .from('page_translations')
      .upsert(rows, { onConflict: 'page_id' });

    if (error) {
      console.error(`  Supabase upsert error: ${error.message}`);
      errors += items.length;
    } else {
      embedded += items.length;
    }
  } catch (e) {
    console.error(`  Error: ${e.message}`);
    if (e.message.includes('429') || e.message.includes('quota') || e.message.includes('RESOURCE_EXHAUSTED')) {
      console.log('  Rate limited — waiting 10s...');
      await sleep(10000);
      return processBatch(items); // Retry
    }
    errors += items.length;
  }
}
