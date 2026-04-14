-- Pages table migration: MongoDB → Supabase
-- Issue #947, Phase 1
--
-- Run via Supabase SQL Editor or psql:
--   psql "$SUPABASE_DB_URL" -f scripts/migration/create-supabase-pages-table.sql

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

-- Pipeline velocity dashboard (sparse — only pages with timestamps)
CREATE INDEX IF NOT EXISTS idx_pages_translation_updated ON pages(translation_updated_at DESC)
  WHERE translation_updated_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pages_ocr_updated ON pages(ocr_updated_at DESC)
  WHERE ocr_updated_at IS NOT NULL;

-- Gallery image quality (for collection/library hero images)
-- Note: jsonb expression index on first element's gallery_quality
CREATE INDEX IF NOT EXISTS idx_pages_gallery_quality ON pages(
  ((detected_images->0->>'gallery_quality')::float) DESC
) WHERE detected_images IS NOT NULL AND jsonb_array_length(detected_images) > 0;

-- Archive status (for archiving workers)
CREATE INDEX IF NOT EXISTS idx_pages_archive_needed ON pages(archived_photo)
  WHERE photo IS NOT NULL;

-- RLS: public read access (pages are not sensitive)
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY pages_read_all ON pages FOR SELECT USING (true);
-- Writes restricted to service role
CREATE POLICY pages_write_service ON pages FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
