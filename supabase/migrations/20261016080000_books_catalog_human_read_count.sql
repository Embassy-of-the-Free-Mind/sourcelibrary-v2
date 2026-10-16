-- books_catalog: mirror `books.human_read_count`, the human-only reading-visit counter (#5048), so the
-- "popular" sort in src/lib/books-catalog.ts can order by people rather than by proxy pools.
--
-- `read_count` stays as the legacy counter. `human_read_count` counts a reading visit once, at its second
-- human read event for the book from the same /24 within an hour, since 2026-07-29 (the first classified
-- event), excluding the user agents in src/lib/human-read-fingerprints.json.
--
-- Additive; existing rows read 0 until scripts/maintenance/rebuild-human-read-count-5048.mjs or the sync
-- worker fills them. Applied 2026-10-16 by job arb-data-cl.

ALTER TABLE books_catalog
  ADD COLUMN IF NOT EXISTS human_read_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_bc_human_read_count
  ON books_catalog (human_read_count DESC) WHERE visible = true;
