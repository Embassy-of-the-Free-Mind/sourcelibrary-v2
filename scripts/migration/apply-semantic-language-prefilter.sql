-- HELD FOR HUMAN APPROVAL — issue #4439.
--
-- This file replaces the THREE LIVE serving RPCs. Running it changes what
-- sourcelibrary.org, /api/search and the public MCP tools return, on the
-- request path, immediately. It is deliberately a separate file from
-- `fix-semantic-language-prefilter.sql` (which only creates `*_prefilter_v2`
-- shadows and is safe to run) so that no sweep, script or half-read
-- instruction can apply it by accident.
--
-- Do not run it until all four of these are true:
--
--   1. `fix-semantic-language-prefilter.sql` has been applied and
--      `scripts/audit/semantic-language-filter-recall.mjs
--       --rpc=match_semantic_prefilter_v2` PASSES against production.
--   2. `EXPLAIN (ANALYZE, BUFFERS)` on the filtered branch of the shadow shows
--      no plain `Index Scan using page_translations_embedding_idx` — reading
--      the SQL and believing it is exactly how the 2026-05-17 fix shipped
--      inert.
--   3. The measured p95 latency of the filtered path is acceptable for the
--      request path. It will NOT be, on pgvector < 0.8.0, for
--      `exclude_languages` — a full scan of 4.5M rows measured 47.6s. See the
--      cost section in `fix-semantic-language-prefilter.sql`.
--   4. Someone has diffed the CURRENT production definitions against the
--      committed ones. `scripts/audit/semantic-language-filter-recall.mjs
--      --dump-defs` prints `pg_get_functiondef` for all three; a committed
--      migration is not evidence of what is deployed.
--
-- Rollback is `add-match-semantic-rpc.sql`, `add-page-texts-table.sql` and
-- `book-embeddings-schema.sql` — the previous bodies are still in the repo, so
-- reverting is re-running those files. Keep the shadows around until this has
-- been live for a while; they cost nothing and they are the A/B.
--
-- The bodies below are byte-identical in behaviour to the `*_prefilter_v2`
-- shadows; only the names differ. Read the rationale there, not here — one
-- explanation, so the two cannot drift.

-- ── page_translations ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION match_semantic(
  query_embedding vector(768),
  match_threshold FLOAT DEFAULT 0.3,
  match_count INT DEFAULT 15,
  filter_tenant_id TEXT DEFAULT NULL,
  filter_language TEXT DEFAULT NULL,
  filter_year_min INT DEFAULT NULL,
  filter_year_max INT DEFAULT NULL,
  filter_languages TEXT[] DEFAULT NULL,
  filter_exclude_languages TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  page_id TEXT,
  book_id TEXT,
  page_number INT,
  translation TEXT,
  book_title TEXT,
  book_author TEXT,
  book_language TEXT,
  book_year INT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
DECLARE
  has_language_filter BOOLEAN := filter_language IS NOT NULL
    OR (filter_languages IS NOT NULL AND array_length(filter_languages, 1) > 0)
    OR (filter_exclude_languages IS NOT NULL AND array_length(filter_exclude_languages, 1) > 0);
  can_iterate BOOLEAN := pgvector_supports_iterative_scan();
BEGIN
  IF NOT has_language_filter THEN
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
$$;

-- ── page_texts ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION match_page_texts(
  query_embedding vector(768),
  filter_lang TEXT,
  match_threshold FLOAT DEFAULT 0.3,
  match_count INT DEFAULT 15,
  filter_language TEXT DEFAULT NULL,
  filter_year_min INT DEFAULT NULL,
  filter_year_max INT DEFAULT NULL,
  filter_languages TEXT[] DEFAULT NULL,
  filter_exclude_languages TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  page_id TEXT,
  book_id TEXT,
  page_number INT,
  translation TEXT,
  book_title TEXT,
  book_author TEXT,
  book_language TEXT,
  book_year INT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
DECLARE
  has_language_filter BOOLEAN := filter_language IS NOT NULL
    OR (filter_languages IS NOT NULL AND array_length(filter_languages, 1) > 0)
    OR (filter_exclude_languages IS NOT NULL AND array_length(filter_exclude_languages, 1) > 0);
  can_iterate BOOLEAN := pgvector_supports_iterative_scan();
BEGIN
  IF NOT has_language_filter THEN
    RETURN QUERY
    SELECT p.page_id, p.book_id, p.page_number, p.text, p.book_title,
           p.book_author, p.book_language, p.book_year,
           1 - (p.embedding <=> query_embedding) AS similarity
    FROM page_texts p
    WHERE p.lang = filter_lang
      AND p.embedding IS NOT NULL
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
      SELECT p.page_id, p.book_id, p.page_number, p.text AS translation,
             p.book_title, p.book_author, p.book_language, p.book_year,
             (p.embedding <=> query_embedding) AS dist
      FROM page_texts p
      WHERE p.lang = filter_lang
        AND p.embedding IS NOT NULL
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
    SELECT p.page_id, p.book_id, p.page_number, p.text AS translation,
           p.book_title, p.book_author, p.book_language, p.book_year,
           (p.embedding <=> query_embedding) AS dist
    FROM page_texts p
    WHERE p.lang = filter_lang
      AND p.embedding IS NOT NULL
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
$$;

-- ── book_embeddings ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION match_books_semantic(
  query_embedding vector(768),
  match_threshold FLOAT DEFAULT 0.3,
  match_count INT DEFAULT 20,
  filter_language TEXT DEFAULT NULL,
  filter_year_min INT DEFAULT NULL,
  filter_year_max INT DEFAULT NULL
)
RETURNS TABLE (
  book_id TEXT,
  title TEXT,
  author TEXT,
  year INT,
  language TEXT,
  summary_text TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  IF filter_language IS NULL THEN
    RETURN QUERY
    SELECT b.book_id, b.title, b.author, b.year, b.language, b.summary_text,
           b.metadata, 1 - (b.embedding <=> query_embedding) AS similarity
    FROM book_embeddings b
    WHERE 1 - (b.embedding <=> query_embedding) > match_threshold
      AND (filter_year_min IS NULL OR b.year >= filter_year_min)
      AND (filter_year_max IS NULL OR b.year <= filter_year_max)
    ORDER BY b.embedding <=> query_embedding
    LIMIT match_count;
    RETURN;
  END IF;

  PERFORM set_config('enable_indexscan', 'off', true);

  RETURN QUERY
  SELECT s.book_id, s.title, s.author, s.year, s.language, s.summary_text,
         s.metadata, 1 - s.dist AS similarity
  FROM (
    SELECT b.book_id, b.title, b.author, b.year, b.language, b.summary_text,
           b.metadata, (b.embedding <=> query_embedding) AS dist
    FROM book_embeddings b
    WHERE b.language = filter_language
      AND (filter_year_min IS NULL OR b.year >= filter_year_min)
      AND (filter_year_max IS NULL OR b.year <= filter_year_max)
    OFFSET 0
  ) s
  WHERE 1 - s.dist > match_threshold
  ORDER BY s.dist
  LIMIT match_count;
END;
$$;
