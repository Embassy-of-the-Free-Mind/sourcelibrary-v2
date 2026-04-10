#!/usr/bin/env node
/**
 * Create the pages table on Supabase via direct Postgres connection.
 * Issue #947 Phase 1.
 *
 * Usage:
 *   secret-lover run -- node scripts/migration/create-supabase-pages-table.mjs
 *   # or with explicit URL:
 *   SUPABASE_DB_URL=postgres://... node scripts/migration/create-supabase-pages-table.mjs
 */

import pg from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
if (!DB_URL) { console.error('Missing SUPABASE_DB_URL'); process.exit(1); }

const DDL = `
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  page_number INT NOT NULL,

  -- Image URLs
  photo TEXT,
  photo_original TEXT,
  archived_photo TEXT,
  cropped_photo TEXT,
  crop JSONB,

  -- OCR
  ocr_data TEXT,
  ocr_model TEXT,
  ocr_language TEXT,
  ocr_source TEXT,
  ocr_prompt_version TEXT,
  ocr_batch_job_id TEXT,
  ocr_input_tokens INT,
  ocr_output_tokens INT,
  ocr_updated_at TIMESTAMPTZ,

  -- Translation
  translation_data TEXT,
  translation_model TEXT,
  translation_language TEXT DEFAULT 'English',
  translation_source_language TEXT,
  translation_source TEXT,
  translation_prompt_version TEXT,
  translation_batch_job_id TEXT,
  translation_input_tokens INT,
  translation_output_tokens INT,
  translation_updated_at TIMESTAMPTZ,
  translation_recitation_blocked BOOLEAN DEFAULT FALSE,
  translation_safety_blocked BOOLEAN DEFAULT FALSE,
  translation_safety_reason TEXT,

  -- Classification
  page_type TEXT,
  columns INT DEFAULT 1,
  script_type TEXT,

  -- Image detection
  detected_images JSONB,
  image_extraction_updated_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(book_id, page_number)
);

-- Primary access pattern: get all pages for a book, ordered
CREATE INDEX IF NOT EXISTS idx_pages_book_pagenum ON pages(book_id, page_number);

-- Pipeline velocity dashboard
CREATE INDEX IF NOT EXISTS idx_pages_translation_updated ON pages(translation_updated_at DESC)
  WHERE translation_updated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pages_ocr_updated ON pages(ocr_updated_at DESC)
  WHERE ocr_updated_at IS NOT NULL;

-- Gallery image quality
CREATE INDEX IF NOT EXISTS idx_pages_gallery_quality ON pages(
  ((detected_images->0->>'gallery_quality')::float) DESC
) WHERE detected_images IS NOT NULL AND jsonb_array_length(detected_images) > 0;

-- Archive status
CREATE INDEX IF NOT EXISTS idx_pages_archive_needed ON pages(archived_photo)
  WHERE photo IS NOT NULL;

-- RLS
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY pages_read_all ON pages FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY pages_write_service ON pages FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
`;

async function main() {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  console.log('Connected to Supabase Postgres');

  console.log('Creating pages table...');
  await client.query(DDL);
  console.log('Done — table and indexes created.');

  // Verify
  const { rows } = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'pages' AND table_schema = 'public'
    ORDER BY ordinal_position
  `);
  console.log(`\\nColumns (${rows.length}):`);
  for (const r of rows) {
    console.log(`  ${r.column_name}: ${r.data_type}`);
  }

  const { rows: idxRows } = await client.query(`
    SELECT indexname FROM pg_indexes WHERE tablename = 'pages' AND schemaname = 'public'
  `);
  console.log(`\\nIndexes (${idxRows.length}):`);
  for (const r of idxRows) console.log(`  ${r.indexname}`);

  await client.end();
}

main().catch(err => { console.error(err); process.exit(1); });
