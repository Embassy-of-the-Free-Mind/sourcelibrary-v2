-- Withheld translations in the semantic-search store (#4523).
--
-- Mongo's `pages.translation` is the source of truth for translation text;
-- `page_translations` holds a derived copy (the snippet a search result shows)
-- plus the vector. When a translation is withheld in Mongo, this row is still
-- reachable: every reader of this table (`match_semantic`,
-- `match_pages_in_books`, `hybrid_search`) selects `p.translation` and gates
-- only on `embedding IS NOT NULL`.
--
-- The fix is the same shape as the Mongo one: MOVE the columns the RPCs read
-- rather than teach three functions a new filter. Changing the live serving
-- RPCs is the risky operation here (see the header of
-- `apply-semantic-language-prefilter.sql` for how a "safe" RPC edit shipped
-- inert and went unnoticed for months); moving the data needs no function
-- change at all, and every RPC drops the row for free because they all require
-- a non-null embedding.
--
-- Nothing is deleted. The snippet and the vector are parked in sibling columns
-- and one UPDATE puts them back. The vector matters: re-embedding 65k pages is
-- paid work, and it is rate-limited by the worker's own daily spend guard.
--
-- Note on self-healing: withholding in Mongo bumps `pages.updated_at`, so
-- `embed-gemini.mjs --incremental` will re-embed these pages from the NEW
-- transcription. `pageEmbeddingInput` falls back to OCR with an EMPTY
-- translation column, so the row comes back correct — new vector, no English.
-- That is the intended end state; the parked columns are the bridge to it.
--
-- Idempotent. Apply with scripts/migration/add-page-translations-withheld.mjs.

ALTER TABLE page_translations
  ADD COLUMN IF NOT EXISTS translation_withheld text,
  ADD COLUMN IF NOT EXISTS embedding_withheld vector(768),
  ADD COLUMN IF NOT EXISTS withheld_at timestamptz,
  ADD COLUMN IF NOT EXISTS withheld_reason text;

COMMENT ON COLUMN page_translations.translation_withheld IS
  'Snippet taken out of service (#4523) because the Mongo translation it mirrors was made from a transcription the page no longer serves. Restore by moving it back to `translation`.';
COMMENT ON COLUMN page_translations.embedding_withheld IS
  'The vector parked alongside translation_withheld. Kept so a restore costs no Gemini calls; every RPC skips the row while `embedding` is NULL.';

-- Small: only withheld rows are indexed, and the audit reads it by reason.
CREATE INDEX IF NOT EXISTS idx_pt_withheld
  ON page_translations (withheld_at)
  WHERE withheld_at IS NOT NULL;
