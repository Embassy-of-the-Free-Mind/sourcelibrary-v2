-- CLIP image embeddings for visual similarity search.
-- Model: clip-vit-base-patch32 (512 dims)
-- Used by /api/identify for image→image matching.

-- Ensure pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Main embeddings table
CREATE TABLE IF NOT EXISTS clip_embeddings (
  id TEXT PRIMARY KEY,              -- book_id or gallery_image composite key
  source_type TEXT NOT NULL,        -- 'artwork', 'book_cover', 'gallery_image'
  book_id TEXT,                     -- source library book id
  image_url TEXT NOT NULL,          -- URL that was embedded
  embedding vector(512) NOT NULL,   -- CLIP ViT-B/32 embedding
  title TEXT,                       -- denormalized for display
  author TEXT,                      -- denormalized for display
  resource_type TEXT,               -- 'print', 'painting', etc.
  thumbnail_url TEXT,               -- for result display
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- IVFFlat index for fast similarity search (tune lists after backfill)
-- For ~10K vectors, lists=32 is reasonable. Re-tune if >50K.
CREATE INDEX IF NOT EXISTS clip_embeddings_embedding_idx
  ON clip_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 32);

-- Index for filtering by source type
CREATE INDEX IF NOT EXISTS clip_embeddings_source_type_idx
  ON clip_embeddings (source_type);

-- Index for book_id lookups
CREATE INDEX IF NOT EXISTS clip_embeddings_book_id_idx
  ON clip_embeddings (book_id);

-- RPC function for visual similarity search
CREATE OR REPLACE FUNCTION match_clip_images(
  query_embedding vector(512),
  match_threshold FLOAT DEFAULT 0.25,
  match_count INT DEFAULT 20
)
RETURNS TABLE (
  id TEXT,
  source_type TEXT,
  book_id TEXT,
  image_url TEXT,
  title TEXT,
  author TEXT,
  resource_type TEXT,
  thumbnail_url TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.source_type,
    c.book_id,
    c.image_url,
    c.title,
    c.author,
    c.resource_type,
    c.thumbnail_url,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM clip_embeddings c
  WHERE 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
