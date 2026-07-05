-- Hidden-artwork semantic-leak fix, DDL half (Layer 1).
-- Paste into the Supabase SQL editor when SUPABASE_DB_URL isn't available to the
-- Node migration script (scripts/migration/add-artwork-visible-filter.mjs, which
-- also does the Mongo-driven `visible=false` backfill).
--
-- Order is safe: the column defaults true and the RPC filters `visible IS NOT
-- FALSE`, so nothing disappears before the hidden-flip backfill runs. After this
-- DDL, run the backfill step (add-artwork-visible-filter.mjs, or the JS-client
-- hidden-flip) to mark the currently-hidden artworks false.

-- 1. Column (fail-safe default)
ALTER TABLE artwork_embeddings ADD COLUMN IF NOT EXISTS visible boolean DEFAULT true;

-- 2. Index
CREATE INDEX IF NOT EXISTS artwork_embeddings_visible_idx ON artwork_embeddings (visible);

-- 3. RPC — same as before plus `AND ae.visible IS NOT FALSE`
DROP FUNCTION IF EXISTS public.match_artworks_semantic(halfvec, double precision, integer, text, text, text, text);
CREATE OR REPLACE FUNCTION public.match_artworks_semantic(
  query_embedding halfvec,
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 20,
  filter_genre text DEFAULT NULL,
  filter_period text DEFAULT NULL,
  filter_culture text DEFAULT NULL,
  filter_collection text DEFAULT NULL
) RETURNS TABLE (
  book_id text, title text, display_title text, author text, summary_text text,
  subjects text[], figures text[], symbols text[], iconclass text[],
  technique text, period text, culture text, genre text, collections text[],
  resource_type text, thumbnail_url text, ulan_artist integer, similarity double precision
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY SELECT
    ae.book_id, ae.title, ae.display_title, ae.author, ae.summary_text,
    ae.subjects, ae.figures, ae.symbols, ae.iconclass, ae.technique, ae.period, ae.culture,
    ae.genre, ae.collections, ae.resource_type, ae.thumbnail_url, ae.ulan_artist,
    (1 - (ae.embedding <=> query_embedding))::float AS similarity
  FROM artwork_embeddings ae
  WHERE (1 - (ae.embedding <=> query_embedding)) > match_threshold
    AND ae.visible IS NOT FALSE
    AND (filter_genre IS NULL OR ae.genre = filter_genre)
    AND (filter_period IS NULL OR ae.period = filter_period)
    AND (filter_culture IS NULL OR ae.culture = filter_culture)
    AND (filter_collection IS NULL OR filter_collection = ANY(ae.collections))
  ORDER BY ae.embedding <=> query_embedding
  LIMIT match_count;
END; $$;
