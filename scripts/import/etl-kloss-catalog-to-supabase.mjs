#!/usr/bin/env node
/**
 * One-time ETL: Mongo `kloss_catalog` → Supabase `library_catalog_records`.
 *
 * Idempotent — upserts on (tenant_id, catalog_id). Safe to re-run.
 *
 * Prerequisites:
 *   - Run scripts/migration/create-library-catalog-records.sql in Supabase first.
 *   - MONGODB_URI, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or
 *     NEXT_PUBLIC_SUPABASE_ANON_KEY with RLS turned off for this table) in env.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *     node scripts/import/etl-kloss-catalog-to-supabase.mjs [--dry] [--limit N]
 *
 * What it does:
 *   1. Reads every kloss_catalog doc from Mongo.
 *   2. Maps Kloss fields → library_catalog_records columns.
 *      - priref → catalog_id
 *      - authors[] → author (joined with "; "; first author also kept in author)
 *      - kloss_shelf_mark, digital_references, notes, scan_verification → metadata JSONB
 *      - free-text year ("[ca. 1805-06]") → year_text + best-effort year INT
 *   3. Joins to live Mongo `books` by image_source.identifier=priref to populate
 *      sl_book_id and sl_book_slug.
 *   4. Bulk-upserts in batches of 500.
 */
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

const DRY = process.argv.includes('--dry');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : 0;

const TENANT_ID = 'kloss-collection';
const BATCH_SIZE = 500;

const mongoUri = process.env.MONGODB_URI;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!mongoUri) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase env not set. Need NEXT_PUBLIC_SUPABASE_URL and a service-role or anon key.');
  process.exit(1);
}

const mongo = new MongoClient(mongoUri);
await mongo.connect();
const db = mongo.db('bookstore');

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log(`Mode: ${DRY ? 'DRY RUN' : 'APPLY'}`);
console.log(`Tenant: ${TENANT_ID}\n`);

// ───────── Build priref → sl_book lookup from live books ─────────

console.log('Building priref → sl_book lookup from books collection...');
const liveBooks = await db.collection('books').find(
  { 'image_source.provider': 'cmc_kloss' },
  { projection: { id: 1, slug: 1, 'image_source.identifier': 1 } }
).toArray();
const prirefToBook = new Map();
for (const b of liveBooks) {
  const priref = b.image_source?.identifier;
  if (priref) prirefToBook.set(String(priref), { id: b.id, slug: b.slug || null });
}
console.log(`  ${prirefToBook.size} priref → book mappings loaded\n`);

// ───────── Read catalog ─────────

const cursor = db.collection('kloss_catalog').find({});
if (LIMIT > 0) cursor.limit(LIMIT);
const catalog = await cursor.toArray();
console.log(`kloss_catalog records: ${catalog.length}`);

// ───────── Transform ─────────

/** Best-effort numeric year from free-text. Picks the first 4-digit run, or
 *  the first 3-digit run preceded by 1 (Latin "M..." we don't handle). */
function parseYear(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/(\d{4})/);
  if (m) {
    const y = parseInt(m[1], 10);
    if (y >= 1000 && y <= 2100) return y;
  }
  return null;
}

function joinList(value, sep = '; ') {
  if (!Array.isArray(value)) return value || null;
  const trimmed = value.map(v => String(v).trim()).filter(Boolean);
  return trimmed.length ? trimmed.join(sep) : null;
}

const rows = catalog.map(doc => {
  const priref = String(doc.priref);
  const sl = prirefToBook.get(priref);

  // Kloss-specific extras into metadata
  const metadata = {};
  if (doc.kloss_shelf_mark) metadata.kloss_shelf_mark = doc.kloss_shelf_mark;
  if (Array.isArray(doc.digital_references) && doc.digital_references.length) metadata.digital_references = doc.digital_references;
  if (Array.isArray(doc.notes) && doc.notes.length) metadata.notes = doc.notes;
  if (doc.scan_verification) metadata.scan_verification = doc.scan_verification;
  if (doc.is_scanned !== undefined) metadata.is_scanned = doc.is_scanned;
  if (doc.has_digital_copy !== undefined) metadata.has_digital_copy = doc.has_digital_copy;
  if (doc.description) metadata.description = doc.description;
  if (doc.edition) metadata.edition = doc.edition;
  if (doc.format) metadata.format = doc.format;
  if (doc.material_type) metadata.material_type = doc.material_type;
  if (doc.pagination) metadata.pagination = doc.pagination;
  if (doc.series) metadata.series = doc.series;

  return {
    tenant_id: TENANT_ID,
    catalog_id: priref,
    title: doc.title || null,
    author: joinList(doc.authors) || null,
    place: doc.place_of_publication || null,
    publisher: doc.publisher || null,
    year: parseYear(doc.year),
    year_text: doc.year || null,
    shelf_mark: doc.shelf_mark || null,
    keywords: joinList(doc.keywords, ', '),
    language: doc.language || null,
    series_title: doc.series || null,
    sl_book_id: sl?.id || null,
    sl_book_slug: sl?.slug || null,
    metadata,
  };
});

const withLink = rows.filter(r => r.sl_book_id).length;
console.log(`Rows prepared: ${rows.length}`);
console.log(`  with sl_book_id link: ${withLink}`);
console.log(`  unlinked (catalogue-only): ${rows.length - withLink}`);

if (DRY) {
  console.log('\nDRY RUN — sample row:');
  console.log(JSON.stringify(rows[0], null, 2));
  await mongo.close();
  process.exit(0);
}

// ───────── Upsert in batches ─────────

console.log('\nUpserting to Supabase...');
let upserted = 0;
let errors = 0;
for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const batch = rows.slice(i, i + BATCH_SIZE);
  const { error } = await supabase
    .from('library_catalog_records')
    .upsert(batch, { onConflict: 'tenant_id,catalog_id', ignoreDuplicates: false });
  if (error) {
    errors++;
    console.error(`  batch ${i}-${i + batch.length}: ${error.message}`);
    if (error.message.includes('does not exist') || error.message.includes('not find')) {
      console.error('  → Run scripts/migration/create-library-catalog-records.sql in Supabase first.');
      break;
    }
  } else {
    upserted += batch.length;
    if (i % (BATCH_SIZE * 4) === 0 || i + BATCH_SIZE >= rows.length) {
      console.log(`  ${upserted}/${rows.length} upserted`);
    }
  }
}

// ───────── Verify ─────────

const { count } = await supabase
  .from('library_catalog_records')
  .select('*', { count: 'exact', head: true })
  .eq('tenant_id', TENANT_ID);
console.log(`\nFinal Supabase count for tenant '${TENANT_ID}': ${count ?? '?'}`);
console.log(`Upserted: ${upserted}  Errors: ${errors}`);

await mongo.close();
