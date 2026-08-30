-- books_catalog: mirror `books.content_type` so the catalogue can tell an
-- artwork from a text.
--
-- Artwork records live in the SAME Mongo `books` collection as texts (24,912
-- of 110,016 docs on 2026-08-30). The canonical rule for telling them apart —
-- isArtworkRecord(), now src/lib/artwork-record.ts — needs BOTH markers:
--
--     content_type = 'artwork'                        → artwork
--     content_type set to anything else               → NOT artwork
--     content_type absent, resource_type set          → artwork
--
-- The mirror carried only `resource_type`, so no catalogue-fed surface could
-- apply that rule, and search's book lane rendered the 97 live artwork rows as
-- book cards linking to /book/. Worse, `resource_type` alone cannot be used as
-- the test: one live record ("Babad Tanah Djawi lan Tanah-Tanah ing
-- Sakiwa-Tengenipoen", id 6a197add50f34ce9f2ea4a0d) is a real Javanese
-- chronicle carrying content_type:'text' + resource_type:'text'. Filtering on
-- "resource_type IS NOT NULL" would delete a genuine book from search results.
--
-- Additive and nullable — a NULL here means "unknown", and the rule falls back
-- to resource_type exactly as it does in Mongo, so rows stay valid until
-- scripts/workers/sync-books-catalog.mjs repopulates them.
--
-- Apply with scripts/migration/add-books-catalog-content-type.mjs (needs
-- SUPABASE_DB_URL from the keychain), or paste into the Supabase SQL editor.

ALTER TABLE books_catalog
  ADD COLUMN IF NOT EXISTS content_type text;

-- The only predicate any caller uses is "is this an artwork?", and artworks are
-- ~23% of rows. A partial index on the artwork value keeps the exclusion cheap.
CREATE INDEX IF NOT EXISTS books_catalog_content_type_artwork_idx
  ON books_catalog (content_type)
  WHERE content_type = 'artwork';
