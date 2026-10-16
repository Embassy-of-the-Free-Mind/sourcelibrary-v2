-- match_semantic, no-filter branch: hnsw.ef_search 100 (#5853, decided by the arbiter under #6553, 2026-10-16).
--
-- Written from the LIVE definition (pg_get_functiondef, 2026-10-16), not from an older file in this directory,
-- so it changes one thing: the no-filter branch sets ef_search 100, as the filtered branch already does. The
-- 7-argument overload is not called by the app (src/lib/semantic-search.ts passes filter_languages) and is left
-- alone. Rollback: re-run this file without the PERFORM line in the first branch.
--
-- Apply: psql "$SUPABASE_DB_URL" -f scripts/migration/match-semantic-nofilter-ef100-5853.sql
-- Verify: in one transaction, SELECT count(*) FROM match_semantic(<a stored vector>, 0.3, 40); then
--         SELECT current_setting('hnsw.ef_search');  -- 100

CREATE OR REPLACE FUNCTION public.match_semantic(query_embedding vector, match_threshold double precision DEFAULT 0.3, match_count integer DEFAULT 15, filter_tenant_id text DEFAULT NULL::text, filter_language text DEFAULT NULL::text, filter_year_min integer DEFAULT NULL::integer, filter_year_max integer DEFAULT NULL::integer, filter_languages text[] DEFAULT NULL::text[], filter_exclude_languages text[] DEFAULT NULL::text[])
 RETURNS TABLE(page_id text, book_id text, page_number integer, translation text, book_title text, book_author text, book_language text, book_year integer, similarity double precision)
 LANGUAGE plpgsql
AS $function$
DECLARE
  has_language_filter BOOLEAN := filter_language IS NOT NULL
    OR (filter_languages IS NOT NULL AND array_length(filter_languages, 1) > 0)
    OR (filter_exclude_languages IS NOT NULL AND array_length(filter_exclude_languages, 1) > 0);
  can_iterate BOOLEAN := pgvector_supports_iterative_scan();
BEGIN
  IF NOT has_language_filter THEN
    -- #5853: 100, not the session default 40. On 138 by-eye queries recall@10 52 -> 55 and recall@40 67 -> 73,
    -- at p50 642 -> 1184 ms cold (warm repeats ~30 ms at any setting). Bodhicaryavatara p.13 was dropped by the
    -- index at 40. Transaction-local, like the filtered branch below.
    PERFORM set_config('hnsw.ef_search', '100', true);
    RETURN QUERY
    SELECT p.page_id, p.book_id, p.page_number, p.translation, p.book_title,
           p.book_author, p.book_language, p.book_year,
           1 - (p.embedding <=> query_embedding) AS similarity
    FROM page_translations p
    WHERE p.embedding IS NOT NULL
      AND 1 - (p.embedding <=> query_embedding) > match_threshold
      AND (filter_year_min IS NULL OR p.book_year >= filter_year_min)
      AND (filter_year_max IS NULL OR p.book_year <= filter_year_max)
    ORDER BY p.embedding <=> query_embedding
    LIMIT match_count;
    RETURN;
  END IF;

  IF can_iterate THEN
    PERFORM set_config('hnsw.iterative_scan', 'relaxed_order', true);
    PERFORM set_config('hnsw.max_scan_tuples', '50000', true);
    PERFORM set_config('hnsw.ef_search', '100', true);

    RETURN QUERY
    SELECT s.page_id, s.book_id, s.page_number, s.translation, s.book_title,
           s.book_author, s.book_language, s.book_year, 1 - s.dist AS similarity
    FROM (
      SELECT p.page_id, p.book_id, p.page_number, p.translation, p.book_title,
             p.book_author, p.book_language, p.book_year,
             (p.embedding <=> query_embedding) AS dist
      FROM page_translations p
      WHERE p.embedding IS NOT NULL
        AND (filter_language IS NULL OR p.book_language = filter_language)
        AND (filter_languages IS NULL OR array_length(filter_languages, 1) IS NULL
             OR p.book_language = ANY(filter_languages))
        AND (filter_exclude_languages IS NULL OR array_length(filter_exclude_languages, 1) IS NULL
             OR p.book_language IS NULL OR NOT (p.book_language = ANY(filter_exclude_languages)))
        AND 1 - (p.embedding <=> query_embedding) > match_threshold
        AND (filter_year_min IS NULL OR p.book_year >= filter_year_min)
        AND (filter_year_max IS NULL OR p.book_year <= filter_year_max)
      ORDER BY p.embedding <=> query_embedding
      LIMIT match_count
    ) s
    ORDER BY s.dist;
    RETURN;
  END IF;

  PERFORM set_config('enable_indexscan', 'off', true);

  RETURN QUERY
  SELECT s.page_id, s.book_id, s.page_number, s.translation, s.book_title,
         s.book_author, s.book_language, s.book_year, 1 - s.dist AS similarity
  FROM (
    SELECT p.page_id, p.book_id, p.page_number, p.translation, p.book_title,
           p.book_author, p.book_language, p.book_year,
           (p.embedding <=> query_embedding) AS dist
    FROM page_translations p
    WHERE p.embedding IS NOT NULL
      AND (filter_language IS NULL OR p.book_language = filter_language)
      AND (filter_languages IS NULL OR array_length(filter_languages, 1) IS NULL
           OR p.book_language = ANY(filter_languages))
      AND (filter_exclude_languages IS NULL OR array_length(filter_exclude_languages, 1) IS NULL
           OR p.book_language IS NULL OR NOT (p.book_language = ANY(filter_exclude_languages)))
      AND (filter_year_min IS NULL OR p.book_year >= filter_year_min)
      AND (filter_year_max IS NULL OR p.book_year <= filter_year_max)
    OFFSET 0
  ) s
  WHERE 1 - s.dist > match_threshold
  ORDER BY s.dist
  LIMIT match_count;
END;
$function$;
