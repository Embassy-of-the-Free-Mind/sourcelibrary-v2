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
 *   --missing-only Process only books that have pages with embedding IS NULL (~3-4h vs 85h for --full)
 *   --book ID     Process a single book
 *   --limit N     Stop after N pages
 *   --dry-run     Count pages without embedding
 *
 * Env: MONGODB_URI, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL, GEMINI_API_KEY
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
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

if (!MONGODB_URI || !SUPABASE_KEY || !GEMINI_KEY) {
  console.error('Missing env: MONGODB_URI, SUPABASE_SERVICE_ROLE_KEY, or GEMINI_API_KEY');
  process.exit(1);
}

const args = process.argv.slice(2);
const FULL_MODE = args.includes('--full');
const MISSING_ONLY = args.includes('--missing-only');
const DRY_RUN = args.includes('--dry-run');
const BOOK_ID = args.find((_, i, a) => a[i - 1] === '--book');
const LIMIT = parseInt(args.find((_, i, a) => a[i - 1] === '--limit') || '0') || 0;
const WORKER_ID = parseInt(args.find((_, i, a) => a[i - 1] === '--worker-id') || '0');
const WORKER_COUNT = parseInt(args.find((_, i, a) => a[i - 1] === '--worker-count') || '1');

const EMBED_BATCH_SIZE = 50; // Gemini batchEmbedContents limit is 100, use 50 for safety
const UPSERT_BATCH_SIZE = 10; // Small batches for Supabase — HNSW index updates are expensive
const DIMS = 768;
const MODEL = 'gemini-embedding-2-preview';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents?key=${GEMINI_KEY}`;

// Circuit breaker: abort if too many consecutive Supabase failures
const MAX_CONSECUTIVE_FAILURES = 10;
const SUPABASE_BACKOFF_BASE = 2000; // ms

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// Direct PG client for writes (bypasses REST API 8s timeout)
let pgClient = null;

async function getPgClient() {
  if (pgClient) return pgClient;
  if (!SUPABASE_DB_URL) return null;

  try {
    const { default: pg } = await import('pg');
    pgClient = new pg.Client({
      connectionString: SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false },
    });
    await pgClient.connect();
    await pgClient.query('SET statement_timeout = 30000'); // PgBouncer rejects startup params — must SET after connect
    console.log('Using direct PG for writes (bypasses REST API timeout)');
    return pgClient;
  } catch (e) {
    console.warn(`Direct PG unavailable (${e.message}), falling back to REST API`);
    return null;
  }
}

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
console.log(`Mode: ${FULL_MODE ? 'full' : MISSING_ONLY ? 'missing-only' : BOOK_ID ? 'book ' + BOOK_ID : 'incremental'}${WORKER_COUNT > 1 ? ` (worker ${WORKER_ID}/${WORKER_COUNT})` : ''}`);

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
} else if (MISSING_ONLY) {
  // Fetch (book_id, page_id) pairs where embedding IS NULL via direct PG.
  // We limit MongoDB by book_id ($in) to keep the stream small, then filter
  // in JS by page_id so we ONLY embed pages that actually need it — not all
  // pages of any book that has at least one missing embedding.
  console.log('Fetching page_ids with missing embeddings via direct PG...');
  const pg = await getPgClient();
  if (!pg) {
    console.error('SUPABASE_DB_URL required for --missing-only (REST pagination is too slow on 4M rows)');
    process.exit(1);
  }
  const { rows } = await pg.query(
    'SELECT book_id, page_id FROM page_translations WHERE embedding IS NULL'
  );
  if (rows.length === 0) {
    console.log('No pages with missing embeddings found. All caught up.');
    await mongoClient.close();
    process.exit(0);
  }
  // Partition books across workers when parallelizing. Each worker owns a
  // disjoint slice of book_ids — no coordination needed at runtime.
  const allBookIds = [...new Set(rows.map(r => r.book_id))].sort();
  let myBookIds = allBookIds;
  if (WORKER_COUNT > 1) {
    myBookIds = allBookIds.filter((_, i) => i % WORKER_COUNT === WORKER_ID);
    console.log(`Worker ${WORKER_ID}/${WORKER_COUNT}: ${myBookIds.length.toLocaleString()}/${allBookIds.length.toLocaleString()} books`);
  }
  const myBookSet = new Set(myBookIds);
  const myRows = rows.filter(r => myBookSet.has(r.book_id));
  globalThis.MISSING_PAGE_IDS = new Set(myRows.map(r => r.page_id));
  pageQuery.book_id = { $in: myBookIds };
  console.log(`Processing ${myRows.length.toLocaleString()} missing pages across ${myBookIds.length.toLocaleString()} books`);
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
    translation_summary: 1,
    translation_keywords: 1,
  })
  .batchSize(EMBED_BATCH_SIZE * 2);

let processed = 0;
let embedded = 0;
let skipped = 0;
let errors = 0;
let batch = [];
let consecutiveFailures = 0;
let supabaseBackoff = 0;

for await (const page of cursor) {
  if (LIMIT && processed >= LIMIT) break;

  // In --missing-only mode, only embed pages that actually lack an embedding
  // (the MongoDB query is scoped to candidate books, but most of their pages
  // already have valid embeddings — skip those)
  if (MISSING_ONLY && !globalThis.MISSING_PAGE_IDS.has(page.id)) {
    skipped++;
    processed++;
    continue;
  }

  const ocrText = cleanText(page.ocr?.data);
  const translationText = cleanText(page.translation?.data);

  // Skip pages with no usable text
  if (ocrText.length < 20 && translationText.length < 20) {
    skipped++;
    processed++;
    continue;
  }

  const book = await getBook(page.book_id);

  // Compose embedding text: translation (or OCR) + structured metadata
  // The summary and keywords sharpen the vector for concept-level matching
  let textToEmbed = translationText.length >= 20 ? translationText : ocrText;

  // Prepend metadata if available (compact, high-signal)
  const meta = [];
  if (page.translation_summary) meta.push(page.translation_summary);
  if (page.translation_keywords?.length) meta.push(`Keywords: ${page.translation_keywords.join(', ')}`);
  if (meta.length) textToEmbed = meta.join('\n') + '\n\n' + textToEmbed;

  batch.push({ page, text: textToEmbed, book, hasTranslation: translationText.length >= 20 });

  if (batch.length >= EMBED_BATCH_SIZE) {
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
if (pgClient) await pgClient.end();
const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`\nDone: ${embedded.toLocaleString()} embedded, ${skipped} skipped, ${errors} errors, ${elapsed}s`);

// After a large full backfill, rebuild the HNSW index if it's missing
if (FULL_MODE && embedded > 10000) {
  await rebuildHnswIndex();
}

// ── HNSW index rebuild ──────────────────────────────────────────────

async function rebuildHnswIndex() {
  const pgUrl = SUPABASE_DB_URL;
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

// ── Supabase write (PG direct or REST fallback) ─────────────────────

async function upsertToSupabase(rows) {
  const client = await getPgClient();

  if (client) {
    // Direct PG: upsert with parameterized query, one row at a time
    // (pg doesn't support multi-row upsert with vector columns easily)
    for (const row of rows) {
      await client.query(
        `INSERT INTO page_translations (page_id, book_id, page_number, translation, embedding, book_title, book_author, book_language, book_year, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (page_id) DO UPDATE SET
           book_id = EXCLUDED.book_id,
           page_number = EXCLUDED.page_number,
           translation = EXCLUDED.translation,
           embedding = EXCLUDED.embedding,
           book_title = EXCLUDED.book_title,
           book_author = EXCLUDED.book_author,
           book_language = EXCLUDED.book_language,
           book_year = EXCLUDED.book_year,
           updated_at = EXCLUDED.updated_at`,
        [
          row.page_id, row.book_id, row.page_number,
          row.translation, row.embedding,
          row.book_title, row.book_author, row.book_language, row.book_year,
          row.updated_at,
        ]
      );
    }
    return;
  }

  // REST API fallback: small batches to avoid timeout
  const { error } = await supabase
    .from('page_translations')
    .upsert(rows, { onConflict: 'page_id' });

  if (error) throw new Error(error.message);
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

    // Upsert in small sub-batches to avoid overwhelming Supabase
    let batchErrors = 0;
    for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
      const chunk = rows.slice(i, i + UPSERT_BATCH_SIZE);
      try {
        await upsertToSupabase(chunk);
        consecutiveFailures = 0;
        supabaseBackoff = 0;
      } catch (e) {
        consecutiveFailures++;
        batchErrors += chunk.length;
        console.error(`  Supabase upsert error (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${e.message}`);

        // Exponential backoff on Supabase errors
        supabaseBackoff = Math.min(SUPABASE_BACKOFF_BASE * Math.pow(2, consecutiveFailures - 1), 120000);
        console.log(`  Backing off ${(supabaseBackoff / 1000).toFixed(0)}s...`);
        await sleep(supabaseBackoff);

        // Circuit breaker: abort if Supabase is consistently failing
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.error(`\nABORTING: ${MAX_CONSECUTIVE_FAILURES} consecutive Supabase failures — Supabase is overloaded.`);
          console.error('Fix the issue and re-run. Remaining pages will be picked up on next incremental run.');
          await mongoClient.close();
          if (pgClient) await pgClient.end();
          process.exit(1);
        }

        // Reconnect PG client on failure (connection may have dropped)
        if (pgClient) {
          try { await pgClient.end(); } catch {}
          pgClient = null;
        }
        continue;
      }
    }

    errors += batchErrors;
    embedded += items.length - batchErrors;
  } catch (e) {
    console.error(`  Error: ${e.message}`);
    if (e.message.includes('429') || e.message.includes('quota') || e.message.includes('RESOURCE_EXHAUSTED')) {
      console.log('  Gemini rate limited — waiting 10s...');
      await sleep(10000);
      return processBatch(items); // Retry
    }
    errors += items.length;
  }
}
