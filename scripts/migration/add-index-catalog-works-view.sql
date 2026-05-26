-- Deduped view across all Index editions (issue #1851).
-- Groups entries that refer to the same banned work appearing in multiple
-- editions of the Index. Lets the UI render one row per work with a column
-- per edition showing which Indexes condemned it.
--
-- Dedup heuristic:
--   - For scope=opera_omnia: dedup on author_normalized alone
--     (Calvin's opera_omnia is the same ban whether it's listed in 1564 or 1704)
--   - For specific works: dedup on author_normalized + first 40 chars of
--     alphanumeric-stripped title (catches OCR variation while keeping
--     different works of the same author distinct)
--
-- Run via Supabase SQL editor or psql. Idempotent (CREATE OR REPLACE VIEW).

CREATE OR REPLACE VIEW v_index_catalog_works AS
WITH dedup AS (
  SELECT
    e.*,
    -- Stable per-work key
    CASE
      WHEN e.scope = 'opera_omnia' THEN
        coalesce(e.author_normalized, '__anon__') || '::*opera*'
      ELSE
        coalesce(e.author_normalized, '__anon__') || '::' ||
        lower(substring(regexp_replace(coalesce(e.title, ''), '[^a-zA-Z0-9 ]', '', 'g') FROM 1 FOR 40))
    END AS work_key
  FROM index_catalog_entries e
)
SELECT
  work_key,
  -- Representative author/title/scope: pick the row with the highest match
  -- confidence; tie-break on entry id for stability.
  (array_agg(author ORDER BY
     CASE match_confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC,
     id))[1] AS author,
  (array_agg(title ORDER BY
     CASE match_confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC,
     id))[1] AS title,
  -- Use most-restrictive scope across editions (opera_omnia wins)
  (array_agg(scope ORDER BY
     CASE scope WHEN 'opera_omnia' THEN 0 WHEN 'donec_corrigatur' THEN 1 WHEN 'expurgated' THEN 2 WHEN 'single_work' THEN 3 ELSE 4 END,
     id))[1] AS scope,
  author_normalized,
  -- Editions
  array_agg(DISTINCT index_id ORDER BY index_id) AS edition_ids,
  count(DISTINCT index_id) AS edition_count,
  min(condemnation_year) AS first_year,
  max(condemnation_year) AS last_year,
  -- Best USTC / SL link across editions
  (array_agg(ustc_sn ORDER BY
     CASE match_confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC,
     id) FILTER (WHERE ustc_sn IS NOT NULL))[1] AS ustc_sn,
  (array_agg(sl_book_id ORDER BY
     CASE match_confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC,
     id) FILTER (WHERE sl_book_id IS NOT NULL))[1] AS sl_book_id,
  (array_agg(sl_book_slug ORDER BY
     CASE match_confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC,
     id) FILTER (WHERE sl_book_slug IS NOT NULL))[1] AS sl_book_slug,
  -- For drill-down (per-edition rows)
  array_agg(id ORDER BY id) AS entry_ids,
  -- Source citation pointers (one per edition where this work appears)
  array_agg(DISTINCT source_book_slug ORDER BY source_book_slug) FILTER (WHERE source_book_slug IS NOT NULL) AS source_book_slugs
FROM dedup
GROUP BY work_key, author_normalized;

COMMENT ON VIEW v_index_catalog_works IS
  'Deduplicated banned-works view: one row per unique (author, work) banned across any combination of Index editions. Used by /api/catalogs/works for the cross-edition column UI. Issue #1851.';
