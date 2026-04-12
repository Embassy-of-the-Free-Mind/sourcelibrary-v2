#!/usr/bin/env node
/**
 * Migrate gallery text embeddings from MongoDB to Supabase pgvector.
 *
 * 1. Creates the gallery_text_embeddings table if needed
 * 2. Creates the match_gallery_text RPC function
 * 3. Copies all embeddings from MongoDB gallery_embeddings → Supabase
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/migration/migrate-gallery-embeddings-to-supabase.mjs
 */

import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!MONGODB_URI || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars: MONGODB_URI, SUPABASE_URL, SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function setupSupabase() {
  console.log('Setting up Supabase table and functions...');

  // Create table
  const { error: tableErr } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS gallery_text_embeddings (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL,
        book_id TEXT NOT NULL,
        detection_index INT NOT NULL,
        embedding VECTOR(768),
        text_source TEXT,
        model TEXT DEFAULT 'text-embedding-004',
        generated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_gte_book_id ON gallery_text_embeddings (book_id);
      CREATE INDEX IF NOT EXISTS idx_gte_embedding ON gallery_text_embeddings
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
    `,
  });

  if (tableErr) {
    // exec_sql may not exist — try raw SQL via pg
    console.log('exec_sql not available, creating table via REST...');
    // The table may already exist. Try inserting to check.
    const { error: checkErr } = await supabase
      .from('gallery_text_embeddings')
      .select('id')
      .limit(1);

    if (checkErr?.code === '42P01') {
      console.error('Table does not exist and cannot create via RPC. Run this SQL manually in Supabase dashboard:');
      console.error(`
CREATE TABLE gallery_text_embeddings (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  detection_index INT NOT NULL,
  embedding VECTOR(768),
  text_source TEXT,
  model TEXT DEFAULT 'text-embedding-004',
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_gte_book_id ON gallery_text_embeddings (book_id);
CREATE INDEX idx_gte_embedding ON gallery_text_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE OR REPLACE FUNCTION match_gallery_text(
  query_embedding VECTOR(768),
  match_threshold FLOAT DEFAULT 0.3,
  match_count INT DEFAULT 20,
  exclude_book_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  id TEXT,
  page_id TEXT,
  book_id TEXT,
  detection_index INT,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    g.id,
    g.page_id,
    g.book_id,
    g.detection_index,
    1 - (g.embedding <=> query_embedding) AS similarity
  FROM gallery_text_embeddings g
  WHERE (exclude_book_id IS NULL OR g.book_id != exclude_book_id)
    AND 1 - (g.embedding <=> query_embedding) > match_threshold
  ORDER BY g.embedding <=> query_embedding
  LIMIT match_count;
$$;
      `);
      process.exit(1);
    } else {
      console.log('Table already exists.');
    }
  } else {
    console.log('Table and indexes created.');
  }
}

async function migrateEmbeddings() {
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  const total = await db.collection('gallery_embeddings').countDocuments();
  console.log(`\nMongoDB gallery_embeddings: ${total} documents`);

  // Check existing count in Supabase
  const { count: existingCount } = await supabase
    .from('gallery_text_embeddings')
    .select('id', { count: 'exact', head: true });

  console.log(`Supabase gallery_text_embeddings: ${existingCount || 0} rows`);

  if (existingCount && existingCount >= total) {
    console.log('All embeddings already migrated. Skipping.');
    await mongo.close();
    return;
  }

  // Fetch all from MongoDB in batches
  const BATCH_SIZE = 200;
  let processed = 0;
  let upserted = 0;

  const cursor = db.collection('gallery_embeddings').find({});

  let batch = [];

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (!doc || !doc.embedding) continue;

    batch.push({
      id: doc.id,
      page_id: doc.page_id,
      book_id: doc.book_id,
      detection_index: doc.detection_index || 0,
      embedding: JSON.stringify(doc.embedding),
      text_source: doc.text_source || null,
      model: doc.model || 'text-embedding-004',
      generated_at: doc.generated_at ? new Date(doc.generated_at).toISOString() : null,
    });

    if (batch.length >= BATCH_SIZE) {
      const { error } = await supabase
        .from('gallery_text_embeddings')
        .upsert(batch, { onConflict: 'id' });

      if (error) {
        console.error(`Batch error at ${processed}:`, error.message);
      } else {
        upserted += batch.length;
      }

      processed += batch.length;
      batch = [];

      if (processed % 1000 === 0) {
        console.log(`  ${processed}/${total} processed, ${upserted} upserted`);
      }
    }
  }

  // Final batch
  if (batch.length > 0) {
    const { error } = await supabase
      .from('gallery_text_embeddings')
      .upsert(batch, { onConflict: 'id' });

    if (error) {
      console.error('Final batch error:', error.message);
    } else {
      upserted += batch.length;
    }
    processed += batch.length;
  }

  console.log(`\nDone: ${processed} processed, ${upserted} upserted to Supabase`);
  await mongo.close();
}

async function main() {
  await setupSupabase();
  await migrateEmbeddings();
}

main().catch(err => { console.error(err); process.exit(1); });
