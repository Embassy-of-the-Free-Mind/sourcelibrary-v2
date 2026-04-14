-- RPC function for text-to-image CLIP search.
-- Uses the same clip_embeddings table but accepts a text embedding
-- (encoded by CLIP text encoder) to search against image embeddings.
-- This enables "search images by description" without metadata — pure visual semantics.

CREATE OR REPLACE FUNCTION match_clip_text(
  query_embedding vector(512),
  match_threshold FLOAT DEFAULT 0.20,
  match_count INT DEFAULT 30
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
