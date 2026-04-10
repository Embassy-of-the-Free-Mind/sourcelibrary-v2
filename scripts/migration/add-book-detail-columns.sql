-- Add columns to books_catalog for serving /book/[id] detail pages from Supabase.
-- Run this in the Supabase SQL editor before deploying the sync script update.
--
-- These fields are needed for the book detail page shell (above-the-fold render).
-- Page content (OCR, translation text) stays on MongoDB.

ALTER TABLE books_catalog
  ADD COLUMN IF NOT EXISTS summary_text text,
  ADD COLUMN IF NOT EXISTS publisher text,
  ADD COLUMN IF NOT EXISTS place_published text,
  ADD COLUMN IF NOT EXISTS doi text,
  ADD COLUMN IF NOT EXISTS work_id text,
  ADD COLUMN IF NOT EXISTS resource_type text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS provider_name text,
  ADD COLUMN IF NOT EXISTS image_attribution text,
  ADD COLUMN IF NOT EXISTS image_license text,
  ADD COLUMN IF NOT EXISTS cover_image text,
  ADD COLUMN IF NOT EXISTS dedication text,
  ADD COLUMN IF NOT EXISTS subtitle text,
  ADD COLUMN IF NOT EXISTS source_work_dates jsonb,
  ADD COLUMN IF NOT EXISTS ft_disposition text,
  ADD COLUMN IF NOT EXISTS ft_reasoning text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS subject_keywords text[];

-- Index for slug-based lookups (the primary access pattern for book detail pages)
CREATE INDEX IF NOT EXISTS idx_books_catalog_slug ON books_catalog (slug) WHERE slug IS NOT NULL;

-- Index for work_id lookups (related editions)
CREATE INDEX IF NOT EXISTS idx_books_catalog_work_id ON books_catalog (work_id) WHERE work_id IS NOT NULL;
