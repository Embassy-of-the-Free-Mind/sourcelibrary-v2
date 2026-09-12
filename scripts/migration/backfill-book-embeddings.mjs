#!/usr/bin/env node
/**
 * Backfill book_embeddings table on Supabase from MongoDB book_indexes + books.
 *
 * Composes a rich text representation from enrichment data (summaries, vocabulary,
 * entities) and embeds it via Gemini embedding-2-preview (768 dims).
 *
 * For unenriched books, falls back to title + author + description + categories.
 *
 * Cost: BILLED, but small — one embedding per book, not per page. At $0.20/1M
 * input tokens and the measured 4.29 chars/token, ~17K books of summary text is
 * roughly $2-3 per full pass. (This line used to read "$0 (Gemini free tier)";
 * see .claude/docs/embeddings.md.) Time: ~20 min for 17K books.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/migration/backfill-book-embeddings.mjs
 *   node scripts/migration/backfill-book-embeddings.mjs --dry-run
 *   node scripts/migration/backfill-book-embeddings.mjs --book BOOK_ID
 *   node scripts/migration/backfill-book-embeddings.mjs --incremental
 *
 * Issue: #1158
 */

import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import {
  composeBookEmbeddingText as composeEmbeddingText,
  BOOK_INDEX_EMBEDDING_PROJECTION,
} from '../lib/book-embedding-text.mjs';

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
const DRY_RUN = args.includes('--dry-run');
const INCREMENTAL = args.includes('--incremental');
const BOOK_ID = args.find((_, i, a) => a[i - 1] === '--book');
const LIMIT = parseInt(args.find((_, i, a) => a[i - 1] === '--limit') || '0') || 0;

const BATCH_SIZE = 50; // Gemini batchEmbedContents limit is 100
const DIMS = 768;
const MODEL = 'gemini-embedding-2-preview';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents?key=${GEMINI_KEY}`;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ── Gemini Embedding ────────────────────────────────────────────────

let rateLimitBackoff = 0;

async function embedBatch(texts) {
  const requests = texts.map(text => ({
    model: `models/${MODEL}`,
    content: { parts: [{ text }] },
    outputDimensionality: DIMS,
  }));

  for (let attempt = 0; attempt < 3; attempt++) {
    if (rateLimitBackoff > 0) {
      await sleep(rateLimitBackoff);
      rateLimitBackoff = Math.max(0, rateLimitBackoff - 1000);
    }

    try {
      const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
        signal: AbortSignal.timeout(30000),
      });

      if (res.status === 429) {
        rateLimitBackoff = Math.min(60000, (rateLimitBackoff || 2000) * 2);
        console.warn(`  Rate limited, backing off ${rateLimitBackoff}ms`);
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`  Gemini error ${res.status}: ${body.slice(0, 200)}`);
        return null;
      }

      const data = await res.json();
      if (!data?.embeddings?.length) return null;

      // Decrease backoff on success
      rateLimitBackoff = Math.max(0, rateLimitBackoff - 500);

      return data.embeddings.map(e => e.values);
    } catch (err) {
      console.error(`  Embedding error (attempt ${attempt + 1}):`, err.message);
      await sleep(2000 * (attempt + 1));
    }
  }
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Text Composition ────────────────────────────────────────────────


// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  console.log('Connected to MongoDB and Supabase');

  // Build filter
  const bookFilter = {
    visible: true,
    $or: [
      { pages_count: { $gt: 0 } },
      { content_type: 'artwork' },
    ],
  };
  if (BOOK_ID) bookFilter.id = BOOK_ID;

  // Get books
  const bookProjection = {
    id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1,
    description: 1, summary: 1, categories: 1, quality_score: 1,
    'reading_summary.overview': 1,
    'index.bookSummary': 1, // legacy inline fallback
    // Artwork-specific fields for rich embedding
    content_type: 1, resource_type: 1, medium: 1, collections: 1,
    commons_description: 1, commons_categories: 1,
  };

  const books = await db.collection('books')
    .find(bookFilter)
    .project(bookProjection)
    .toArray();

  console.log(`Found ${books.length} visible books`);

  // If incremental, filter out books already in Supabase
  let bookIds = books.map(b => b.id);
  if (INCREMENTAL && !BOOK_ID) {
    // Fetch all existing book_ids from Supabase in batches
    const existingIds = new Set();
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data } = await supabase
        .from('book_embeddings')
        .select('book_id')
        .range(offset, offset + pageSize - 1);
      if (!data || data.length === 0) break;
      data.forEach(d => existingIds.add(d.book_id));
      offset += pageSize;
      if (data.length < pageSize) break;
    }
    console.log(`Supabase has ${existingIds.size} existing embeddings`);
    bookIds = bookIds.filter(id => !existingIds.has(id));
    console.log(`${bookIds.length} books need embedding`);
  }

  if (LIMIT > 0) bookIds = bookIds.slice(0, LIMIT);

  // Only the fields the composer reads (pageSummaries is huge and unused).
  // Lives beside the composer so a new field can't be added to one and not
  // the other — a projection that omits a source silently empties that line.
  const INDEX_PROJECTION = BOOK_INDEX_EMBEDDING_PROJECTION;

  const bookMap = new Map(books.map(b => [b.id, b]));

  if (DRY_RUN) {
    // For dry run, just count which books have indexes (lightweight query)
    const indexCount = await db.collection('book_indexes')
      .countDocuments(BOOK_ID ? { book_id: BOOK_ID } : {}, { maxTimeMS: 30000 });
    console.log(`\nDry run summary:`);
    console.log(`  ${bookIds.length} books to embed`);
    console.log(`  ${indexCount} with book_indexes (rich embedding)`);
    console.log(`  ${bookIds.length - indexCount} without (fallback: title+desc+categories)`);
    await mongo.close();
    return;
  }

  // Process in batches — fetch book_indexes per batch to avoid OOM
  let embedded = 0, skipped = 0, errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < bookIds.length; i += BATCH_SIZE) {
    const batchIds = bookIds.slice(i, i + BATCH_SIZE);

    // Fetch indexes for this batch only
    const indexDocs = await db.collection('book_indexes')
      .find({ book_id: { $in: batchIds } })
      .project(INDEX_PROJECTION)
      .maxTimeMS(15000)
      .toArray();
    const indexMap = new Map(indexDocs.map(d => [d.book_id, d]));

    const batchTexts = [];
    const batchBooks = [];

    for (const bookId of batchIds) {
      const book = bookMap.get(bookId);
      if (!book) continue;

      const indexData = indexMap.get(bookId) || book.index || null;
      const text = composeEmbeddingText(book, indexData);

      if (text.length < 10) {
        skipped++;
        continue;
      }

      batchTexts.push(text);
      batchBooks.push({ book, text, indexData });
    }

    if (batchTexts.length === 0) continue;

    const embeddings = await embedBatch(batchTexts);
    if (!embeddings) {
      errors += batchTexts.length;
      console.error(`  Failed to embed batch at offset ${i}`);
      continue;
    }

    // Upsert to Supabase
    const rows = batchBooks.map((item, idx) => {
      const book = item.book;
      const yearMatch = (book.published || '').match(/\d{3,4}/);
      return {
        book_id: book.id,
        title: book.display_title || book.title || '',
        author: book.author || '',
        year: yearMatch ? parseInt(yearMatch[0]) : null,
        language: book.language || null,
        summary_text: item.text,
        embedding: JSON.stringify(embeddings[idx]),
        metadata: {
          has_index: !!item.indexData,
          categories: book.categories || [],
          quality_score: book.quality_score || null,
          entity_counts: item.indexData ? {
            people: item.indexData.people?.length || 0,
            places: item.indexData.places?.length || 0,
            concepts: item.indexData.concepts?.length || 0,
            terms: item.indexData.entries?.length || 0,
          } : null,
        },
        updated_at: new Date().toISOString(),
      };
    });

    const { error } = await supabase.from('book_embeddings').upsert(rows, {
      onConflict: 'book_id',
    });

    if (error) {
      console.error(`  Supabase upsert error: ${error.message}`);
      errors += rows.length;
    } else {
      embedded += rows.length;
    }

    // Progress
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = embedded / elapsed;
    const remaining = ((bookIds.length - i - BATCH_SIZE) / rate) || 0;
    process.stdout.write(
      `\r  ${embedded}/${bookIds.length} embedded (${rate.toFixed(1)}/s, ~${Math.ceil(remaining / 60)}min left, ${errors} errors, ${skipped} skipped)`
    );

    // Gentle rate limiting
    await sleep(200);
  }

  console.log(`\n\nDone!`);
  console.log(`  Embedded: ${embedded}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Time: ${((Date.now() - startTime) / 1000).toFixed(0)}s`);

  await mongo.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
