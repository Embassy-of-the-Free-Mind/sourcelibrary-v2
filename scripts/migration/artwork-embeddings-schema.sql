CREATE TABLE IF NOT EXISTS artwork_embeddings (
  book_id TEXT PRIMARY KEY, title TEXT, author TEXT, display_title TEXT,
  summary_text TEXT NOT NULL, subjects TEXT[], figures TEXT[], symbols TEXT[],
  iconclass TEXT[], technique TEXT, material TEXT, style TEXT, period TEXT,
  culture TEXT, genre TEXT, ulan_artist INTEGER, collections TEXT[],
  -- halfvec(3072), not vector(3072): pgvector HNSW vector_cosine_ops caps at
  -- 2000 dims, so the only way to index a 3072-dim Gemini embedding is via
  -- halfvec (supported up to 4000 dims). See scripts/migration/artwork-embeddings-halfvec.mjs.
  embedding halfvec(3072), resource_type TEXT, thumbnail_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS artwork_embeddings_embedding_idx ON artwork_embeddings USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS artwork_embeddings_collections_idx ON artwork_embeddings USING gin (collections);
CREATE INDEX IF NOT EXISTS artwork_embeddings_genre_idx ON artwork_embeddings (genre);
CREATE INDEX IF NOT EXISTS artwork_embeddings_period_idx ON artwork_embeddings (period);
CREATE INDEX IF NOT EXISTS artwork_embeddings_culture_idx ON artwork_embeddings (culture);

CREATE OR REPLACE FUNCTION match_artworks_semantic(
  query_embedding halfvec, match_threshold float DEFAULT 0.5, match_count int DEFAULT 20,
  filter_genre text DEFAULT NULL, filter_period text DEFAULT NULL,
  filter_culture text DEFAULT NULL, filter_collection text DEFAULT NULL
) RETURNS TABLE (
  book_id text, title text, display_title text, author text, summary_text text,
  subjects text[], figures text[], symbols text[], iconclass text[],
  technique text, period text, culture text, genre text, collections text[],
  resource_type text, thumbnail_url text, ulan_artist integer, similarity float
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY SELECT ae.book_id, ae.title, ae.display_title, ae.author, ae.summary_text,
    ae.subjects, ae.figures, ae.symbols, ae.iconclass, ae.technique, ae.period, ae.culture,
    ae.genre, ae.collections, ae.resource_type, ae.thumbnail_url, ae.ulan_artist,
    1 - (ae.embedding <=> query_embedding) AS similarity
  FROM artwork_embeddings ae
  WHERE 1 - (ae.embedding <=> query_embedding) > match_threshold
    AND (filter_genre IS NULL OR ae.genre = filter_genre)
    AND (filter_period IS NULL OR ae.period = filter_period)
    AND (filter_culture IS NULL OR ae.culture = filter_culture)
    AND (filter_collection IS NULL OR filter_collection = ANY(ae.collections))
  ORDER BY ae.embedding <=> query_embedding LIMIT match_count;
END; $$;
