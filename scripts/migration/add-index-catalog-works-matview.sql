-- Materialize v_index_catalog_works.
--
-- The live view re-aggregates all ~62,943 index_catalog_entries into deduped
-- works on every query; with the edition_ids overlap filter + order it runs
-- ~2.6s and was tipping /api/catalogs/works over the role statement_timeout.
-- A materialized view turns that into an indexed table read (<100ms) and lets
-- the API use exact counts again.
--
-- Definition is IDENTICAL to v_index_catalog_works (keep in sync if that view
-- changes — see update-index-catalog-works-view-author-held.sql).
--
-- Run in the Supabase SQL editor (DDL; PostgREST can't do this). Idempotent.

DROP MATERIALIZED VIEW IF EXISTS mv_index_catalog_works;

CREATE MATERIALIZED VIEW mv_index_catalog_works AS
WITH dedup AS (
  SELECT
    e.*,
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
  (array_agg(author ORDER BY
     CASE match_confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC,
     id))[1] AS author,
  (array_agg(title ORDER BY
     CASE match_confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC,
     id))[1] AS title,
  (array_agg(scope ORDER BY
     CASE scope WHEN 'opera_omnia' THEN 0 WHEN 'donec_corrigatur' THEN 1 WHEN 'expurgated' THEN 2 WHEN 'single_work' THEN 3 ELSE 4 END,
     id))[1] AS scope,
  author_normalized,
  array_agg(DISTINCT index_id ORDER BY index_id) AS edition_ids,
  count(DISTINCT index_id) AS edition_count,
  min(condemnation_year) AS first_year,
  max(condemnation_year) AS last_year,
  (array_agg(ustc_sn ORDER BY
     CASE match_confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC,
     id) FILTER (WHERE ustc_sn IS NOT NULL))[1] AS ustc_sn,
  (array_agg(sl_book_id ORDER BY
     CASE match_confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC,
     id) FILTER (WHERE sl_book_id IS NOT NULL))[1] AS sl_book_id,
  (array_agg(sl_book_slug ORDER BY
     CASE match_confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC,
     id) FILTER (WHERE sl_book_slug IS NOT NULL))[1] AS sl_book_slug,
  array_agg(id ORDER BY id) AS entry_ids,
  array_agg(DISTINCT source_book_slug ORDER BY source_book_slug) FILTER (WHERE source_book_slug IS NOT NULL) AS source_book_slugs,
  max(author_held_count) AS author_held_count,
  (array_agg(author_held_sample_slug ORDER BY id) FILTER (WHERE author_held_sample_slug IS NOT NULL))[1] AS author_held_sample_slug,
  (array_agg(author_held_sample_id   ORDER BY id) FILTER (WHERE author_held_sample_id   IS NOT NULL))[1] AS author_held_sample_id
FROM dedup
GROUP BY work_key, author_normalized;

-- Unique index required for REFRESH ... CONCURRENTLY; the rest serve the API's
-- overlap filter, sorts, and held filters.
CREATE UNIQUE INDEX mv_icw_work_key ON mv_index_catalog_works (work_key);
CREATE INDEX mv_icw_edition_ids ON mv_index_catalog_works USING GIN (edition_ids);
CREATE INDEX mv_icw_author ON mv_index_catalog_works (author);
CREATE INDEX mv_icw_first_year ON mv_index_catalog_works (first_year);
CREATE INDEX mv_icw_edition_count ON mv_index_catalog_works (edition_count);
CREATE INDEX mv_icw_sl_book ON mv_index_catalog_works (sl_book_id);
CREATE INDEX mv_icw_author_held ON mv_index_catalog_works (author_held_count);

-- Refresh entrypoint callable from PostgREST (supabase.rpc('refresh_index_catalog_works')).
-- SECURITY DEFINER so the API/service role can refresh without owning the matview.
CREATE OR REPLACE FUNCTION refresh_index_catalog_works()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_index_catalog_works;
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_index_catalog_works() TO authenticated, service_role, anon;
GRANT SELECT ON mv_index_catalog_works TO authenticated, service_role, anon;
