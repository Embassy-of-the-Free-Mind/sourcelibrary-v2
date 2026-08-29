-- books_catalog: carry the canonical cover and its 500px AVIF card variant.
--
-- The catalogue (/catalog, /browse, collection grids) renders from this mirror,
-- not from Mongo, and the mirror carried only `thumbnail`. Two consequences:
--
--   1. The card variant added in this PR could never reach the surface that
--      motivated it. Measured 2026-08-26: the 60-card /catalog grid ships
--      43.4 MB of covers (746 KB average, 2000px scans poured into a 265px
--      slot) and its slowest covers take 6-10s. On card variants the same grid
--      is 2.8 MB.
--
--   2. `thumbnail` is not the canonical cover. Of 17,580 live books with both
--      fields set, 4,309 (25%) have `thumbnail` pointing somewhere other than
--      `image_display` — including hotlinked archive.org URLs the R2 migration
--      was meant to retire. So the catalogue renders a different image than the
--      book page for those books, and the card's staleness check (which asks
--      "does image_card still name the same page as image_display?") cannot be
--      answered against `thumbnail` at all.
--
-- Both columns are needed together: getBookCardUrl() refuses `image_card`
-- unless it corresponds to `image_display`, so a mirror with only one of them
-- serves every book the full scan.
--
-- Additive and nullable — rows stay valid until scripts/workers/sync-books-catalog.mjs
-- repopulates them. Apply in the Supabase SQL editor (no SUPABASE_DB_URL in env),
-- then re-run the sync.

ALTER TABLE books_catalog
  ADD COLUMN IF NOT EXISTS image_display text,
  ADD COLUMN IF NOT EXISTS image_card    text;
