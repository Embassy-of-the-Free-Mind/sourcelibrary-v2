-- Extend v_index_catalog_works to surface the author-held signal.
--
-- author_held_count/sample populate per-entry via backfill-catalog-author-held.mjs.
-- All entries for a given identity share the same author-held count, so MAX()
-- across the group is the right aggregate.
--
-- Idempotent (CREATE OR REPLACE VIEW). Run after add-index-catalog-author-held.sql.

CREATE OR REPLACE VIEW v_index_catalog_works AS
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
  -- author-held: same for all entries with the same author_normalized,
  -- so max() collapses to that one value (NULL if never computed).
  -- Appended at the end so CREATE OR REPLACE VIEW accepts the addition
  -- (PG only allows adding columns at the tail of an existing view).
  max(author_held_count) AS author_held_count,
  (array_agg(author_held_sample_slug ORDER BY id) FILTER (WHERE author_held_sample_slug IS NOT NULL))[1] AS author_held_sample_slug,
  (array_agg(author_held_sample_id   ORDER BY id) FILTER (WHERE author_held_sample_id   IS NOT NULL))[1] AS author_held_sample_id
FROM dedup
GROUP BY work_key, author_normalized;

COMMENT ON VIEW v_index_catalog_works IS
  'Deduplicated banned-works view: one row per unique (author, work) banned across any combination of Index editions. Includes author-held signal (do we hold ANY book by this author?) distinct from sl_book_id (do we hold THIS work?). Issue #1851.';
