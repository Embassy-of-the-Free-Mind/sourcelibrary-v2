-- Global page-level semantic search RPC.
-- Companion to match_books_semantic (book-level) and match_pages_in_books (scoped).
-- Used by semanticPageSearchGlobal in src/lib/semantic-search.ts.
--
-- Why this RPC didn't exist: the lib function semanticPageSearchGlobal was added
-- before the SQL function was deployed. It silently returned empty results for
-- months because supabase.rpc() rejects with "function not found" and the lib
-- catches the error and returns []. Discovered 2026-05-15 while shipping the
-- MCP search_concept tool that depends on this.
--
-- Cross-lingual gotcha (fixed 2026-05-17): HNSW + post-filter returns 0 rows
-- when filter_language scopes the result set to a language that doesn't appear
-- in the top-N nearest neighbors of the query. Example: an English query for
-- "medicinal herbs" finds Latin/English passages in the top 200, so a Chinese
-- language filter strips everything to 0. Fix: when filter_language(s) is set,
-- branch to a sequential-scan path that filters by language FIRST then sorts
-- by similarity. 88K Chinese rows is small enough to scan in <1s. The HNSW
-- index is still used when no language filter is set (the common case).
--
-- Plural-form extension (2026-05-17): filter_languages and filter_exclude_languages
-- accept arrays for multi-language queries (e.g. ["Chinese","Sanskrit","Arabic"]
-- or excluding ["Latin","German","English","French"] to focus on non-Western
-- traditions). Both also branch to seq scan to avoid the HNSW post-filter gotcha.
--
-- Tenant filter: page_translations doesn't currently carry a tenant_id column,
-- so we accept the parameter for API compatibility but ignore it.

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
BEGIN
  IF has_language_filter THEN
    -- Language-scoped path: filter first, sort by distance after.
    -- Avoids the HNSW post-filter gotcha where the index returns top-N
    -- nearest vectors globally and a language filter strips them all.
    -- Uses the partial index page_translations_lang_idx for the include cases.
    RETURN QUERY
    SELECT
      p.page_id,
      p.book_id,
      p.page_number,
      p.translation,
      p.book_title,
      p.book_author,
      p.book_language,
      p.book_year,
      1 - (p.embedding <=> query_embedding) AS similarity
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
    LIMIT match_count;
  ELSE
    -- HNSW path: index scan over the full table.
    RETURN QUERY
    SELECT
      p.page_id,
      p.book_id,
      p.page_number,
      p.translation,
      p.book_title,
      p.book_author,
      p.book_language,
      p.book_year,
      1 - (p.embedding <=> query_embedding) AS similarity
    FROM page_translations p
    WHERE p.embedding IS NOT NULL
      AND 1 - (p.embedding <=> query_embedding) > match_threshold
      AND (filter_year_min IS NULL OR p.book_year >= filter_year_min)
      AND (filter_year_max IS NULL OR p.book_year <= filter_year_max)
    ORDER BY p.embedding <=> query_embedding
    LIMIT match_count;
  END IF;
END;
$$;

-- Note: relies on the existing HNSW index on page_translations.embedding.
-- If query latency is slow (>1s on 4M rows), check:
--   SELECT indexname FROM pg_indexes WHERE tablename = 'page_translations';
-- Add if missing:
--   CREATE INDEX page_translations_embedding_idx
--     ON page_translations USING hnsw (embedding vector_cosine_ops)
--     WITH (m = 16, ef_construction = 64);
--
-- For the language-filtered path, the planner uses the partial index
-- page_translations_lang_idx on (book_language) WHERE embedding IS NOT NULL.
-- Created 2026-05-17; brings English filtered queries from 450ms → 200ms.
