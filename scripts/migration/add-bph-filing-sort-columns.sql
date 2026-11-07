-- Filing order for the BPH catalogue: sort authors and titles the way a card
-- catalogue files them, ignoring leading brackets, parentheses and quotes.
--
-- Cataloguers bracket an attributed author ("[Fludd, Robert]") and quote or
-- bracket some titles ("[Cyrillic:] Aurora"). Sorted on the raw column, every
-- bracketed record files ahead of "A": 199 of the first 200 rows of the whole
-- catalogue in Author A-Z began with a bracket or parenthesis (2026-11-06).
--
-- Two generated columns, so nothing is written to any catalogue field:
--   author_sort, title_sort = lower(value) with leading non-alphanumerics removed,
--   NULL when nothing is left, so empty values still sort last.
--
-- Integrity monitor: bph_row_hashes() names its columns explicitly, so these two
-- are not hashed and the nightly scan sees no change. They are derived, like the
-- *_norm columns. The restore script treats them as generated
-- (KNOWN_GENERATED in scripts/maintenance/restore-bph-catalog.mjs).
--
-- regexp_replace and lower are IMMUTABLE, as a generation expression requires.
-- Adding a stored generated column rewrites the table once (~30K rows, seconds)
-- and fires no row triggers.
--
-- Run via psql:
--   psql "$SUPABASE_DB_URL" -f scripts/migration/add-bph-filing-sort-columns.sql

BEGIN;

ALTER TABLE bph_works
  ADD COLUMN IF NOT EXISTS author_sort text GENERATED ALWAYS AS (
    NULLIF(lower(regexp_replace(COALESCE(author, ''), '^[^[:alnum:]]+', '')), '')
  ) STORED,
  ADD COLUMN IF NOT EXISTS title_sort text GENERATED ALWAYS AS (
    NULLIF(lower(regexp_replace(COALESCE(title, full_title, ''), '^[^[:alnum:]]+', '')), '')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_bph_author_sort ON bph_works (author_sort);
CREATE INDEX IF NOT EXISTS idx_bph_title_sort ON bph_works (title_sort);

COMMIT;

-- PostgREST caches the schema; tell it about the new columns.
NOTIFY pgrst, 'reload schema';
