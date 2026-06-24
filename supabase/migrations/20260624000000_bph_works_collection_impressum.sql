-- bph_works: split provenance/collection + add verbatim original impressum.
-- From Paul Dijstelberge's catalogue feedback (2026-06-24):
--   • "Provenance and collection are two different things, so two separate fields."
--   • "I miss a field where I can note the original impressum as it is.
--      Example: Getruckt vnd verlegt zu Schw. Hall, bey Johann Lentzen, 1641."
--
-- Additive and reversible (DROP COLUMN). The existing single `provenance`
-- column is kept as-is (ownership history); `collection` is the new sibling.
--
-- Run via Supabase SQL editor or:
--   PGPASSWORD=… node scripts/migration/run-supabase-sql.mjs \
--     supabase/migrations/20260624000000_bph_works_collection_impressum.sql

ALTER TABLE bph_works
  ADD COLUMN IF NOT EXISTS collection         TEXT, -- named collection the copy belongs to (distinct from provenance)
  ADD COLUMN IF NOT EXISTS impressum_original TEXT; -- verbatim imprint line as printed on the title page
