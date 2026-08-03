-- Qualitative feedback on every review queue.
--
-- A rating scale can only answer the question we thought to ask. Volunteers
-- are domain experts — a Latinist looking at a page knows things our four
-- buttons cannot express ("this isn't a hallucination, it's a bleed-through
-- from the facing leaf", "the description is right but the plate is bound in
-- upside down"). Without somewhere to put that, it is lost.
--
-- Two changes:
--   1. `note` — optional free text attached to any judgment.
--   2. `rating` becomes NULLABLE, so a volunteer can leave a note WITHOUT
--      forcing a rating they don't believe. A note-only row is a real signal
--      ("something is wrong with this item"), and coercing it into one of the
--      buttons would corrupt the rating distribution to preserve a NOT NULL.
--
-- Counting consequence: any rate/agreement statistic must filter
-- `rating IS NOT NULL`. `volunteer_ratings_rated_idx` exists to make that
-- filter cheap and to make the constraint visible to whoever writes the query.

ALTER TABLE volunteer_ratings ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE volunteer_ratings ALTER COLUMN rating DROP NOT NULL;

-- A row with neither a rating nor a note carries no information at all.
ALTER TABLE volunteer_ratings DROP CONSTRAINT IF EXISTS volunteer_ratings_has_signal;
ALTER TABLE volunteer_ratings ADD CONSTRAINT volunteer_ratings_has_signal
  CHECK (rating IS NOT NULL OR (note IS NOT NULL AND length(btrim(note)) > 0));

CREATE INDEX IF NOT EXISTS volunteer_ratings_rated_idx
  ON volunteer_ratings (queue, rating)
  WHERE rating IS NOT NULL;

-- Notes are read far more often than they are written; make the "show me what
-- people actually said" query cheap.
CREATE INDEX IF NOT EXISTS volunteer_ratings_note_idx
  ON volunteer_ratings (created_at DESC)
  WHERE note IS NOT NULL;

COMMENT ON COLUMN volunteer_ratings.note IS
  'Optional free-text from the volunteer. May be present with or without a rating.';
COMMENT ON COLUMN volunteer_ratings.rating IS
  'Queue-specific rating value. NULL means the volunteer left a note only — exclude these from every rate and agreement statistic.';
