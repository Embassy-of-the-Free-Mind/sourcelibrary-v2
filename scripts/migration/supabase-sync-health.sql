-- Supabase sync health improvements
-- Fixes timeout issues on pages and gemini_usage tables
-- Run via Supabase SQL Editor with service role permissions.
--
-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- Run the index creation statement separately from the rest.

-- ============================================================
-- 1. Missing index: pages.updated_at
-- Without this, ORDER BY updated_at DESC seq-scans 3.5M rows → timeout
-- Run this statement ALONE (not inside a transaction block):
-- ============================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pages_updated_at
  ON pages (updated_at DESC);

-- ============================================================
-- 2. Fast sync health check RPC
-- Uses pg_class for approximate counts (instant, no seq scan)
-- and indexed queries for latest timestamps.
-- Run this block separately after the index is created.
-- ============================================================

CREATE OR REPLACE FUNCTION sync_health()
RETURNS JSON
LANGUAGE sql
STABLE
AS $$
  SELECT json_build_object(
    'pages', json_build_object(
      'approx_count', (SELECT reltuples::bigint FROM pg_class WHERE relname = 'pages'),
      'latest_updated_at', (SELECT updated_at FROM pages ORDER BY updated_at DESC LIMIT 1),
      'latest_ocr_at', (SELECT ocr_updated_at FROM pages ORDER BY ocr_updated_at DESC LIMIT 1),
      'latest_translation_at', (SELECT translation_updated_at FROM pages ORDER BY translation_updated_at DESC LIMIT 1)
    ),
    'entities', json_build_object(
      'approx_count', (SELECT reltuples::bigint FROM pg_class WHERE relname = 'entities'),
      'latest_updated_at', (SELECT updated_at FROM entities ORDER BY updated_at DESC LIMIT 1)
    ),
    'gemini_usage', json_build_object(
      'approx_count', (SELECT reltuples::bigint FROM pg_class WHERE relname = 'gemini_usage'),
      'latest_at', (SELECT timestamp FROM gemini_usage ORDER BY timestamp DESC LIMIT 1)
    ),
    'checked_at', now()
  );
$$;

-- Grant access so health checks work without service role key
GRANT EXECUTE ON FUNCTION sync_health() TO anon;
GRANT EXECUTE ON FUNCTION sync_health() TO authenticated;
