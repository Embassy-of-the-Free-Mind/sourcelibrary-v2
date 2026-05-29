-- Chunked replacement for align_translations_to_ustc_auto + ambiguous reporter.
--
-- The original RPC tried to do the full 23K-translations × 1.6M-USTC join in
-- one transaction; PostgREST hit the 60s statement_timeout. Chunking by
-- translation_catalogs.id (range) keeps each call under timeout while letting
-- the orchestrator loop until the whole space is covered.
--
-- Idempotent: ON CONFLICT (translation_id, ustc_edition_id) DO NOTHING on
-- the link table — safe to re-run on already-aligned chunks.

CREATE OR REPLACE FUNCTION align_translations_to_ustc_auto(
  author_threshold numeric DEFAULT 0.85,
  title_threshold  numeric DEFAULT 0.85,
  id_start         bigint  DEFAULT 0,
  id_end           bigint  DEFAULT 2147483647
) RETURNS TABLE (inserted_links bigint, processed_translations bigint) AS $$
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
    ON t.author_surname_lower % lower(u.author_1)
    AND t.canonical_work_lower % lower(u.title)
  WHERE
    t.id >= id_start AND t.id < id_end
    AND similarity(t.author_surname_lower, lower(u.author_1)) >= author_threshold
    AND similarity(t.canonical_work_lower, lower(u.title)) >= title_threshold
    AND t.author_surname_lower IS NOT NULL AND t.author_surname_lower <> ''
    AND t.canonical_work_lower IS NOT NULL AND t.canonical_work_lower <> ''
  ON CONFLICT (translation_id, ustc_edition_id) DO NOTHING;
  GET DIAGNOSTICS ins = ROW_COUNT;
  SELECT count(*) INTO tot
    FROM translation_catalogs
    WHERE id >= id_start AND id < id_end
      AND author_surname_lower IS NOT NULL AND author_surname_lower <> ''
      AND canonical_work_lower IS NOT NULL AND canonical_work_lower <> '';
  RETURN QUERY SELECT ins, tot;
END;
$$ LANGUAGE plpgsql;

-- Convenience: the max id in translation_catalogs so the orchestrator knows
-- when to stop chunking.
CREATE OR REPLACE FUNCTION translation_catalogs_max_id()
RETURNS bigint AS $$
  SELECT max(id) FROM translation_catalogs;
$$ LANGUAGE sql STABLE;
