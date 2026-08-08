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

// Locally-sourced .env.production.local values can carry a literal "\n"
// suffix (vercel env pull escaping — same footgun as the R2 vars, #3000).
// A polluted SUPABASE_URL makes every upsert a phantom success: this script
// reported "31,236 synced" on 2026-07-05 while writing nothing.
const cleanEnv = (v) => (v || '').replace(/\\n/g, '').trim();

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL) || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_SERVICE_KEY = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

if (!MONGODB_URI || !SUPABASE_SERVICE_KEY) {
  console.error('Missing MONGODB_URI or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const FULL_MODE = process.argv.includes('--full');
const BATCH_SIZE = 200;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

function extractSummaryText(book) {
  // Prefer the fields the current enrich/promote pipeline actually maintains:
  // book.summary.data (the brief) and book.reading_summary.overview. The embedded
  // book.index.bookSummary is LEGACY — the worker writes the dedicated book_indexes
  // collection (merged onto book.index only at book-page render time), so reading
  // the embed first served stale text: the #2153/#2163 plain-encyclopedic rewrite
  // updated summary.data/reading_summary but NOT the embed, so browse/search kept
  // showing the old ad-copy voice for ~5k books. Keep the embed as a last resort
  // for old books that predate book.summary.data.
  if (typeof book.summary === 'string' && book.summary) return book.summary;
  if (book.summary?.data) return book.summary.data;
  const readingOverview = book.reading_summary?.overview;
  if (readingOverview) return readingOverview;
  const indexBrief = book.index?.bookSummary?.brief;
  if (indexBrief) return indexBrief;
  return null;
}

// Many importers only set the `published` string ("1578", "ca. 1576-1577"),
// not a numeric `year` — a null year renders as "—" in collection tables.
// Fall back to the first plausible year found in `published` (2026-06-05).
function deriveYear(book) {
  if (typeof book.year === 'number') return book.year;
  if (typeof book.published === 'string') {
    const m = book.published.match(/\b([1-9][0-9]{2,3})\b/);
    if (m) return parseInt(m[1], 10);
  }
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
    year: deriveYear(book),
    published: book.published || null,
    pages_count: book.pages_count || 0,
    pages_ocr: book.pages_ocr || 0,
    pages_translated: book.pages_translated || 0,
    pages_blank: book.pages_blank || 0,
    is_first_translation: book.is_first_translation === true,
    // LISTING predicate: matches the canonical public-listing filter
    // (visible: true), so Mongo's unset-visible legacy books collapse to
    // false here. This is intentionally STRICTER than the reader gate
    // (book-access.ts hides only an explicit visible === false) — readers
    // of this row must not treat visible:false as "not readable"; the
    // /book/[id] lookup falls through to Atlas for that case (issue #2959).
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
    // Book detail fields (for serving /book/[id] from Supabase)
    summary_text: extractSummaryText(book),
    publisher: book.publisher || null,
    place_published: book.place_published || null,
    doi: book.doi || null,
    work_id: book.work_id || null,
    text_role: book.text_role || null,
    // content_type:'book' wins — never expose a resource_type for a book, or the catalog
    // grid (CollectionBookCard) routes it to /artwork/ instead of /book/.
    resource_type: book.content_type === 'book' ? null : (book.resource_type || null),
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
    // Computed columns
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

// Sync books to Supabase.
//   FULL_MODE: only visible books (cleanup handles the rest)
//   incremental: any book changed since last sync, regardless of visibility,
//                so hides propagate (transformBook writes visible:false)
let query;

if (FULL_MODE) {
  query = { visible: true };
} else {
  const lastSync = await getLastSyncTime();
  if (lastSync) {
    query = { updated_at: { $gt: lastSync } };
    console.log(`Incremental from: ${lastSync.toISOString()} (visibility changes included)`);
  } else {
    query = { visible: true };
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
  contributing_library: 1,
  'image_source.contributing_library': 1,
  'image_source.source_url': 1,
  'image_source.provider_name': 1,
  'image_source.attribution': 1,
  'image_source.license': 1,
  'pipeline_auto.status': 1,
  needs_splitting: 1,
  // Book detail fields
  summary: 1, 'index.bookSummary.brief': 1, 'reading_summary.overview': 1,
  publisher: 1, place_published: 1, doi: 1, work_id: 1,
  resource_type: 1, cover_image: 1, dedication: 1, subtitle: 1, text_role: 1,
  source_work_dates: 1,
  'translation_verification.disposition': 1, 'translation_verification.reasoning': 1,
  // Graded FT verdict + screens (#3726 Tier 3) — pure projections; the render
  // decision lives in src/lib/first-translation/render.ts, never here.
  'first_translation.verdict': 1, 'first_translation.evidence_strength': 1,
  'first_translation.our_completeness': 1,
  'source_language_screen.verdict': 1, 'translator_author_screen.verdict': 1,
  'ai_metadata.description': 1, description: 1, subject_keywords: 1,
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
      console.error(`Batch error: ${error.message || JSON.stringify(error)}`);
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
    console.error(`Batch error: ${error.message || JSON.stringify(error)}`);
    errors += batch.length;
  } else {
    synced += batch.length;
  }
}

// On full sync, clean up stale rows (books no longer visible in MongoDB)
// Safety: verify cursor consistency before deleting anything
if (FULL_MODE && synced > 0) {
  const visibleIds = new Set();
  const idCursor = db.collection('books').find({ visible: true }, { projection: { id: 1 } }).batchSize(1000);
  for await (const doc of idCursor) visibleIds.add(doc.id);

  // Cross-check: cursor count should roughly match countDocuments
  const expectedCount = await db.collection('books').countDocuments({ visible: true });
  const cursorCount = visibleIds.size;
  const drift = Math.abs(expectedCount - cursorCount);
  const driftPct = expectedCount > 0 ? (drift / expectedCount * 100).toFixed(1) : 0;

  if (drift > 100 || driftPct > 5) {
    console.warn(`[${new Date().toISOString()}] books_catalog: SKIPPING cleanup — cursor returned ${cursorCount} but countDocuments says ${expectedCount} (drift: ${drift}, ${driftPct}%). Concurrent writes likely.`);
  } else {
    let sbIds = [];
    let offset = 0;
    while (true) {
      const { data } = await supabase.from('books_catalog').select('id').range(offset, offset + 999);
      if (!data || data.length === 0) break;
      sbIds.push(...data.map(d => d.id));
      offset += data.length;
      if (data.length < 1000) break;
    }

    // Split stale into HIDE (exists in Mongo but visible:false) vs DELETE (no Mongo record).
    // The incremental sync handles hides, but full-mode also enforces parity for any rows
    // it might have missed (e.g., a hide that happened during the sync window).
    const stale = sbIds.filter(id => !visibleIds.has(id));
    const mongoStaleDocs = stale.length > 0
      ? await db.collection('books').find(
          { id: { $in: stale } },
          { projection: { id: 1 } }
        ).toArray()
      : [];
    const mongoStaleSet = new Set(mongoStaleDocs.map(d => d.id));
    const toHide = stale.filter(id => mongoStaleSet.has(id));
    const toDelete = stale.filter(id => !mongoStaleSet.has(id));

    // Safety cap on DELETE only: hides are non-destructive (row preserved, visible flipped).
    // Cap is max(100, 5% of Supabase total) — generous enough to keep up with routine churn.
    const maxDelete = Math.max(100, Math.floor(sbIds.length * 0.05));
    if (toDelete.length > maxDelete) {
      console.warn(`[${new Date().toISOString()}] books_catalog: SKIPPING delete — ${toDelete.length} truly-orphaned rows exceeds safety cap of ${maxDelete}. Investigate before running scripts/output/_tmp-supabase-drift-cleanup.mjs manually.`);
    } else if (toDelete.length > 0) {
      let deleted = 0;
      for (let i = 0; i < toDelete.length; i += 100) {
        const batch = toDelete.slice(i, i + 100);
        const { error } = await supabase.from('books_catalog').delete().in('id', batch);
        if (!error) deleted += batch.length;
      }
      console.log(`[${new Date().toISOString()}] books_catalog: deleted ${deleted} orphan rows (no Mongo record)`);
    }

    if (toHide.length > 0) {
      let hidden = 0;
      for (let i = 0; i < toHide.length; i += 100) {
        const batch = toHide.slice(i, i + 100);
        const { error } = await supabase.from('books_catalog').update({ visible: false }).in('id', batch);
        if (!error) hidden += batch.length;
      }
      console.log(`[${new Date().toISOString()}] books_catalog: marked ${hidden} rows visible:false (hidden in Mongo)`);
    }
  }
}

await mongoClient.close();
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

if (synced > 0 || errors > 0) {
  console.log(`[${new Date().toISOString()}] books_catalog: ${synced} synced, ${errors} errors (${elapsed}s)`);
}
