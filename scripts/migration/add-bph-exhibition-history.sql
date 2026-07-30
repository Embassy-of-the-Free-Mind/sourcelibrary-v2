-- Add an "Exhibition history" field to the BPH catalogue.
--
-- Requested by José Bouman (BPH), feedback 2026-07-29: a Notes field recording
-- where a copy has been exhibited, not visible to public visitors, with no
-- length limit. TEXT rather than VARCHAR(n) for exactly that reason — entries
-- accumulate one line per exhibition over a copy's lifetime.
--
-- Staff-only, same treatment as internal_remarks (#3105): the field is rendered
-- on the catalogue entry page for editor+ only and is deliberately absent from
-- every public read path and from search_tsv. Do not add it to the tsvector
-- trigger — indexing it would leak the contents through catalogue search.
--
-- This is additive and nullable, so it is safe to apply before or after the
-- code deploy: the entry page's stacked column fallbacks render fine while the
-- column is missing.
--
-- Run via Supabase SQL editor or psql:
--   psql "$DATABASE_URL" -f scripts/migration/add-bph-exhibition-history.sql

ALTER TABLE bph_works
  ADD COLUMN IF NOT EXISTS exhibition_history TEXT;

COMMENT ON COLUMN bph_works.exhibition_history IS
  'Staff-only: where this copy has been exhibited. Never rendered publicly (editor+ only, like internal_remarks). Unbounded length.';
