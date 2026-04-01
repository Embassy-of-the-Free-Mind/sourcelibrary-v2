#!/usr/bin/env node
/**
 * Sync books metadata from MongoDB → Supabase books_catalog.
 *
 * Mirrors the fields needed by the browse/library API so it can
 * read from Postgres instead of MongoDB. Only visible books with
 * pages are synced (~9K books, runs in seconds).
 *
 * Modes:
 *   --full   Sync all visible books (first run or rebuild)
 *   (default) Incremental — sync books updated since last sync
 *
 * Runs on Hetzner as part of supabase-sync.mjs, or standalone.
 *
 * Env: MONGODB_URI, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!MONGODB_URI || !SUPABASE_SERVICE_KEY) {
  console.error('Missing MONGODB_URI or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const FULL_MODE = process.argv.includes('--full');
const BATCH_SIZE = 200;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

function transformBook(book) {
  return {
    id: book.id,
    slug: book.slug || null,
    title: book.title || 'Untitled',
    display_title: book.display_title || null,
    author: book.author || null,
    thumbnail: book.thumbnail || null,
    thumbnail_blob: book.thumbnail_blob || null,
    language: book.language || null,
    year: typeof book.year === 'number' ? book.year : null,
    published: book.published || null,
    pages_count: book.pages_count || 0,
    pages_ocr: book.pages_ocr || 0,
    pages_translated: book.pages_translated || 0,
    pages_blank: book.pages_blank || 0,
    is_first_translation: book.is_first_translation === true,
    visible: book.visible === true,
    quality_score: book.quality_score || 0,
    photo: book.photo || null,
    read_count: book.read_count || 0,
    last_translation_at: book.last_translation_at || null,
    last_processed: book.updated_at || book.created_at || null,
    created_at: book.created_at || null,
    updated_at: book.updated_at || null,
    categories: Array.isArray(book.categories) ? book.categories : [],
    collections: Array.isArray(book.collections) ? book.collections : [],
    collection_relevance: book.collection_relevance || null,
    image_source_provider: book.image_source?.provider || null,
    contributing_library: book.image_source?.contributing_library || null,
  };
}

async function getLastSyncTime() {
  const { data } = await supabase
    .from('books_catalog')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);
  return data?.[0]?.updated_at ? new Date(data[0].updated_at) : null;
}

// ── Main ─────────────────────────────────────────────────────────────

const start = Date.now();
const mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 2 });
await mongoClient.connect();
const db = mongoClient.db('bookstore');

// Sync all visible books (not just those with pages) — browse/language pages need all of them
let query = { visible: true };

if (!FULL_MODE) {
  const lastSync = await getLastSyncTime();
  if (lastSync) {
    query.updated_at = { $gt: lastSync };
    console.log(`Incremental from: ${lastSync.toISOString()}`);
  } else {
    console.log('No existing data — doing full sync');
  }
}

const projection = {
  id: 1, slug: 1, title: 1, display_title: 1, author: 1,
  thumbnail: 1, thumbnail_blob: 1, photo: 1, language: 1, year: 1, published: 1,
  read_count: 1, pages_blank: 1,
  pages_count: 1, pages_ocr: 1, pages_translated: 1,
  is_first_translation: 1, visible: 1, quality_score: 1,
  last_translation_at: 1, updated_at: 1, created_at: 1,
  categories: 1, collections: 1, collection_relevance: 1,
  'image_source.provider': 1,
  'image_source.contributing_library': 1,
};

const cursor = db.collection('books')
  .find(query, { projection })
  .batchSize(BATCH_SIZE);

let synced = 0;
let errors = 0;
let batch = [];

for await (const book of cursor) {
  batch.push(transformBook(book));

  if (batch.length >= BATCH_SIZE) {
    const { error } = await supabase
      .from('books_catalog')
      .upsert(batch, { onConflict: 'id' });
    if (error) {
      console.error(`Batch error: ${error.message}`);
      errors += batch.length;
    } else {
      synced += batch.length;
    }
    batch = [];
  }
}

if (batch.length > 0) {
  const { error } = await supabase
    .from('books_catalog')
    .upsert(batch, { onConflict: 'id' });
  if (error) {
    console.error(`Batch error: ${error.message}`);
    errors += batch.length;
  } else {
    synced += batch.length;
  }
}

await mongoClient.close();
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

if (synced > 0 || errors > 0) {
  console.log(`[${new Date().toISOString()}] books_catalog: ${synced} synced, ${errors} errors (${elapsed}s)`);
}
