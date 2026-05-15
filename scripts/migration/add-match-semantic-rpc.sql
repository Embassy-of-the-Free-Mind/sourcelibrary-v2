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
-- Tenant filter: page_translations doesn't currently carry a tenant_id column,
-- so we accept the parameter for API compatibility but ignore it. Add a
-- tenant_id column + filter clause once multi-tenant page scoping is needed.

CREATE OR REPLACE FUNCTION match_semantic(
  query_embedding vector(768),
  match_threshold FLOAT DEFAULT 0.3,
  match_count INT DEFAULT 15,
  filter_tenant_id TEXT DEFAULT NULL
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
    -- filter_tenant_id is accepted for API parity with match_books_semantic but
    -- is currently a no-op: page_translations has no tenant_id column.
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Note: relies on the existing HNSW index on page_translations.embedding.
-- If query latency is slow (>1s on 4M rows), check:
--   SELECT indexname FROM pg_indexes WHERE tablename = 'page_translations';
-- Add if missing:
--   CREATE INDEX page_translations_embedding_idx
--     ON page_translations USING hnsw (embedding vector_cosine_ops)
--     WITH (m = 16, ef_construction = 64);
