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
-- language filter strips everything to 0. Fix: when filter_language is set,
-- branch to a sequential-scan path that filters by language FIRST then sorts
-- by similarity. 88K Chinese rows is small enough to scan in <1s. The HNSW
-- index is still used when filter_language is null (the common case).
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
  filter_year_max INT DEFAULT NULL
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
BEGIN
  IF filter_language IS NOT NULL THEN
    -- Language-scoped path: filter first, sort by distance after.
    -- Avoids the HNSW post-filter gotcha where the index returns top-N
    -- nearest vectors globally and the language filter strips them all.
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
    WHERE p.book_language = filter_language
      AND p.embedding IS NOT NULL
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
-- For the language-filtered path, the planner uses a sequential scan with
-- an in-memory sort. If that gets slow (e.g., English at 436K rows), add:
--   CREATE INDEX page_translations_lang_idx
--     ON page_translations (book_language) WHERE embedding IS NOT NULL;
