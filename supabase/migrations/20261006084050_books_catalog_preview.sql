-- books_catalog: mirror `books.preview` so catalogue-fed cards can show the
-- "Preview" badge on partial scans.
--
-- `books.preview` is true when a source (e.g. museumsofindia) hosts only a few
-- page images of a larger physical manuscript, so the book in Source Library is
-- a partial scan / preview rather than the complete text. It is independent of
-- publication: a preview can be public (listed and readable) while still being
-- a fraction of the full work.
--
-- Additive and nullable — a NULL here means "not a preview", so every existing
-- row stays valid until scripts/workers/sync-books-catalog.mjs repopulates it.
-- Keep the column, the sync transform + projection, BOOK_SELECT and the
-- CatalogBook/CollectionBook interfaces in step — a field in the sync builder
-- but NOT in the projection writes NULL for every book (see
-- scripts/workers/sync-books-catalog.mjs "Move the two together, always").
--
-- Apply with scripts/migration/add-books-catalog-preview.mjs (needs
-- SUPABASE_DB_URL from the keychain), or paste into the Supabase SQL editor.

ALTER TABLE books_catalog
  ADD COLUMN IF NOT EXISTS preview boolean;
