-- Source Library: Supabase Analytics Schema Migration
-- Run this in the Supabase SQL Editor with service role permissions.
-- Issue: #565 — Expand Supabase as the analytics and operations layer
--
-- Phase 1: Extensions and index fixes
-- Phase 2: Analytics tables
-- Phase 3: Materialized views

-- ============================================================
-- PHASE 1a: Fix missing USTC indexes (unblocks ilike queries)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_ustc_enrichments_english_title_trgm
  ON ustc_enrichments USING GIN (english_title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_ustc_enrichments_original_author_trgm
  ON ustc_enrichments USING GIN (original_author gin_trgm_ops);

-- ============================================================
-- PHASE 1b: Unaccent extension (improves diacritics matching)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS unaccent;

-- Immutable wrapper needed for index support
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text AS $$
  SELECT unaccent($1);
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- ============================================================
-- PHASE 1d: Enable pgvector (for gallery embeddings later)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- PHASE 2: Analytics tables
-- ============================================================

-- AI cost tracking (source: MongoDB gemini_usage, ~1.4M rows)
CREATE TABLE IF NOT EXISTS gemini_usage (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL,           -- ocr, translation, summary, extract_images, etc.
  mode TEXT,                    -- realtime, batch
  model TEXT,
  book_id TEXT,
  book_title TEXT,
  page_count INT DEFAULT 0,
  input_tokens INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  cost_usd NUMERIC(10,6) DEFAULT 0,
  status TEXT,                  -- success, failed, pending
  error_message TEXT,
  error_category TEXT,
  duration_ms INT,
  prompt_version TEXT,
  job_id TEXT,
  batch_job_id TEXT,
  endpoint TEXT,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gemini_usage_timestamp ON gemini_usage (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_gemini_usage_book ON gemini_usage (book_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_gemini_usage_type ON gemini_usage (type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_gemini_usage_model ON gemini_usage (model, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_gemini_usage_status ON gemini_usage (status, timestamp DESC);

-- Pipeline health snapshots (source: MongoDB pipeline_snapshots, one per 5 min)
CREATE TABLE IF NOT EXISTS pipeline_snapshots (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  source TEXT DEFAULT 'hetzner-worker',
  funnel JSONB,                -- {status: count} map
  pages JSONB,                 -- {total, ocr, translated}
  books JSONB,
  active_batch JSONB
);

CREATE INDEX IF NOT EXISTS idx_pipeline_snapshots_ts ON pipeline_snapshots (timestamp DESC);

-- Web analytics (source: MongoDB analytics_pageviews, 90-day retention)
CREATE TABLE IF NOT EXISTS analytics_pageviews (
  id BIGSERIAL PRIMARY KEY,
  path TEXT NOT NULL,
  referrer TEXT,
  country TEXT,
  user_agent TEXT,
  ip TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pageviews_ts ON analytics_pageviews (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_pageviews_path ON analytics_pageviews (path, timestamp DESC);

-- User engagement events (source: MongoDB analytics_events, 90-day retention)
CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGSERIAL PRIMARY KEY,
  event TEXT NOT NULL,          -- book_read, page_read, page_edit
  book_id TEXT,
  page_id TEXT,
  ip TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_ts ON analytics_events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_book ON analytics_events (book_id, timestamp DESC);

-- Cron execution logs (source: MongoDB cron_runs)
CREATE TABLE IF NOT EXISTS cron_runs (
  id SERIAL PRIMARY KEY,
  cron TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  duration_ms INT,
  status TEXT,                  -- success, partial, failed
  health_grade TEXT,
  actions JSONB,
  decisions JSONB,
  errors JSONB,
  error_count INT DEFAULT 0,
  summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_cron_ts ON cron_runs (cron, timestamp DESC);

-- Performance metrics (source: MongoDB loading_metrics, 30-day retention)
CREATE TABLE IF NOT EXISTS loading_metrics (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  duration NUMERIC NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_loading_name_ts ON loading_metrics (name, timestamp DESC);

-- ============================================================
-- PHASE 2b: Retention policies (run periodically via pg_cron or external cron)
-- ============================================================

-- To set up automatic cleanup, run once after enabling pg_cron:
--
-- SELECT cron.schedule('cleanup-pageviews', '0 3 * * *',
--   $$DELETE FROM analytics_pageviews WHERE timestamp < NOW() - INTERVAL '90 days'$$);
--
-- SELECT cron.schedule('cleanup-events', '0 3 * * *',
--   $$DELETE FROM analytics_events WHERE timestamp < NOW() - INTERVAL '90 days'$$);
--
-- SELECT cron.schedule('cleanup-loading', '0 3 * * *',
--   $$DELETE FROM loading_metrics WHERE timestamp < NOW() - INTERVAL '30 days'$$);

-- ============================================================
-- PHASE 3: Materialized views (create after backfill)
-- ============================================================

-- Daily cost/usage summary — replaces the slow /api/analytics/usage endpoint
CREATE MATERIALIZED VIEW IF NOT EXISTS dashboard_usage AS
SELECT
  date_trunc('day', timestamp)::date AS day,
  type,
  model,
  COUNT(*) AS call_count,
  SUM(cost_usd) AS total_cost,
  SUM(input_tokens) AS total_input_tokens,
  SUM(output_tokens) AS total_output_tokens,
  SUM(page_count) AS total_pages,
  COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
  COUNT(*) FILTER (WHERE status = 'success') AS success_count
FROM gemini_usage
GROUP BY 1, 2, 3;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_usage_key ON dashboard_usage (day, type, model);

-- Pipeline velocity over time
CREATE MATERIALIZED VIEW IF NOT EXISTS pipeline_velocity AS
SELECT
  date_trunc('hour', timestamp) AS hour,
  (funnel->>'complete')::int AS books_complete,
  (pages->>'translated')::int AS pages_translated,
  (pages->>'ocr')::int AS pages_ocr,
  (pages->>'total')::int AS pages_total
FROM pipeline_snapshots
WHERE timestamp > NOW() - INTERVAL '30 days';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_velocity_hour ON pipeline_velocity (hour);

-- Refresh schedule (run via external cron every 5 min):
--
-- SELECT cron.schedule('refresh-dashboard-usage', '*/5 * * * *',
--   $$REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_usage$$);
--
-- SELECT cron.schedule('refresh-pipeline-velocity', '*/5 * * * *',
--   $$REFRESH MATERIALIZED VIEW CONCURRENTLY pipeline_velocity$$);
