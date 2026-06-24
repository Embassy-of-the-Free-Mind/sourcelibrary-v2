-- Add mongo_updated_at watermark to page_translations.
--
-- Why: page_translations.translation is a denormalized snapshot of Mongo's
-- pages.translation.data, kept in sync only when embed-gemini.mjs runs on
-- a given page. When pages.updated_at advances (re-OCR, re-translation),
-- the Supabase row goes stale — the embedding mismatches the now-different
-- text. Today there is no invalidation signal; the only fix is a periodic
-- "re-embed everything" or hope nobody re-translates.
--
-- The watermark stores the Mongo source page's freshness timestamp at
-- write time. A re-stale scan (see embed-gemini.mjs --restale, added in
-- the same PR) finds rows where Mongo has moved past the watermark and
-- re-embeds them.
--
-- Scope: page_translations only. The other four embedding tables don't
-- need this:
--   book_embeddings   — derived from book_indexes which is rebuilt holistically
--                       by enrich-worker; per-row freshness isn't actionable.
--   artwork_embeddings — derived from artwork metadata which is essentially
--                        immutable post-import.
--   gallery_text_embeddings / clip_embeddings — derived from images which
--                                                don't change.
--
-- Apply:
--   psql "$SUPABASE_DB_URL" -f scripts/migration/add-page-translations-watermark.sql
--
-- Then backfill via:
--   set -a; source .env.production.local; set +a
--   node scripts/migration/backfill-page-translations-watermark.mjs --dry-run
--   node scripts/migration/backfill-page-translations-watermark.mjs --apply

BEGIN;

ALTER TABLE page_translations
  ADD COLUMN IF NOT EXISTS mongo_updated_at TIMESTAMPTZ;

-- Index supports the staleness scan: WHERE mongo_updated_at IS NULL
-- (rows never backfilled) OR comparing against Mongo timestamps fetched
-- in batches. NULL-tolerant index so unbackfilled rows can be found.
CREATE INDEX IF NOT EXISTS page_translations_mongo_updated_at_idx
  ON page_translations (mongo_updated_at NULLS FIRST);

COMMIT;

-- Post-backfill verification:
--   SELECT count(*) FILTER (WHERE mongo_updated_at IS NULL) AS unbackfilled,
--          count(*)                                         AS total
--   FROM page_translations;
