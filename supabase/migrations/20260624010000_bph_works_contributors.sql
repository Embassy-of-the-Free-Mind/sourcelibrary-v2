-- bph_works: repeatable authors / contributors.
-- From Paul Dijstelberge's feedback (2026-06-24): "There is only one field for
-- author and secondary author. Both should be three / repeatable." Implemented
-- as an "Add author" button backed by our own canonical authors thesaurus
-- (better than VIAF for this corpus), with a role per entry.
--
-- `contributors` is an ordered JSONB array of:
--   { role, name, variant_name?, author_id?, canonical_name? }
-- where author_id links to the canonical `authors` collection (Mongo _id slug).
-- The existing scalar `author`/`editor` columns are kept (primary author drives
-- display, search, and the Atlas mirror); `contributors` is the additive,
-- repeatable layer for co-authors, editors, translators, engravers, etc.
--
-- Additive and reversible (DROP COLUMN). Run via Supabase SQL editor or
-- scripts/migration/run-supabase-sql.mjs.

ALTER TABLE bph_works
  ADD COLUMN IF NOT EXISTS contributors JSONB NOT NULL DEFAULT '[]'::jsonb;
