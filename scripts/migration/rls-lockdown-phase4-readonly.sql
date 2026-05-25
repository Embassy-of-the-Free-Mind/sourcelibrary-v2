-- RLS lockdown Phase 4 — public catalog (read-only via anon) (2026-05-25)
--
-- Closes the read-only catalog half of issue #1981. Four tables hold
-- catalog data that's intentionally public (entities, embeddings — they
-- power the encyclopedia, semantic search, image similarity), but were
-- previously *also* writable via the anon key, which is wrong.
--
-- The pattern here is different from Phase 1/2 (PII / telemetry):
--
--   Phase 1/2 → service-role only, anon has NO access
--   Phase 4   → anon SELECT-only, INSERT/UPDATE/DELETE revoked from anon
--
-- Tables in scope:
--
--   * entities (856,539 rows) — author/place/concept authority records,
--     read by /encyclopedia, /explore, author detail pages, etc.
--   * book_embeddings — semantic search index (gemini-embedding-2,
--     768-dim), read by /api/search/semantic and /api/search/unified.
--   * artwork_embeddings — artwork semantic embeddings.
--   * clip_embeddings (101,981 rows) — CLIP image embeddings, read by
--     /api/identify and /api/gallery/similar.
--
-- All four are written exclusively by service-role workers
--   scripts/workers/sync-entities.mjs
--   scripts/workers/enrich-worker.mjs  (book_embeddings)
--   scripts/migration/backfill-book-embeddings.mjs
--   (artwork_embeddings + clip_embeddings: backfill scripts under
--    scripts/, all using SUPABASE_SERVICE_ROLE_KEY)
-- — unaffected by this migration.
--
-- No application-code changes needed: the server-rendered pages
-- already read via anon supabase, and the anon SELECT policy keeps
-- that path working.
--
-- This migration is additive and idempotent.

BEGIN;

-- Common pattern, applied uniformly to all four tables:
--   1. ENABLE ROW LEVEL SECURITY
--   2. service_role policy: FOR ALL (writers continue to work)
--   3. anon + authenticated policies: FOR SELECT (catalog reads continue)
--   4. REVOKE INSERT/UPDATE/DELETE from public/authenticated/anon
--      (belt-and-braces — RLS policies are the primary control,
--       but explicit GRANT-level revoke costs nothing).

-- ───────────────────── entities ─────────────────────
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS entities_service_all ON entities;
CREATE POLICY entities_service_all ON entities FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS entities_anon_select ON entities;
CREATE POLICY entities_anon_select ON entities FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS entities_auth_select ON entities;
CREATE POLICY entities_auth_select ON entities FOR SELECT TO authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE ON entities FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON entities FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON entities FROM anon;

-- ───────────────────── book_embeddings ─────────────────────
ALTER TABLE book_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS book_embeddings_service_all ON book_embeddings;
CREATE POLICY book_embeddings_service_all ON book_embeddings FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS book_embeddings_anon_select ON book_embeddings;
CREATE POLICY book_embeddings_anon_select ON book_embeddings FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS book_embeddings_auth_select ON book_embeddings;
CREATE POLICY book_embeddings_auth_select ON book_embeddings FOR SELECT TO authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE ON book_embeddings FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON book_embeddings FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON book_embeddings FROM anon;

-- ───────────────────── artwork_embeddings ─────────────────────
ALTER TABLE artwork_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS artwork_embeddings_service_all ON artwork_embeddings;
CREATE POLICY artwork_embeddings_service_all ON artwork_embeddings FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS artwork_embeddings_anon_select ON artwork_embeddings;
CREATE POLICY artwork_embeddings_anon_select ON artwork_embeddings FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS artwork_embeddings_auth_select ON artwork_embeddings;
CREATE POLICY artwork_embeddings_auth_select ON artwork_embeddings FOR SELECT TO authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE ON artwork_embeddings FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON artwork_embeddings FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON artwork_embeddings FROM anon;

-- ───────────────────── clip_embeddings ─────────────────────
ALTER TABLE clip_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clip_embeddings_service_all ON clip_embeddings;
CREATE POLICY clip_embeddings_service_all ON clip_embeddings FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS clip_embeddings_anon_select ON clip_embeddings;
CREATE POLICY clip_embeddings_anon_select ON clip_embeddings FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS clip_embeddings_auth_select ON clip_embeddings;
CREATE POLICY clip_embeddings_auth_select ON clip_embeddings FOR SELECT TO authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE ON clip_embeddings FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON clip_embeddings FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON clip_embeddings FROM anon;

COMMIT;

-- ───────────────────── Post-flight verification ─────────────────────
--
-- Anon SELECT should still return rows for catalog reads:
--   curl -sS "$SUPABASE_URL/rest/v1/entities?select=id,name,type&limit=2" \
--     -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
--   -- expect: 200 with rows
--
-- Anon INSERT should be denied:
--   curl -sS -X POST "$SUPABASE_URL/rest/v1/entities" \
--     -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
--     -H "Content-Type: application/json" \
--     -d '{"id":"probe-deleteme","name":"probe","type":"person"}'
--   -- expect: 401 / 42501 permission denied
