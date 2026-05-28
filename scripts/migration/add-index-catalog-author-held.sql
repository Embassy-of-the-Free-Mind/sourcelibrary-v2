-- Author-held signal for index_catalog_entries.
--
-- Most Index entries cite a *specific* expurgated work (e.g. Erasmus's
-- "Annotationes in D. Cyprianum") that SL doesn't carry as a standalone
-- title. The work-level `sl_book_id` correctly stays NULL — but the AUTHOR
-- is held: SL has 42 Erasmus books. The UI should distinguish:
--
--   sl_book_id IS NOT NULL        →  "we hold this exact work"
--   author_held_count > 0         →  "we hold N books by this author"
--   neither                       →  "we don't hold the author at all"
--
-- This collapses the 92%-unmatched figure into three meaningfully different
-- categories. ~30% of unmatched entries fall in the "author held" middle
-- band (Erasmus, Augustinus, Hieronymus, Stephanus, …).
--
-- Backfilled by scripts/backfill-catalog-author-held.mjs.
-- Re-runnable; idempotent.

ALTER TABLE index_catalog_entries
  ADD COLUMN IF NOT EXISTS author_held_count       INTEGER,
  ADD COLUMN IF NOT EXISTS author_held_sample_slug TEXT,
  ADD COLUMN IF NOT EXISTS author_held_sample_id   TEXT;

CREATE INDEX IF NOT EXISTS ix_ice_author_held
  ON index_catalog_entries(author_held_count)
  WHERE author_held_count IS NOT NULL AND author_held_count > 0;

COMMENT ON COLUMN index_catalog_entries.author_held_count IS
  'Number of visible SL books authored by the same person as this Index entry. NULL = never computed; 0 = computed and author not held. Distinct from sl_book_id, which is the specific-work link.';
COMMENT ON COLUMN index_catalog_entries.author_held_sample_slug IS
  'Slug of one representative SL book by the same author. For "Browse N books by X at SL →" link.';
