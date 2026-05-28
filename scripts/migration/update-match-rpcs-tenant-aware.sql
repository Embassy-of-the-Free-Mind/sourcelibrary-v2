-- Make all five match_* RPCs tenant-aware.
--
-- This replaces the existing function bodies; column-add migration must run
-- first (add-tenant-id-to-embeddings.sql). All RPCs accept a new
-- filter_tenant_id TEXT DEFAULT NULL parameter with strict semantics:
--
--   filter_tenant_id IS NULL   → return ONLY rows where tenant_id IS NULL
--                                (= main-site only)
--   filter_tenant_id = '<uuid>' → return ONLY rows where tenant_id = '<uuid>'
--                                 (= that tenant only)
--
-- This is a behavior change: previously these RPCs returned cross-tenant
-- results. Callers that were relying on cross-tenant results (the gallery
-- routes when no tenant context was resolved) will now get main-site only.
-- That's the desired behavior — gallery's tenant context already resolves
-- correctly per-host and was just being ignored at the SQL layer.
--
-- All functions use CREATE OR REPLACE so this is idempotent. Apply via:
--   psql "$SUPABASE_DB_URL" -f scripts/migration/update-match-rpcs-tenant-aware.sql

BEGIN;

-- ══════════════════════════════════════════════════════════════════════
-- 1. match_semantic — global page search (page_translations)
-- ══════════════════════════════════════════════════════════════════════
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
    -- Language-scoped seq-scan path (avoids HNSW post-filter starvation)
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
      AND (filter_tenant_id IS NULL AND p.tenant_id IS NULL
           OR filter_tenant_id IS NOT NULL AND p.tenant_id = filter_tenant_id)
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
      AND (filter_tenant_id IS NULL AND p.tenant_id IS NULL
           OR filter_tenant_id IS NOT NULL AND p.tenant_id = filter_tenant_id)
      AND 1 - (p.embedding <=> query_embedding) > match_threshold
      AND (filter_year_min IS NULL OR p.book_year >= filter_year_min)
      AND (filter_year_max IS NULL OR p.book_year <= filter_year_max)
    ORDER BY p.embedding <=> query_embedding
    LIMIT match_count;
  END IF;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════
-- 2. match_books_semantic — book discovery (book_embeddings)
-- ══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION match_books_semantic(
  query_embedding vector(768),
  match_threshold FLOAT DEFAULT 0.3,
  match_count INT DEFAULT 20,
  filter_tenant_id TEXT DEFAULT NULL,
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
    AND (filter_tenant_id IS NULL AND b.tenant_id IS NULL
         OR filter_tenant_id IS NOT NULL AND b.tenant_id = filter_tenant_id)
    AND (filter_language IS NULL OR b.language = filter_language)
    AND (filter_year_min IS NULL OR b.year >= filter_year_min)
    AND (filter_year_max IS NULL OR b.year <= filter_year_max)
  ORDER BY b.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════
-- 3. match_pages_in_books — scoped page search (page_translations subset)
-- ══════════════════════════════════════════════════════════════════════
-- Defense-in-depth: callers should already have done tenant filtering at the
-- book level, but a stray tenant-tagged book_id in the array would leak.
CREATE OR REPLACE FUNCTION match_pages_in_books(
  query_embedding vector(768),
  book_ids TEXT[],
  match_threshold FLOAT DEFAULT 0.3,
  match_count INT DEFAULT 10,
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
  WHERE p.book_id = ANY(book_ids)
    AND p.embedding IS NOT NULL
    AND (filter_tenant_id IS NULL AND p.tenant_id IS NULL
         OR filter_tenant_id IS NOT NULL AND p.tenant_id = filter_tenant_id)
    AND 1 - (p.embedding <=> query_embedding) > match_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════
-- 4. match_artworks_semantic — artwork search (artwork_embeddings)
-- ══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION match_artworks_semantic(
  query_embedding halfvec,
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 20,
  filter_tenant_id text DEFAULT NULL,
  filter_genre text DEFAULT NULL,
  filter_period text DEFAULT NULL,
  filter_culture text DEFAULT NULL,
  filter_collection text DEFAULT NULL
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
    AND (filter_tenant_id IS NULL AND ae.tenant_id IS NULL
         OR filter_tenant_id IS NOT NULL AND ae.tenant_id = filter_tenant_id)
    AND (filter_genre IS NULL OR ae.genre = filter_genre)
    AND (filter_period IS NULL OR ae.period = filter_period)
    AND (filter_culture IS NULL OR ae.culture = filter_culture)
    AND (filter_collection IS NULL OR filter_collection = ANY(ae.collections))
  ORDER BY ae.embedding <=> query_embedding LIMIT match_count;
END; $$;

-- ══════════════════════════════════════════════════════════════════════
-- 5. match_gallery_text — gallery image text search (gallery_text_embeddings)
-- ══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION match_gallery_text(
  query_embedding VECTOR(768),
  match_threshold FLOAT DEFAULT 0.3,
  match_count INT DEFAULT 20,
  filter_tenant_id TEXT DEFAULT NULL,
  exclude_book_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  id TEXT,
  page_id TEXT,
  book_id TEXT,
  detection_index INT,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    g.id,
    g.page_id,
    g.book_id,
    g.detection_index,
    1 - (g.embedding <=> query_embedding) AS similarity
  FROM gallery_text_embeddings g
  WHERE (exclude_book_id IS NULL OR g.book_id != exclude_book_id)
    AND (filter_tenant_id IS NULL AND g.tenant_id IS NULL
         OR filter_tenant_id IS NOT NULL AND g.tenant_id = filter_tenant_id)
    AND 1 - (g.embedding <=> query_embedding) > match_threshold
  ORDER BY g.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ══════════════════════════════════════════════════════════════════════
-- 6. match_clip_images — visual similarity search (clip_embeddings)
-- ══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION match_clip_images(
  query_embedding vector(512),
  match_threshold FLOAT DEFAULT 0.25,
  match_count INT DEFAULT 20,
  filter_tenant_id TEXT DEFAULT NULL
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
    AND (filter_tenant_id IS NULL AND c.tenant_id IS NULL
         OR filter_tenant_id IS NOT NULL AND c.tenant_id = filter_tenant_id)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════
-- 7. match_clip_text — text-to-image CLIP search (same clip_embeddings)
-- ══════════════════════════════════════════════════════════════════════
-- Same table as match_clip_images, different RPC name reflecting the input
-- type (text-encoded CLIP embedding) for callers like the gallery text
-- search and the visual search endpoints.
CREATE OR REPLACE FUNCTION match_clip_text(
  query_embedding vector(512),
  match_threshold FLOAT DEFAULT 0.20,
  match_count INT DEFAULT 30,
  filter_tenant_id TEXT DEFAULT NULL
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
    AND (filter_tenant_id IS NULL AND c.tenant_id IS NULL
         OR filter_tenant_id IS NOT NULL AND c.tenant_id = filter_tenant_id)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

COMMIT;
