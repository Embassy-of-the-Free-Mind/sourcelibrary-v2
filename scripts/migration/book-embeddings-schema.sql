-- Book-level semantic embeddings for fast discovery search.
-- Model: gemini-embedding-2-preview (768 dims)
-- Source: composed from book_indexes enrichment data (summaries, vocabulary, entities)
-- Issue: #1158

-- Ensure pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Main table: one embedding per book, composed from enrichment data
CREATE TABLE IF NOT EXISTS book_embeddings (
  book_id TEXT PRIMARY KEY,
  title TEXT,
  author TEXT,
  year INT,
  language TEXT,
  summary_text TEXT,              -- the composed text that was embedded
  embedding vector(768) NOT NULL, -- gemini-embedding-2-preview
  metadata JSONB DEFAULT '{}',    -- entity counts, categories, quality_score
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- HNSW index for fast cosine similarity search (~17K rows)
-- m=16, ef_construction=64 is good for <100K vectors
CREATE INDEX IF NOT EXISTS book_embeddings_embedding_idx
  ON book_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Filter indexes for scoped searches
CREATE INDEX IF NOT EXISTS book_embeddings_language_idx
  ON book_embeddings (language);

CREATE INDEX IF NOT EXISTS book_embeddings_year_idx
  ON book_embeddings (year);

-- RPC: semantic book discovery search
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
  RETURN QUERY
  SELECT
    b.book_id,
    b.title,
    b.author,
    b.year,
    b.language,
    b.summary_text,
    b.metadata,
    1 - (b.embedding <=> query_embedding) AS similarity
  FROM book_embeddings b
  WHERE 1 - (b.embedding <=> query_embedding) > match_threshold
    AND (filter_language IS NULL OR b.language = filter_language)
    AND (filter_year_min IS NULL OR b.year >= filter_year_min)
    AND (filter_year_max IS NULL OR b.year <= filter_year_max)
  ORDER BY b.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
