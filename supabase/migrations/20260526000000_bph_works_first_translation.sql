-- Add denormalised `is_first_translation` column to bph_works.
--
-- The signal lives in MongoDB (`books.is_first_translation`, set by
-- `src/lib/verify-first-translation.ts`). The BPH catalogue filter
-- ("First English translation" in the Advanced panel) joined to it by
-- pre-fetching the universe of ids from Atlas and passing them as
-- `bph_works.sl_book_id.in.(…)`, but the set is ~1500 BPH-linked rows —
-- the resulting URL is ~38KB and bursts Cloudflare's URL length cap
-- (414 Request-URI Too Large). Denormalising onto bph_works lets the
-- filter become a single `eq` and avoids the URL-length problem.
--
-- Maintenance: `src/app/api/cron/sync-bph-sl-book-ids` is extended in
-- the same change to PATCH this column alongside `sl_book_id` /
-- `sl_book_slug`. The one-off backfill lives at
-- `scripts/migration/backfill-bph-first-translation.mjs`.

ALTER TABLE bph_works
  ADD COLUMN IF NOT EXISTS is_first_translation BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index — the filter is "tick to show ONLY first translations",
-- not "tick to hide them", so we only need fast lookup for the TRUE side.
CREATE INDEX IF NOT EXISTS bph_works_is_first_translation_idx
  ON bph_works (is_first_translation)
  WHERE is_first_translation = TRUE;
