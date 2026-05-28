-- Add embedding_model column to all five embedding tables.
--
-- Why: when Gemini retires `gemini-embedding-2-preview` (it's still labeled
-- "preview" — see lesson_gemini_preview_suffix_retired.md for what happens
-- when these suffixes get dropped from active models), we need to know
-- which rows are on which model so a migration is mechanical instead of
-- "re-embed everything and pray nothing reads the old vectors mid-flight."
--
-- Coverage:
--   page_translations         — 768d Gemini
--   book_embeddings           — 768d Gemini
--   artwork_embeddings        — 3072d halfvec Gemini
--   gallery_text_embeddings   — 768d Gemini  (legacy `model` column kept; see below)
--   clip_embeddings           — 512d CLIP (Xenova/clip-vit-base-patch32 per clip-server.mjs:25)
--
-- gallery_text_embeddings already has a `model TEXT DEFAULT 'text-embedding-004'`
-- column from its pre-Gemini migration. We KEEP that column intact and add
-- `embedding_model` alongside for cross-table uniformity. Don't drop the legacy
-- column — older rows may genuinely be on text-embedding-004 and the value is
-- ground truth for them.
--
-- Defaults are best-known current-model strings, applied retroactively. Future
-- writes set the column explicitly per worker code (see PR for worker edits).
--
-- Apply (idempotent):
--   psql "$SUPABASE_DB_URL" -f scripts/migration/add-embedding-model-columns.sql

BEGIN;

-- ── page_translations ────────────────────────────────────────────────
ALTER TABLE page_translations
  ADD COLUMN IF NOT EXISTS embedding_model TEXT NOT NULL DEFAULT 'gemini-embedding-2-preview';

CREATE INDEX IF NOT EXISTS page_translations_embedding_model_idx
  ON page_translations (embedding_model);

-- ── book_embeddings ──────────────────────────────────────────────────
ALTER TABLE book_embeddings
  ADD COLUMN IF NOT EXISTS embedding_model TEXT NOT NULL DEFAULT 'gemini-embedding-2-preview';

CREATE INDEX IF NOT EXISTS book_embeddings_embedding_model_idx
  ON book_embeddings (embedding_model);

-- ── artwork_embeddings ───────────────────────────────────────────────
ALTER TABLE artwork_embeddings
  ADD COLUMN IF NOT EXISTS embedding_model TEXT NOT NULL DEFAULT 'gemini-embedding-2-preview';

CREATE INDEX IF NOT EXISTS artwork_embeddings_embedding_model_idx
  ON artwork_embeddings (embedding_model);

-- ── gallery_text_embeddings ──────────────────────────────────────────
-- Legacy `model` column kept for historical truth. New `embedding_model`
-- added for uniform cross-table queries (e.g. "show me all rows still on
-- gemini-embedding-2-preview after we ship v3").
ALTER TABLE gallery_text_embeddings
  ADD COLUMN IF NOT EXISTS embedding_model TEXT NOT NULL DEFAULT 'gemini-embedding-2-preview';

CREATE INDEX IF NOT EXISTS gallery_text_embeddings_embedding_model_idx
  ON gallery_text_embeddings (embedding_model);

-- For rows where the legacy `model` column has a non-Gemini value, propagate
-- it so embedding_model is accurate ground truth instead of the default.
UPDATE gallery_text_embeddings
   SET embedding_model = model
 WHERE model IS NOT NULL
   AND model <> ''
   AND model <> embedding_model;

-- ── clip_embeddings ──────────────────────────────────────────────────
-- Default reflects current CLIP server (scripts/workers/clip-server.mjs:25):
--   const MODEL_ID = 'Xenova/clip-vit-base-patch32'
-- Verified via the server's /health endpoint at clip-server.mjs:87.
ALTER TABLE clip_embeddings
  ADD COLUMN IF NOT EXISTS embedding_model TEXT NOT NULL DEFAULT 'Xenova/clip-vit-base-patch32';

CREATE INDEX IF NOT EXISTS clip_embeddings_embedding_model_idx
  ON clip_embeddings (embedding_model);

COMMIT;

-- Sanity counts (run separately, not in the transaction):
--   SELECT embedding_model, count(*) FROM page_translations         GROUP BY 1;
--   SELECT embedding_model, count(*) FROM book_embeddings           GROUP BY 1;
--   SELECT embedding_model, count(*) FROM artwork_embeddings        GROUP BY 1;
--   SELECT embedding_model, count(*) FROM gallery_text_embeddings   GROUP BY 1;
--   SELECT embedding_model, count(*) FROM clip_embeddings           GROUP BY 1;
