#!/usr/bin/env node
/**
 * Create pages_images table in Supabase and backfill from MongoDB.
 * Lightweight table: just image URLs per page, for fast backfill queries.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/migration/create-pages-images-supabase.mjs
 *   node scripts/migration/create-pages-images-supabase.mjs --skip-create  # only backfill
 */

import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const SKIP_CREATE = hasFlag('skip-create');

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL; // Direct Postgres connection

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!SUPABASE_KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function createTable() {
  // Need direct Postgres connection for DDL
  if (!SUPABASE_DB_URL) {
    console.log('No SUPABASE_DB_URL — creating table via Supabase REST workaround...');
    // Use supabase-js to insert into a temp table, which auto-creates it...
    // Actually we need raw SQL. Let's try the pg client with the pooler URL.
    console.error('Please set SUPABASE_DB_URL or create the table manually:');
    console.log(`
CREATE TABLE pages_images (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  page_number INT NOT NULL,
  archived_photo TEXT,
  display_photo TEXT,
  thumbnail_blob TEXT
);
CREATE INDEX idx_pages_images_book_id ON pages_images (book_id);
CREATE INDEX idx_pages_images_needs_display ON pages_images (id) WHERE archived_photo IS NOT NULL AND display_photo IS NULL;
    `);
    return false;
  }

  const pool = new pg.Pool({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pages_images (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        page_number INT NOT NULL,
        archived_photo TEXT,
        display_photo TEXT,
        thumbnail_blob TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pages_images_book_id ON pages_images (book_id);
      CREATE INDEX IF NOT EXISTS idx_pages_images_needs_display ON pages_images (id) WHERE archived_photo IS NOT NULL AND display_photo IS NULL;
    `);
    console.log('Table pages_images created with indexes');
    return true;
  } catch (err) {
    console.error('DDL error:', err.message);
    return false;
  } finally {
    await pool.end();
  }
}

async function backfill() {
  const mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 5 });
  await mongoClient.connect();
  const db = mongoClient.db('bookstore');

  // Get book IDs from Supabase (fast)
  console.log('Fetching book IDs from Supabase...');
  const allBookIds = [];
  let from = 0;
  while (true) {
    const { data } = await supabase.from('books_catalog').select('id').range(from, from + 999);
    if (!data || data.length === 0) break;
    allBookIds.push(...data.map(d => d.id));
    from += 1000;
  }
  console.log(`${allBookIds.length} books from Supabase`);

  let totalPages = 0;
  let totalUpserted = 0;
  const startTime = Date.now();

  for (let i = 0; i < allBookIds.length; i++) {
    const bookId = allBookIds[i];

    // Get pages from MongoDB (per-book query is fast via book_id index)
    const pages = await db.collection('pages')
      .find(
        { book_id: bookId },
        { projection: { id: 1, _id: 1, book_id: 1, page_number: 1, archived_photo: 1, display_photo: 1, thumbnail_blob: 1 } }
      )
      .batchSize(5000)
      .maxTimeMS(15_000)
      .toArray()
      .catch(() => []);

    if (pages.length === 0) continue;

    // Upsert to Supabase in batches of 500
    const rows = pages.map(p => ({
      id: p.id || p._id?.toString(),
      book_id: p.book_id,
      page_number: p.page_number,
      archived_photo: p.archived_photo || null,
      display_photo: p.display_photo || null,
      thumbnail_blob: p.thumbnail_blob || null,
    }));

    for (let j = 0; j < rows.length; j += 500) {
      const batch = rows.slice(j, j + 500);
      const { error } = await supabase.from('pages_images').upsert(batch, { onConflict: 'id' });
      if (error) {
        console.error(`  Error upserting book ${bookId}: ${error.message}`);
        break;
      }
      totalUpserted += batch.length;
    }

    totalPages += pages.length;

    if ((i + 1) % 100 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (totalPages / elapsed).toFixed(0);
      console.log(`  ${i + 1}/${allBookIds.length} books — ${totalPages.toLocaleString()} pages synced — ${rate} pages/sec`);
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\nDone in ${Math.round(elapsed)}s`);
  console.log(`  ${totalPages.toLocaleString()} pages synced across ${allBookIds.length} books`);
  console.log(`  ${totalUpserted.toLocaleString()} rows upserted to Supabase`);

  await mongoClient.close();
}

async function main() {
  if (!SKIP_CREATE) {
    const created = await createTable();
    if (!created && !SUPABASE_DB_URL) {
      console.log('\nCreate the table manually in Supabase SQL editor, then re-run with --skip-create');
      process.exit(0);
    }
  }

  await backfill();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
