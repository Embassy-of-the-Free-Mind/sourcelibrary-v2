#!/usr/bin/env node
/**
 * Rebuild books_catalog in Supabase from MongoDB.
 *
 * This is a one-shot repair script. It:
 * 1. Reads ALL visible books from MongoDB
 * 2. Upserts them into Supabase (no deletion)
 * 3. Reports final counts
 *
 * Safe to run multiple times — upsert is idempotent.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/migration/rebuild-books-catalog.mjs
 */

import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co').trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!MONGODB_URI || !SUPABASE_SERVICE_KEY) {
  console.error('Missing MONGODB_URI or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const BATCH_SIZE = 200;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

function extractSummaryText(book) {
  const indexBrief = book.index?.bookSummary?.brief;
  if (indexBrief) return indexBrief;
  const readingOverview = book.reading_summary?.overview;
  if (readingOverview) return readingOverview;
  if (typeof book.summary === 'string') return book.summary;
  if (book.summary?.data) return book.summary.data;
  return null;
}

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
    // #4166 — paired with `pages_translated_es: 1` in the projection below.
    pages_translated_es: book.pages_translated_es || 0,
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
    contributing_library: book.contributing_library || book.image_source?.contributing_library || null,
    summary_text: extractSummaryText(book),
    publisher: book.publisher || null,
    place_published: book.place_published || null,
    doi: book.doi || null,
    work_id: book.work_id || null,
    resource_type: book.resource_type || null,
    source_url: book.image_source?.source_url || null,
    provider_name: book.image_source?.provider_name || null,
    image_attribution: book.image_source?.attribution || null,
    image_license: book.image_source?.license || null,
    cover_image: book.cover_image || null,
    dedication: book.dedication || null,
    subtitle: book.subtitle || null,
    source_work_dates: Array.isArray(book.source_work_dates) ? book.source_work_dates : null,
    ft_disposition: book.translation_verification?.disposition || null,
    ft_reasoning: book.translation_verification?.reasoning || null,
    ft_verdict: book.first_translation?.verdict || null,
    ft_evidence_strength: book.first_translation?.evidence_strength || null,
    ft_our_completeness: book.first_translation?.our_completeness || null,
    ft_source_screen: book.source_language_screen?.verdict || null,
    ft_translator_screen: book.translator_author_screen?.verdict || null,
    description: book.ai_metadata?.description || book.description || null,
    subject_keywords: Array.isArray(book.subject_keywords) ? book.subject_keywords : null,
    translation_pct: (() => {
      const denom = (book.pages_count || 0) - (book.pages_blank || 0);
      return denom > 0 ? Math.round(((book.pages_translated || 0) / denom) * 100) : 0;
    })(),
    ocr_pct: (() => {
      const denom = (book.pages_count || 0) - (book.pages_blank || 0);
      return denom > 0 ? Math.round(((book.pages_ocr || 0) / denom) * 100) : 0;
    })(),
    pipeline_status: book.pipeline_auto?.status || null,
    needs_splitting: book.needs_splitting === true,
  };
}

const projection = {
  id: 1, slug: 1, title: 1, display_title: 1, author: 1,
  thumbnail: 1, thumbnail_blob: 1, photo: 1, language: 1, year: 1, published: 1,
  read_count: 1, pages_blank: 1,
  pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_translated_es: 1,
  is_first_translation: 1, visible: 1, quality_score: 1,
  last_translation_at: 1, updated_at: 1, created_at: 1,
  categories: 1, collections: 1, collection_relevance: 1,
  'image_source.provider': 1,
  contributing_library: 1,
  'image_source.contributing_library': 1,
  'image_source.source_url': 1,
  'image_source.provider_name': 1,
  'image_source.attribution': 1,
  'image_source.license': 1,
  'pipeline_auto.status': 1,
  needs_splitting: 1,
  summary: 1, 'index.bookSummary.brief': 1, 'reading_summary.overview': 1,
  publisher: 1, place_published: 1, doi: 1, work_id: 1,
  resource_type: 1, cover_image: 1, dedication: 1, subtitle: 1,
  source_work_dates: 1,
  'translation_verification.disposition': 1, 'translation_verification.reasoning': 1,
  // Graded FT verdict + screens (#3726 Tier 3) — pure projections; the render
  // decision lives in src/lib/first-translation/render.ts, never here.
  'first_translation.verdict': 1, 'first_translation.evidence_strength': 1,
  'first_translation.our_completeness': 1,
  'source_language_screen.verdict': 1, 'translator_author_screen.verdict': 1,
  'ai_metadata.description': 1, description: 1, subject_keywords: 1,
};

const start = Date.now();
const mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 2 });
await mongoClient.connect();
const db = mongoClient.db('bookstore');

const expectedCount = await db.collection('books').countDocuments({ visible: true });
console.log(`MongoDB visible books: ${expectedCount}`);

const cursor = db.collection('books')
  .find({ visible: true }, { projection })
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
      console.error(`Batch error at ${synced}: ${error.message}`);
      errors += batch.length;
    } else {
      synced += batch.length;
    }
    batch = [];
    if (synced % 2000 === 0) {
      console.log(`  ...${synced} synced`);
    }
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

// Verify
const { count: sbCount } = await supabase.from('books_catalog').select('*', { count: 'exact', head: true });
const { count: sbTranslated } = await supabase.from('books_catalog').select('*', { count: 'exact', head: true }).gt('pages_translated', 0);

console.log(`\nRebuild complete in ${elapsed}s:`);
console.log(`  MongoDB visible: ${expectedCount}`);
console.log(`  Synced: ${synced}, Errors: ${errors}`);
console.log(`  Supabase total: ${sbCount}`);
console.log(`  Supabase translated>0: ${sbTranslated}`);

if (Math.abs(synced - expectedCount) > 10) {
  console.warn(`\n⚠ Synced count (${synced}) differs from expected (${expectedCount}) — concurrent writes may have occurred during rebuild.`);
}
