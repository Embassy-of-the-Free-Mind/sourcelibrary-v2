-- RLS lockdown Phase 2 — operational telemetry (2026-05-25)
--
-- Closes the operational-surveillance half of issue #1981. Two tables are
-- currently readable via the public anon key:
--
--   * gemini_usage (4,669,573 rows): every Gemini API call with model,
--     tokens, cost, endpoint, type, timestamps. Doesn't include prompt
--     content, but exposes near-realtime AI spend, pipeline volume, and
--     internal endpoint structure.
--
--   * pipeline_snapshots (21,930 rows): internal pipeline state — job
--     timings, queue depths, throughput metrics.
--
-- Neither table contains end-user PII per se (visitor data lives in
-- analytics_pageviews, locked down in Phase 1). The risk class here is
-- operational surveillance and competitive intel: anyone reading our
-- frontend JS to extract the anon key can monitor our AI spend curve in
-- real time, observe pipeline throughput, and infer internal process
-- decisions. Neither should be exposed.
--
-- The companion code changes switch the relevant consumers from anon
-- `supabase` to `supabaseAdmin`:
--
--   src/app/api/[tenant]/analytics/pipeline/route.ts
--   src/app/api/analytics/pipeline/route.ts
--   src/lib/gemini-logger.ts (fetchUsageRows)
--   src/lib/book-history.ts (fetchSupabaseUsage)
--
-- Writers (the Gemini logger inserts in gemini-logger.ts, the
-- pipeline_snapshots writes from the pipeline workers) already use the
-- service-role client — unaffected.
--
-- This migration is additive and idempotent — re-running is safe.

BEGIN;

-- ───────────────────── gemini_usage ─────────────────────
ALTER TABLE gemini_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gemini_usage_service_all ON gemini_usage;
CREATE POLICY gemini_usage_service_all
  ON gemini_usage
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE SELECT, INSERT, UPDATE, DELETE ON gemini_usage FROM PUBLIC;
REVOKE SELECT, INSERT, UPDATE, DELETE ON gemini_usage FROM authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON gemini_usage FROM anon;

-- ───────────────────── pipeline_snapshots ─────────────────────
ALTER TABLE pipeline_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pipeline_snapshots_service_all ON pipeline_snapshots;
CREATE POLICY pipeline_snapshots_service_all
  ON pipeline_snapshots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE SELECT, INSERT, UPDATE, DELETE ON pipeline_snapshots FROM PUBLIC;
REVOKE SELECT, INSERT, UPDATE, DELETE ON pipeline_snapshots FROM authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON pipeline_snapshots FROM anon;

COMMIT;

-- ───────────────────── Post-flight verification ─────────────────────
--
-- Anon-key probe (run from a shell, not in SQL editor):
--   curl -sS "$SUPABASE_URL/rest/v1/gemini_usage?select=*&limit=1" \
--     -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
--   -- expect: 401 permission denied
--
-- Service-role count check:
--   SELECT relname, relrowsecurity FROM pg_class
--     WHERE relname IN ('gemini_usage', 'pipeline_snapshots');
--   -- both should show relrowsecurity = true
