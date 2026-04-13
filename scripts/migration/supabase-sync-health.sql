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

-- NOTE: plpgsql with sequential queries avoids Postgres planner combining
-- all subqueries into one plan that exceeds the 3s statement timeout.
CREATE OR REPLACE FUNCTION sync_health()
RETURNS JSON
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  pages_count bigint;
  pages_updated timestamptz;
  pages_ocr timestamptz;
  pages_translation timestamptz;
  entities_count bigint;
  entities_updated timestamptz;
  gemini_count bigint;
  gemini_latest timestamptz;
BEGIN
  SELECT reltuples::bigint INTO pages_count FROM pg_class WHERE relname = 'pages';
  SELECT updated_at INTO pages_updated FROM pages ORDER BY updated_at DESC LIMIT 1;
  SELECT ocr_updated_at INTO pages_ocr FROM pages WHERE ocr_updated_at IS NOT NULL ORDER BY ocr_updated_at DESC LIMIT 1;
  SELECT translation_updated_at INTO pages_translation FROM pages WHERE translation_updated_at IS NOT NULL ORDER BY translation_updated_at DESC LIMIT 1;

  SELECT reltuples::bigint INTO entities_count FROM pg_class WHERE relname = 'entities';
  SELECT updated_at INTO entities_updated FROM entities ORDER BY updated_at DESC LIMIT 1;

  SELECT reltuples::bigint INTO gemini_count FROM pg_class WHERE relname = 'gemini_usage';
  SELECT timestamp INTO gemini_latest FROM gemini_usage ORDER BY timestamp DESC LIMIT 1;

  RETURN json_build_object(
    'pages', json_build_object(
      'approx_count', pages_count,
      'latest_updated_at', pages_updated,
      'latest_ocr_at', pages_ocr,
      'latest_translation_at', pages_translation
    ),
    'entities', json_build_object(
      'approx_count', entities_count,
      'latest_updated_at', entities_updated
    ),
    'gemini_usage', json_build_object(
      'approx_count', gemini_count,
      'latest_at', gemini_latest
    ),
    'checked_at', now()
  );
END;
$$;

-- Grant access so health checks work without service role key
GRANT EXECUTE ON FUNCTION sync_health() TO anon;
GRANT EXECUTE ON FUNCTION sync_health() TO authenticated;
