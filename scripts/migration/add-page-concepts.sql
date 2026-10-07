-- page_concepts: the concept-abstract lane, stage 1 (#6173).
--
-- PRIOR ART: scripts/migration/add-scoped-embedding-rpcs.sql (#6132) — the
-- fenced in-scope ranking the scoped function below copies; the `site_pages`
-- table (RLS on, a read-only policy for anon) is the access pattern. Neither
-- holds a per-page vector of anything but the page's own text.
--
-- WHAT. One row per page: a 2–4 sentence, model-written abstract of the ideas
-- on the page, in neutral language with no technical terms or proper names
-- (prompt `concept-abstract-v1`, scripts/lib/concept-abstract.mjs), and its
-- 768-d embedding (gemini-embedding-2-preview, plain text: the page model). The
-- pilot (scripts/eval/experiments/2026-10-07-embedding-granularity-cross-tradition.md)
-- found this lane put more traditions into a concept query's first ten results
-- than the page vectors do. Stage 1 holds ~2,000 books; the corpus-wide pass is
-- a separate decision that waits on stage 1's re-test.
--
-- THE ABSTRACT IS AN INDEX KEY, NOT TEXT TO SHOW. The RPCs return the PAGE's
-- own text (from page_translations) as the snippet, never the abstract: a
-- model paraphrase quoted as the page is the misquote class in
-- `.claude/docs/invariants/quote-and-snippet-integrity.md`. The abstract column
-- is kept for judging and debugging; no read path returns it.
--
-- WHY A SEPARATE TABLE, not a column on page_translations: that table is
-- ~6.9M rows behind four read paths; a second vector column there means a
-- second HNSW index over the whole table to serve ~0.4M rows. A sibling costs
-- the page lane nothing, like page_texts (#4095).
--
-- halfvec: 768 dims fit `vector`, but halfvec halves the row and the index
-- (2 × 768 + 8 bytes) at no measurable retrieval cost (artwork_embeddings
-- already uses it). The RPCs take the same `vector(768)` the app sends to every
-- other match_* function and cast it.
--
-- Tenant scope (#4330, #6132): the global function ranks the whole lane and is
-- for the main site only; `src/lib/semantic-search.ts` calls the `_in_books`
-- function under a tenant scope and returns nothing under a closed one. That
-- function selects by book_id first and ranks inside a subquery fenced with
-- OFFSET 0, so the HNSW index cannot turn the scope into a post-filter. Stage 1
-- is ~0.4M rows, so an exact scan of a tenant's share of it is cheap.
--
-- Idempotent. Apply with:
--   psql "$SUPABASE_DB_URL" -f scripts/migration/add-page-concepts.sql
-- Loading rows: scripts/batch/concept-abstracts.mjs load.

CREATE TABLE IF NOT EXISTS public.page_concepts (
  page_id         text PRIMARY KEY,
  book_id         text NOT NULL,
  page_number     integer,
  abstract        text NOT NULL,
  abstract_hash   text NOT NULL,          -- contentHash of `abstract`; equals pages.concept_abstract.content_hash
  prompt_version  text NOT NULL,          -- e.g. concept-abstract-v1
  model           text NOT NULL,          -- the model that wrote the abstract
  run             text NOT NULL,          -- e.g. concept-abstract-6173-s1
  embedding_model text NOT NULL DEFAULT 'gemini-embedding-2-preview',
  embedding       halfvec(768) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS page_concepts_book_id_idx ON public.page_concepts (book_id);
CREATE INDEX IF NOT EXISTS page_concepts_embedding_idx
  ON public.page_concepts USING hnsw (embedding halfvec_cosine_ops);

ALTER TABLE public.page_concepts ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'page_concepts' AND policyname = 'page_concepts_read') THEN
    CREATE POLICY page_concepts_read ON public.page_concepts FOR SELECT TO anon, authenticated USING (true);
  END IF;
END $$;
-- Read-only for the public roles: start from nothing, grant SELECT.
REVOKE ALL ON public.page_concepts FROM anon, authenticated;
GRANT SELECT ON public.page_concepts TO anon, authenticated;

-- ── Global (main site only) ──────────────────────────────────────────────
-- Not STABLE: it sets hnsw.ef_search (transaction-local).
CREATE OR REPLACE FUNCTION public.match_page_concepts(
  query_embedding vector(768),
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 15
)
RETURNS TABLE(page_id text, book_id text, page_number integer, translation text,
              book_title text, book_author text, book_language text, book_year integer,
              similarity double precision)
LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM set_config('hnsw.ef_search', LEAST(GREATEST(match_count * 4, 40), 400)::text, true);
  RETURN QUERY
  WITH near AS (
    SELECT c.page_id, c.book_id, c.page_number, (c.embedding <=> query_embedding::halfvec(768)) AS dist
    FROM page_concepts c
    ORDER BY c.embedding <=> query_embedding::halfvec(768)
    LIMIT LEAST(GREATEST(match_count, 1), 100)
  )
  SELECT n.page_id, n.book_id, n.page_number, p.translation, p.book_title,
         p.book_author, p.book_language, p.book_year, (1 - n.dist)::double precision AS similarity
  FROM near n
  LEFT JOIN page_translations p ON p.page_id = n.page_id
  WHERE 1 - n.dist > match_threshold
  ORDER BY n.dist;
END;
$function$;

-- ── Inside a book set (tenant scope, or a caller's own book list) ────────
CREATE OR REPLACE FUNCTION public.match_page_concepts_in_books(
  query_embedding vector(768),
  book_ids text[],
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 15
)
RETURNS TABLE(page_id text, book_id text, page_number integer, translation text,
              book_title text, book_author text, book_language text, book_year integer,
              similarity double precision)
LANGUAGE plpgsql STABLE
AS $function$
BEGIN
  RETURN QUERY
  WITH ranked AS (
    SELECT s.page_id, s.book_id, s.page_number, s.dist
    FROM (
      SELECT c.page_id, c.book_id, c.page_number, (c.embedding <=> query_embedding::halfvec(768)) AS dist
      FROM page_concepts c
      WHERE c.book_id = ANY(book_ids)
      OFFSET 0
    ) s
    WHERE 1 - s.dist > match_threshold
    ORDER BY s.dist
    LIMIT LEAST(GREATEST(match_count, 1), 100)
  )
  SELECT r.page_id, r.book_id, r.page_number, p.translation, p.book_title,
         p.book_author, p.book_language, p.book_year, (1 - r.dist)::double precision AS similarity
  FROM ranked r
  LEFT JOIN page_translations p ON p.page_id = r.page_id
  -- Re-assert the scope on what is returned.
  WHERE r.book_id = ANY(book_ids)
  ORDER BY r.dist;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.match_page_concepts(vector, double precision, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_page_concepts_in_books(vector, text[], double precision, integer) TO anon, authenticated, service_role;

-- PostgREST caches the schema; without this the new functions 404 until restart.
NOTIFY pgrst, 'reload schema';
