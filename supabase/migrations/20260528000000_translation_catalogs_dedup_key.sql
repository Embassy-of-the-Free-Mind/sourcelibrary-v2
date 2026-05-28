-- Add UNIQUE constraint to translation_catalogs so the harvest script
-- (scripts/enrichment/harvest-ft-into-translation-catalogs.mjs) can use
-- ON CONFLICT … DO UPDATE … to ratchet up the source-confidence tier
-- without duplicating rows.
--
-- Confidence ratchet order (highest wins):
--   sl_ft_curator_confirmed > unesco_master > sl_ft_catalog_verified >
--   sl_ft_web_grounded > loc_marc > hathitrust > openlibrary >
--   sl_ft_llm_claim > everything else
--
-- The ratchet is implemented in the harvest script (it picks the higher
-- tier when an ON CONFLICT fires); the DB only enforces uniqueness here.
--
-- Dedup key chosen for these reasons:
--   - canonical_author_lower + canonical_work_lower: identifies the work
--   - lower(translator): same work, different translators = distinct rows
--   - pub_year: same work + translator across editions/years = distinct rows
--   - NULLS NOT DISTINCT so multiple unknown translators (NULL) for the
--     same canonical_work+author don't all collide; needs Postgres 15+,
--     which Supabase ships.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Drop the GIN trgm index temporarily — UNIQUE creation can be slow with
-- it active. Re-add after.
DROP INDEX IF EXISTS idx_tc_english_title_trgm;

-- Backfill the lower-cased translator column we'll need for the UNIQUE key
-- (existing schema has english_title_lower / canonical_work_lower /
-- author_surname_lower as STORED generated cols; translator wasn't lowered).
ALTER TABLE translation_catalogs
  ADD COLUMN IF NOT EXISTS translator_lower text
  GENERATED ALWAYS AS (lower(translator)) STORED;

-- Drop any existing dup rows that would block the constraint creation.
-- "Keep highest-source-tier row, drop the rest" — implemented as a CTE.
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY canonical_author_lower, canonical_work_lower, translator_lower, pub_year
      ORDER BY CASE source
        WHEN 'sl_ft_curator_confirmed' THEN 1
        WHEN 'unesco_master' THEN 2
        WHEN 'sl_ft_catalog_verified' THEN 3
        WHEN 'sl_ft_web_grounded' THEN 4
        WHEN 'loc_marc' THEN 5
        WHEN 'extended_unesco_index_translationum' THEN 6
        WHEN 'hathitrust' THEN 7
        WHEN 'openlibrary' THEN 8
        WHEN 'validated_additions' THEN 9
        WHEN 'sl_ft_llm_claim' THEN 99
        ELSE 50
      END,
      id  -- tiebreak: keep oldest
    ) AS rn
  FROM translation_catalogs
)
DELETE FROM translation_catalogs WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- The actual UNIQUE constraint.
ALTER TABLE translation_catalogs
  ADD CONSTRAINT translation_catalogs_dedup_key
  UNIQUE NULLS NOT DISTINCT (
    canonical_author_lower,
    canonical_work_lower,
    translator_lower,
    pub_year
  );

-- Restore the trigram index.
CREATE INDEX IF NOT EXISTS idx_tc_english_title_trgm
  ON translation_catalogs USING gin (english_title_lower gin_trgm_ops);

-- Index for fast author+work lookups by the verify-translation agent.
CREATE INDEX IF NOT EXISTS idx_tc_author_work
  ON translation_catalogs (canonical_author_lower, canonical_work_lower);
