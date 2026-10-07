-- Scoped embedding RPCs: vector search INSIDE a given set of books (#4330, #2753).
--
-- WHY. A partner reading room (bph.sourcelibrary.org, bhutan.…) must show only
-- its own shelf. None of the embedding tables carries a tenant column — measured
-- 2026-10-06: `page_translations`, `book_embeddings`, `artwork_embeddings`,
-- `gallery_text_embeddings` and `clip_embeddings` have no `tenant_id`, and
-- `match_semantic` accepts `filter_tenant_id` and ignores it. So every vector
-- lane ranked the GLOBAL corpus and callers filtered afterwards in Mongo, which
-- is a post-filter: `/api/search/semantic` did not filter at all (the leak in
-- #4330), and the lanes that did were starved (a BPH query whose global top-50
-- holds no BPH page returned nothing).
--
-- WHAT. The scope is the tenant's book-id list, resolved from Mongo
-- (`books.tenantId`, the source of truth the keyword lanes already use) by
-- `src/lib/tenant-search-scope.ts` and passed in as `book_ids`. No denormalised
-- tenant column to backfill or to drift (`clip_embeddings.book_id` already
-- drifts — `.claude/docs/embeddings.md`, "CLIP index truth").
--
-- These are NEW functions, not new parameters on the existing ones: adding a
-- defaulted parameter to `match_books_semantic` creates an overload, and
-- PostgREST then cannot choose between the two for a call that names only the
-- old arguments (the trap `drop-match-semantic-4arg-orphan.sql` cleaned up).
-- The global functions are untouched, so the main site cannot regress.
--
-- THE PLAN IS THE POINT (`.claude/docs/embeddings.md`, #4439). `ORDER BY
-- embedding <=> q LIMIT n` with a WHERE predicate ranks through the HNSW index
-- and filters what the index handed back. The deployed `match_pages_in_books`
-- has exactly that shape and, given a tenant-sized id list, returned 10 rows in
-- 150 ms for an on-topic query and 0 rows for an off-topic one. Every function
-- here ranks inside a subquery fenced with `OFFSET 0`: the subquery has no
-- ORDER BY, so the planner has no ordering to satisfy with a vector index, and
-- the rows are selected by `book_id` first.
--
-- PAGES ARE THE EXCEPTION. A tenant holds 300K–830K page vectors; an exact scan
-- of them did not finish in 90 s. `match_pages_in_scope` therefore does what the
-- librarian already does by hand: pick the nearest books INSIDE the scope from
-- `book_embeddings` (exact, a few thousand rows), rank their pages exactly, and
-- union that with one ordinary HNSW pass for pages whose book summary did not
-- rank. It is bounded work, not exact recall — measure it with
-- `scripts/audit/search-tenant-purity.mjs --recall`.
--
-- Idempotent. Apply with:
--   psql "$SUPABASE_DB_URL" -f scripts/migration/add-scoped-embedding-rpcs.sql
-- The app works before this is applied: a missing function makes the scoped
-- wrappers fall back to the global RPC filtered against the same id list
-- (closed, but starved). Applying it is what restores recall.

-- ── Books ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_books_semantic_in_books(
  query_embedding vector(768),
  book_ids text[],
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 20,
  filter_language text DEFAULT NULL,
  filter_year_min integer DEFAULT NULL,
  filter_year_max integer DEFAULT NULL
)
RETURNS TABLE(book_id text, title text, author text, year integer, language text,
              summary_text text, metadata jsonb, similarity double precision)
LANGUAGE plpgsql STABLE
AS $function$
BEGIN
  RETURN QUERY
  SELECT s.book_id, s.title, s.author, s.year, s.language, s.summary_text,
         s.metadata, 1 - s.dist AS similarity
  FROM (
    SELECT b.book_id, b.title, b.author, b.year, b.language, b.summary_text,
           b.metadata, (b.embedding <=> query_embedding) AS dist
    FROM book_embeddings b
    WHERE b.book_id = ANY(book_ids)
      AND b.embedding IS NOT NULL
      AND (filter_language IS NULL OR b.language = filter_language)
      AND (filter_year_min IS NULL OR b.year >= filter_year_min)
      AND (filter_year_max IS NULL OR b.year <= filter_year_max)
    OFFSET 0
  ) s
  WHERE 1 - s.dist > match_threshold
  ORDER BY s.dist
  LIMIT match_count;
END;
$function$;

-- ── Artworks ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_artworks_semantic_in_books(
  query_embedding halfvec(3072),
  book_ids text[],
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 20,
  filter_genre text DEFAULT NULL,
  filter_period text DEFAULT NULL,
  filter_culture text DEFAULT NULL,
  filter_collection text DEFAULT NULL
)
RETURNS TABLE(book_id text, title text, display_title text, author text, summary_text text,
              subjects text[], figures text[], symbols text[], iconclass text[], technique text,
              period text, culture text, genre text, collections text[], resource_type text,
              thumbnail_url text, ulan_artist integer, similarity double precision)
LANGUAGE plpgsql STABLE
AS $function$
BEGIN
  RETURN QUERY
  SELECT s.book_id, s.title, s.display_title, s.author, s.summary_text,
         s.subjects, s.figures, s.symbols, s.iconclass, s.technique, s.period, s.culture,
         s.genre, s.collections, s.resource_type, s.thumbnail_url, s.ulan_artist,
         (1 - s.dist)::double precision AS similarity
  FROM (
    SELECT ae.book_id, ae.title, ae.display_title, ae.author, ae.summary_text,
           ae.subjects, ae.figures, ae.symbols, ae.iconclass, ae.technique, ae.period, ae.culture,
           ae.genre, ae.collections, ae.resource_type, ae.thumbnail_url, ae.ulan_artist,
           (ae.embedding <=> query_embedding) AS dist
    FROM artwork_embeddings ae
    WHERE ae.book_id = ANY(book_ids)
      AND ae.embedding IS NOT NULL
      AND ae.visible IS NOT FALSE
      AND (filter_genre IS NULL OR ae.genre = filter_genre)
      AND (filter_period IS NULL OR ae.period = filter_period)
      AND (filter_culture IS NULL OR ae.culture = filter_culture)
      AND (filter_collection IS NULL OR filter_collection = ANY(ae.collections))
    OFFSET 0
  ) s
  WHERE 1 - s.dist > match_threshold
  ORDER BY s.dist
  LIMIT match_count;
END;
$function$;

-- ── Gallery image descriptions ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_gallery_text_in_books(
  query_embedding vector(768),
  book_ids text[],
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 20,
  exclude_book_id text DEFAULT NULL
)
RETURNS TABLE(id text, page_id text, book_id text, detection_index integer, similarity double precision)
LANGUAGE plpgsql STABLE
AS $function$
BEGIN
  RETURN QUERY
  SELECT s.id, s.page_id, s.book_id, s.detection_index, 1 - s.dist AS similarity
  FROM (
    SELECT g.id, g.page_id, g.book_id, g.detection_index,
           (g.embedding <=> query_embedding) AS dist
    FROM gallery_text_embeddings g
    WHERE g.book_id = ANY(book_ids)
      AND g.embedding IS NOT NULL
      AND (exclude_book_id IS NULL OR g.book_id != exclude_book_id)
    OFFSET 0
  ) s
  WHERE 1 - s.dist > match_threshold
  ORDER BY s.dist
  LIMIT match_count;
END;
$function$;

-- ── CLIP (text→image and image→image share one table and one shape) ──────
CREATE OR REPLACE FUNCTION public.match_clip_in_books(
  query_embedding vector(512),
  book_ids text[],
  match_threshold double precision DEFAULT 0.20,
  match_count integer DEFAULT 30
)
RETURNS TABLE(id text, source_type text, book_id text, image_url text, title text, author text,
              resource_type text, thumbnail_url text, similarity double precision)
LANGUAGE plpgsql STABLE
AS $function$
BEGIN
  RETURN QUERY
  SELECT s.id, s.source_type, s.book_id, s.image_url, s.title, s.author,
         s.resource_type, s.thumbnail_url, 1 - s.dist AS similarity
  FROM (
    SELECT c.id, c.source_type, c.book_id, c.image_url, c.title, c.author,
           c.resource_type, c.thumbnail_url,
           (c.embedding <=> query_embedding) AS dist
    FROM clip_embeddings c
    WHERE c.book_id = ANY(book_ids)
      AND c.embedding IS NOT NULL
    OFFSET 0
  ) s
  WHERE 1 - s.dist > match_threshold
  ORDER BY s.dist
  LIMIT match_count;
END;
$function$;

-- ── Pages ────────────────────────────────────────────────────────────────
-- Not STABLE: it sets hnsw.ef_search for the near pass (transaction-local).
CREATE OR REPLACE FUNCTION public.match_pages_in_scope(
  query_embedding vector(768),
  book_ids text[],
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 15,
  probe_books integer DEFAULT 12,
  near_candidates integer DEFAULT 200
)
RETURNS TABLE(page_id text, book_id text, page_number integer, translation text,
              book_title text, book_author text, book_language text, book_year integer,
              similarity double precision)
LANGUAGE plpgsql
AS $function$
DECLARE
  probe text[];
BEGIN
  -- 1. The nearest books INSIDE the scope, ranked exactly.
  SELECT array_agg(t.book_id) INTO probe
  FROM (
    SELECT s.book_id
    FROM (
      SELECT b.book_id, (b.embedding <=> query_embedding) AS dist
      FROM book_embeddings b
      WHERE b.book_id = ANY(book_ids) AND b.embedding IS NOT NULL
      OFFSET 0
    ) s
    ORDER BY s.dist
    LIMIT GREATEST(probe_books, 0)
  ) t;

  -- 3 (set up before the query that uses it). The near pass is an ordinary
  -- HNSW post-filter; a wider beam gives the filter more candidates to keep.
  PERFORM set_config('hnsw.ef_search', LEAST(GREATEST(near_candidates, 40), 1000)::text, true);

  RETURN QUERY
  WITH exact AS (
    -- 2. Every page of the probe books, ranked exactly. Ids and distances
    -- only: the page text is fetched for the winners, not for every candidate.
    SELECT s.page_id, s.dist
    FROM (
      SELECT p.page_id, (p.embedding <=> query_embedding) AS dist
      FROM page_translations p
      WHERE p.book_id = ANY(COALESCE(probe, ARRAY[]::text[]))
        AND p.embedding IS NOT NULL
      OFFSET 0
    ) s
    WHERE 1 - s.dist > match_threshold
    ORDER BY s.dist
    LIMIT match_count
  ),
  near AS (
    -- 3. Pages the index ranks highest anywhere, kept only if in scope. Finds
    -- the on-topic page inside a book whose summary did not make the probe.
    SELECT n.page_id, n.dist
    FROM (
      SELECT p.page_id, p.book_id, (p.embedding <=> query_embedding) AS dist
      FROM page_translations p
      WHERE p.embedding IS NOT NULL
      ORDER BY p.embedding <=> query_embedding
      LIMIT LEAST(GREATEST(near_candidates, 0), 1000)
    ) n
    WHERE n.book_id = ANY(book_ids)
      AND 1 - n.dist > match_threshold
  ),
  winners AS (
    SELECT u.page_id, MIN(u.dist) AS dist
    FROM (SELECT * FROM exact UNION ALL SELECT * FROM near) u
    GROUP BY u.page_id
    ORDER BY MIN(u.dist)
    LIMIT match_count
  )
  SELECT p.page_id, p.book_id, p.page_number, p.translation, p.book_title,
         p.book_author, p.book_language, p.book_year, 1 - w.dist AS similarity
  FROM winners w
  JOIN page_translations p ON p.page_id = w.page_id
  -- The join re-reads the row, so re-assert the scope on what is returned.
  WHERE p.book_id = ANY(book_ids)
  ORDER BY w.dist;
END;
$function$;

-- PostgREST caches the schema; without this the new functions 404 until restart.
NOTIFY pgrst, 'reload schema';
