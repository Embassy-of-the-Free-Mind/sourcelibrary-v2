-- Add tenant_id to all five Supabase embedding tables.
--
-- Why: today the Librarian post-filters in JS (over-fetch from Supabase,
-- look up books in Mongo with tenantId:{$in:[null,undefined]}, drop the rest).
-- This starves results when tenant-tagged books dominate top-N — a query
-- mapping strongly to BPH content can have its entire top-24 tenant-tagged,
-- and the main-site user sees nothing even though relevant non-tenant books
-- exist at rank 25+. The proper fix is tenant filtering at the SQL layer.
--
-- Source of truth: books.tenantId in Mongo (NULL = main-site).
-- We DENORMALIZE that value onto each embedding row at write time. The
-- "drift" risk (book is re-tenanted but embeddings stay on old value) is
-- handled by the existing scripts/maintenance/lesson_tenant_promotion_backfill
-- pattern — promotions explicitly backfill all derived stores.
--
-- Semantics for the RPC filter (see update-match-rpcs-tenant-aware.sql):
--   filter_tenant_id IS NULL   → return ONLY rows where tenant_id IS NULL
--                                (= main-site only; mirrors the existing
--                                 Mongo convention tenantId:{$in:[null,undefined]})
--   filter_tenant_id = '<uuid>' → return ONLY rows where tenant_id = '<uuid>'
--                                 (= specific tenant only; for future per-tenant
--                                  Librarian instances)
--
-- NOTE: this changes the implicit semantics of the existing match_semantic
-- RPC's filter_tenant_id parameter from "ignored" to "main-site only when
-- NULL". Callers that previously omitted the parameter and got cross-tenant
-- results will now get main-site only. This is the desired behavior — see
-- the BPH/Bhutan leak handoff for the user-visible bug this prevents.
--
-- Apply:
--   psql "$SUPABASE_DB_URL" -f scripts/migration/add-tenant-id-to-embeddings.sql
-- Then backfill via:
--   set -a; source .env.production.local; set +a
--   node scripts/migration/backfill-embedding-tenant-id.mjs --dry-run
--   node scripts/migration/backfill-embedding-tenant-id.mjs --apply

BEGIN;

-- ── page_translations ────────────────────────────────────────────────
ALTER TABLE page_translations
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE INDEX IF NOT EXISTS page_translations_tenant_id_idx
  ON page_translations (tenant_id);

-- ── book_embeddings ──────────────────────────────────────────────────
ALTER TABLE book_embeddings
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE INDEX IF NOT EXISTS book_embeddings_tenant_id_idx
  ON book_embeddings (tenant_id);

-- ── artwork_embeddings ───────────────────────────────────────────────
ALTER TABLE artwork_embeddings
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE INDEX IF NOT EXISTS artwork_embeddings_tenant_id_idx
  ON artwork_embeddings (tenant_id);

-- ── gallery_text_embeddings ──────────────────────────────────────────
-- (no active writer currently — see PR B notes — but we add the column so
-- the column exists when the writer is re-introduced)
ALTER TABLE gallery_text_embeddings
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE INDEX IF NOT EXISTS gallery_text_embeddings_tenant_id_idx
  ON gallery_text_embeddings (tenant_id);

-- ── clip_embeddings ──────────────────────────────────────────────────
ALTER TABLE clip_embeddings
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE INDEX IF NOT EXISTS clip_embeddings_tenant_id_idx
  ON clip_embeddings (tenant_id);

COMMIT;

-- Sanity counts (run after backfill):
--   SELECT tenant_id, count(*) FROM page_translations       GROUP BY 1 ORDER BY 2 DESC;
--   SELECT tenant_id, count(*) FROM book_embeddings         GROUP BY 1 ORDER BY 2 DESC;
--   SELECT tenant_id, count(*) FROM artwork_embeddings      GROUP BY 1 ORDER BY 2 DESC;
--   SELECT tenant_id, count(*) FROM clip_embeddings         GROUP BY 1 ORDER BY 2 DESC;
