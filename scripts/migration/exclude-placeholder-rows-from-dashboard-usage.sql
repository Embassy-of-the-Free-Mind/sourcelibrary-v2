-- Issue #3452 — keep batch-submit placeholder rows out of the cost rollup.
--
-- A batch OCR/image-extraction job writes a gemini_usage row at SUBMIT time,
-- before any tokens exist (status 'submitted' from the Hetzner orchestrator,
-- 'pending' from src/lib/gemini-logger.ts). batch-collector now closes that
-- row out when results arrive; historically it inserted a SECOND row instead,
-- leaving the placeholder at $0.00 forever.
--
-- Two consequences for dashboard_usage, both in the "reads like good news"
-- direction: call_count counted every batch twice, and total_pages counted
-- every page twice, while the placeholder's zeros dragged nothing down because
-- cost is a SUM. This view must therefore count only rows that have reached a
-- terminal, spend-bearing state.
--
-- Statuses excluded:
--   'submitted' / 'pending' — placeholder, not yet reconciled (in flight, or
--                             stranded because the job died before collection)
--   'duplicate'             — a historical placeholder whose real spend is
--                             recorded on a separate row written by the old
--                             collector; marked by
--                             scripts/maintenance/reconcile-batch-usage.mjs
--
-- Apply with (SUPABASE_DB_URL lives on Hetzner, not in the local env file):
--   psql "$SUPABASE_DB_URL" -f scripts/migration/exclude-placeholder-rows-from-dashboard-usage.sql
-- then refresh:
--   REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_usage;

DROP MATERIALIZED VIEW IF EXISTS dashboard_usage;

CREATE MATERIALIZED VIEW dashboard_usage AS
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
WHERE status IS NULL OR status NOT IN ('submitted', 'pending', 'duplicate', 'unknown')
GROUP BY 1, 2, 3;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_usage_key ON dashboard_usage (day, type, model);

-- Unreconciled placeholders are themselves a signal: a batch that submitted and
-- never came back is either in flight or lost. Surface them rather than hiding
-- them, so "the meter reads zero" can never again mean "nobody looked".
CREATE OR REPLACE VIEW dashboard_usage_placeholders AS
SELECT
  date_trunc('day', timestamp)::date AS day,
  type,
  model,
  COUNT(*) AS placeholder_count,
  SUM(page_count) AS placeholder_pages,
  MIN(timestamp) AS oldest
FROM gemini_usage
WHERE status IN ('submitted', 'pending')
GROUP BY 1, 2, 3;

REFRESH MATERIALIZED VIEW dashboard_usage;
