#!/usr/bin/env node
/**
 * Embed translated pages for semantic search.
 *
 * Reads pages with translations from MongoDB, generates embeddings
 * using Gemini text-embedding-004, and upserts to Supabase
 * page_translations table with both text (for tsvector) and embedding
 * (for pgvector).
 *
 * Uses Gemini (not local model) to match the query-time embedding model
 * in /api/search/semantic. Model mismatch = broken similarity.
 *
 * Cost: ~$0.0001 per page → ~$60 for 600K pages.
 *
 * Modes:
 *   --full        Process all translated pages
 *   --incremental Process only pages newer than latest in Supabase (default)
 *   --book ID     Process a single book
 *   --limit N     Stop after N pages (for testing)
 *
 * Env: MONGODB_URI, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY
 */

import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

// ── Config ──────────────────────────────────────────────────────────

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!MONGODB_URI || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY) {
  console.error('Missing MONGODB_URI, SUPABASE_SERVICE_ROLE_KEY, or GEMINI_API_KEY');
  process.exit(1);
}

const args = process.argv.slice(2);
const FULL_MODE = args.includes('--full');
const BOOK_ID = args.find((_, i, a) => a[i - 1] === '--book');
const LIMIT = parseInt(args.find((_, i, a) => a[i - 1] === '--limit') || '0') || 0;
const EMBED_BATCH_SIZE = 50; // Gemini batch embed limit is 100, use 50 for safety

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// ── Gemini Embedding API ────────────────────────────────────────────

const EMBED_MODEL = 'gemini-embedding-001';

async function embedBatch(texts) {
  const requests = texts.map(text => ({
    model: `models/${EMBED_MODEL}`,
    content: { parts: [{ text: text.slice(0, 2048) }] },
    taskType: 'RETRIEVAL_DOCUMENT',
    outputDimensionality: 768,
  }));

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.embeddings.map(e => e.values);
}

// ── Helpers ──────────────────────────────────────────────────────────

function cleanTranslation(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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
console.log('Embedding model: Gemini text-embedding-004 (768 dims)');

const mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 3 });
await mongoClient.connect();
const db = mongoClient.db('bookstore');

let pageQuery = {
  'translation.data': { $exists: true, $type: 'string' },
};

if (BOOK_ID) {
  pageQuery.book_id = BOOK_ID;
  console.log(`Processing book: ${BOOK_ID}`);
} else if (!FULL_MODE) {
  const lastSync = await getLastSyncTime();
  if (lastSync) {
    pageQuery['translation.updated_at'] = { $gt: lastSync };
    console.log(`Incremental from: ${lastSync.toISOString()}`);
  } else {
    console.log('No existing data — doing full backfill');
  }
}

const total = LIMIT || (BOOK_ID ? await db.collection('pages').countDocuments(pageQuery) : 0);
if (total > 0) console.log(`${total.toLocaleString()} pages to process\n`);
else console.log('Streaming pages (count skipped for performance)\n');

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
// Don't sort on unindexed field — just stream in natural order
// For incremental mode, the $gt filter on translation.updated_at handles ordering
const cursor = db.collection('pages')
  .find(pageQuery)
  .project({ id: 1, book_id: 1, page_number: 1, 'translation.data': 1, 'translation.updated_at': 1 })
  .batchSize(EMBED_BATCH_SIZE);

let processed = 0;
let embedded = 0;
let errors = 0;
let batch = [];

for await (const page of cursor) {
  if (LIMIT && processed >= LIMIT) break;

  const text = cleanTranslation(page.translation?.data);
  if (text.length < 20) { processed++; continue; }

  const book = await getBook(page.book_id);
  batch.push({ page, text, book });

  if (batch.length >= EMBED_BATCH_SIZE) {
    await processBatch(batch);
    batch = [];
  }

  processed++;
  if (processed % 500 === 0) {
    const elapsed = (Date.now() - start) / 1000;
    const rate = (embedded / elapsed).toFixed(1);
    const pct = total > 0 ? ` (${((processed / total) * 100).toFixed(1)}%)` : '';
    console.log(`  ${processed.toLocaleString()} processed${pct} — ${embedded.toLocaleString()} embedded — ${rate} pages/sec`);
  }
}

if (batch.length > 0) await processBatch(batch);

await mongoClient.close();
const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`\nDone: ${embedded.toLocaleString()} embedded, ${errors} errors, ${elapsed}s`);

// ── Batch processor ──────────────────────────────────────────────────

async function processBatch(items) {
  try {
    const texts = items.map(i => i.text);
    const embeddings = await embedBatch(texts);

    const rows = items.map((item, i) => ({
      page_id: item.page.id,
      book_id: item.page.book_id,
      page_number: item.page.page_number,
      translation: item.text.slice(0, 50000),
      embedding: JSON.stringify(embeddings[i]),
      book_title: item.book.title,
      book_author: item.book.author,
      book_language: item.book.language,
      book_year: item.book.year,
      updated_at: item.page.translation?.updated_at || new Date(),
    }));

    const { error } = await supabase
      .from('page_translations')
      .upsert(rows, { onConflict: 'page_id' });

    if (error) {
      console.error(`  Batch error: ${error.message}`);
      errors += items.length;
    } else {
      embedded += items.length;
    }
  } catch (e) {
    console.error(`  Error: ${e.message}`);
    // Retry with smaller batch on rate limit
    if (e.message.includes('429') || e.message.includes('quota')) {
      console.log('  Rate limited — waiting 5s...');
      await new Promise(r => setTimeout(r, 5000));
      return processBatch(items); // Retry
    }
    errors += items.length;
  }
}
