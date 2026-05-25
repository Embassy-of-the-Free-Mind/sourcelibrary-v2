-- RLS lockdown Phase 1 — PII tables (2026-05-25)
--
-- Closes the GDPR-relevant half of issue #1981. Two tables are currently
-- readable via the public anon key (which is hardcoded in every served
-- frontend JS bundle), exposing:
--
--   * analytics_pageviews (81k rows): IP, user_agent, country, referrer,
--     path, timestamp per visitor — personal data under EU GDPR.
--
--   * bph_works_pending_changes (0 rows today, but will hold contributor
--     email + proposed edits as #1877 sees use).
--
-- Both should be service-role-only. The app's analytics dashboard and the
-- contributor-review page have been switched to supabaseAdmin in the same
-- PR so end-user access still works through the application's auth gate.
--
-- This migration is additive and idempotent — re-running is safe.
--
-- Companion: src/app/api/analytics/route.ts, src/app/api/[tenant]/analytics/route.ts,
--            src/app/embed/[tenant]/catalog/review/page.tsx switched to supabaseAdmin.
--
-- Verification after apply:
--   anon-key probe should return 401 / 200 with empty array for both tables.
--   See scripts/migration/rls-lockdown-phase1-pii.sql header.

BEGIN;

-- ───────────────────── analytics_pageviews ─────────────────────
ALTER TABLE analytics_pageviews ENABLE ROW LEVEL SECURITY;

-- Service role: full access. The MongoDB→Supabase sync worker
-- (scripts/workers/supabase-sync.mjs) and the analytics API routes use this.
DROP POLICY IF EXISTS analytics_pageviews_service_all ON analytics_pageviews;
CREATE POLICY analytics_pageviews_service_all
  ON analytics_pageviews
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- No anon / authenticated policies — visitor PII must never be reachable
-- via end-user keys. Anything that needs aggregated stats goes through
-- the application's auth-gated API routes.

-- Belt-and-braces grants in case RLS is ever disabled.
REVOKE SELECT, INSERT, UPDATE, DELETE ON analytics_pageviews FROM PUBLIC;
REVOKE SELECT, INSERT, UPDATE, DELETE ON analytics_pageviews FROM authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON analytics_pageviews FROM anon;

-- ───────────────────── bph_works_pending_changes ─────────────────────
ALTER TABLE bph_works_pending_changes ENABLE ROW LEVEL SECURITY;

-- Service role: full access. The contributor edit/review API routes
-- (src/app/api/[tenant]/catalog/[ubn]/edit/route.ts and the approve/reject
-- routes) already use supabaseAdmin. The review page now does too.
DROP POLICY IF EXISTS bph_works_pending_changes_service_all ON bph_works_pending_changes;
CREATE POLICY bph_works_pending_changes_service_all
  ON bph_works_pending_changes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- No anon / authenticated policies — contributor email + proposed-edit
-- content is private. Editor reviewers see this content through the
-- auth-gated /embed/bph/catalog/review page, which goes through
-- supabaseAdmin server-side.

REVOKE SELECT, INSERT, UPDATE, DELETE ON bph_works_pending_changes FROM PUBLIC;
REVOKE SELECT, INSERT, UPDATE, DELETE ON bph_works_pending_changes FROM authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON bph_works_pending_changes FROM anon;

COMMIT;

-- ───────────────────── Post-flight verification ─────────────────────
--
-- Run as a separate query (NOT in this transaction):
--
--   SELECT relname, relrowsecurity FROM pg_class
--     WHERE relname IN ('analytics_pageviews', 'bph_works_pending_changes');
--   -- both should show relrowsecurity = true
--
--   SELECT polname, polroles::regrole[] FROM pg_policy
--     WHERE polrelid IN ('analytics_pageviews'::regclass, 'bph_works_pending_changes'::regclass);
--   -- expect one policy per table, role = service_role
--
-- Anon-key probe (run from a shell):
--   curl -sS "$SUPABASE_URL/rest/v1/analytics_pageviews?select=*&limit=1" \
--     -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
--   -- expect: [] (empty array) or 401, NOT a row payload
