-- Many-to-many link table between modern English translations
-- (translation_catalogs) and the early-modern source editions they translate
-- (ustc_editions, ~1.6M rows covering 1450-1650 European printing).
--
-- Why a join table rather than a foreign key on translation_catalogs:
--   - One translation can map to multiple USTC editions (different printings
--     of the same work — Aldine vs Plantin vs Basel — all the same "work").
--   - One USTC edition can have multiple modern translations (Snell's vs
--     Maxwell-Stuart's vs Gettings' translations of Del Rio's Disquisitionum).
--   - Avoids cluttering translation_catalogs with confidence + provenance
--     fields specific to the link decision.
--
-- Filled by scripts/enrichment/align-translations-to-ustc.mjs.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS translation_catalog_ustc_links (
  id              bigserial PRIMARY KEY,
  translation_id  bigint NOT NULL REFERENCES translation_catalogs(id) ON DELETE CASCADE,
  ustc_edition_id bigint NOT NULL REFERENCES ustc_editions(id) ON DELETE CASCADE,
  author_sim      numeric(4,3) NOT NULL,          -- trigram similarity 0.000-1.000
  title_sim       numeric(4,3) NOT NULL,
  combined_score  numeric(4,3) GENERATED ALWAYS AS (author_sim * title_sim) STORED,
  link_method     text NOT NULL,                  -- 'trigram_auto' | 'llm_judged' | 'curator_confirmed'
  link_confidence text NOT NULL,                  -- 'high' (>0.85 both) | 'medium' (0.5-0.85) | 'low' (<0.5; never auto-inserted)
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (translation_id, ustc_edition_id)
);

CREATE INDEX IF NOT EXISTS idx_tcul_translation     ON translation_catalog_ustc_links (translation_id);
CREATE INDEX IF NOT EXISTS idx_tcul_ustc            ON translation_catalog_ustc_links (ustc_edition_id);
CREATE INDEX IF NOT EXISTS idx_tcul_combined_score  ON translation_catalog_ustc_links (combined_score DESC);

-- pg_trgm indexes on USTC for fast fuzzy joins. ustc_editions is 1.6M rows;
-- without these the alignment scan would table-scan.
CREATE INDEX IF NOT EXISTS idx_ustc_author1_trgm
  ON ustc_editions USING gin (lower(author_1) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ustc_title_trgm
  ON ustc_editions USING gin (lower(title) gin_trgm_ops);

-- RPC: server-side bulk alignment. Computes pg_trgm similarity for all
-- translation × USTC candidates, INSERTs high-confidence matches, returns
-- counts. Runs entirely server-side so we don't shuffle 23K × 1.6M pair
-- candidates over PostgREST.
--
--   SELECT * FROM align_translations_to_ustc_auto();
--                  → auto-inserts pairs with author_sim AND title_sim ≥ 0.85.
--   SELECT * FROM align_translations_to_ustc_auto(0.80, 0.65);
--                  → custom thresholds: author ≥ 0.80, title ≥ 0.65.
CREATE OR REPLACE FUNCTION align_translations_to_ustc_auto(
  author_threshold numeric DEFAULT 0.85,
  title_threshold  numeric DEFAULT 0.85
) RETURNS TABLE (inserted_links bigint, total_translations bigint) AS $$
DECLARE
  ins bigint;
  tot bigint;
BEGIN
  INSERT INTO translation_catalog_ustc_links (
    translation_id, ustc_edition_id, author_sim, title_sim, link_method, link_confidence
  )
  SELECT
    t.id, u.id,
    similarity(t.author_surname_lower, lower(u.author_1))::numeric(4,3),
    similarity(t.canonical_work_lower, lower(u.title))::numeric(4,3),
    'trigram_auto', 'high'
  FROM translation_catalogs t
  JOIN ustc_editions u
    ON t.author_surname_lower % lower(u.author_1)         -- trigger gin/trgm index on USTC side
    AND t.canonical_work_lower % lower(u.title)
  WHERE
    similarity(t.author_surname_lower, lower(u.author_1)) >= author_threshold
    AND similarity(t.canonical_work_lower, lower(u.title)) >= title_threshold
    AND t.author_surname_lower <> ''
    AND t.canonical_work_lower <> ''
  ON CONFLICT (translation_id, ustc_edition_id) DO NOTHING;
  GET DIAGNOSTICS ins = ROW_COUNT;
  SELECT count(*) INTO tot FROM translation_catalogs;
  RETURN QUERY SELECT ins, tot;
END;
$$ LANGUAGE plpgsql;

-- RPC: ambiguous-pair report. Returns translation × USTC pairs in the
-- "medium" similarity zone (between user-supplied lower bound and
-- author_threshold) so an LLM or curator can review. Read-only.
CREATE OR REPLACE FUNCTION align_translations_to_ustc_ambiguous(
  lower_bound      numeric DEFAULT 0.55,
  upper_bound      numeric DEFAULT 0.85,
  per_translation_limit integer DEFAULT 3
) RETURNS TABLE (
  translation_id   bigint,
  ustc_edition_id  bigint,
  author_sim       numeric,
  title_sim        numeric,
  trans_author     text,
  trans_work       text,
  ustc_author      text,
  ustc_title       text,
  ustc_year        integer
) AS $$
BEGIN
  RETURN QUERY
  WITH ranked AS (
    SELECT
      t.id AS tid, u.id AS uid,
      similarity(t.author_surname_lower, lower(u.author_1))::numeric(4,3) AS asim,
      similarity(t.canonical_work_lower, lower(u.title))::numeric(4,3)    AS tsim,
      t.canonical_author AS tauth, t.canonical_work AS twork,
      u.author_1 AS uauth, u.title AS utitle, u.year AS uyear,
      ROW_NUMBER() OVER (
        PARTITION BY t.id
        ORDER BY similarity(t.author_surname_lower, lower(u.author_1)) * similarity(t.canonical_work_lower, lower(u.title)) DESC
      ) AS rn
    FROM translation_catalogs t
    JOIN ustc_editions u
      ON t.author_surname_lower % lower(u.author_1)
      AND t.canonical_work_lower % lower(u.title)
    WHERE
      similarity(t.author_surname_lower, lower(u.author_1)) BETWEEN lower_bound AND upper_bound
      AND similarity(t.canonical_work_lower, lower(u.title))   BETWEEN lower_bound AND upper_bound
      AND NOT EXISTS (
        SELECT 1 FROM translation_catalog_ustc_links l
        WHERE l.translation_id = t.id AND l.ustc_edition_id = u.id
      )
  )
  SELECT tid, uid, asim, tsim, tauth, twork, uauth, utitle, uyear
  FROM ranked
  WHERE rn <= per_translation_limit
  ORDER BY asim * tsim DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Convenience view: each modern translation with its best-matching USTC source(s).
CREATE OR REPLACE VIEW v_translation_with_ustc AS
SELECT
  t.id            AS translation_id,
  t.canonical_author,
  t.canonical_work,
  t.english_title,
  t.translator,
  t.pub_year      AS translation_year,
  t.publisher     AS translation_publisher,
  t.source        AS translation_source,
  u.id            AS ustc_edition_id,
  u.author_1      AS ustc_author,
  u.title         AS ustc_title,
  u.year          AS ustc_year,
  u.place         AS ustc_place,
  u.country       AS ustc_country,
  l.combined_score,
  l.link_confidence,
  l.link_method
FROM translation_catalogs t
LEFT JOIN translation_catalog_ustc_links l ON l.translation_id = t.id
LEFT JOIN ustc_editions u                  ON u.id = l.ustc_edition_id;
