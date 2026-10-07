-- An original-text lane over page_translations: a PARTIAL HNSW index on the
-- rows that carry no English, and an RPC that searches only them (#5729).
--
-- PRIOR ART: fix-semantic-language-prefilter.sql (#4439) — the same failure
-- shape, solved there for a language FILTER with iterative scan; and
-- page_texts_embedding_<lang>_idx (add-page-texts-table.mjs), which is the
-- partial-index-per-lane pattern this follows.
--
-- WHY. `pageEmbeddingInput` falls back to the OCR when a page has no
-- translation, so ~1.5M untranslated pages (2.3M+ after the #5729 backfill)
-- already carry a Gemini vector of their ORIGINAL text, with `translation`
-- empty. Those vectors retrieve well: recall@10 0.64 exact over every
-- OCR-only row, 0.93 in an 8.6K-page pool. But they share one HNSW index
-- with 5.2M English translations, and an English query is always nearer to
-- SOME English translation than to a Latin page on its exact subject — so
-- through `match_semantic` the gold page reaches the top 10 for 0.10 of
-- queries. HNSW returns the globally nearest N and filters afterwards; a
-- minority of the table is invisible to an unfiltered nearest-neighbour
-- search. `hnsw.iterative_scan` over the shared index got 14/28 against
-- 18/28 exact, at median 2.9 s. A partial index makes the scan happen INSIDE
-- the lane. Experiment: scripts/eval/experiments/2026-10-07-orig-lang-embedding-recall-5729.md
--
-- The index predicate and the RPC's WHERE clause must stay textually
-- identical (`embedding IS NOT NULL AND coalesce(translation, '') = ''`):
-- the planner uses a partial index only when it can PROVE the query's
-- predicate implies the index's. Change one, change both, then EXPLAIN.
--
-- A row leaves the lane by itself when its page is translated: the writer
-- upserts the English into `translation` and the row stops matching. Withheld
-- rows (#4523) have `embedding` NULL and never enter it.
--
-- NOT WIRED to any route. Reading it from /api/search or the Librarian is a
-- separate change; that caller must apply the tenant book-set scope every
-- vector lane now carries (#4330, #6132) and fuse this lane with the English
-- one (RRF), not replace it. Until then EXECUTE is granted to service_role only.
--
-- Size: ~3.9 KB/row (the shared index is 26 GB for 6.7M rows), so ~9 GB once
-- the tail is embedded. CREATE INDEX CONCURRENTLY cannot run in a transaction
-- block or through the transaction pooler (port 6543): apply with
--   node --env-file=.env.production.local scripts/migration/add-untranslated-pages-index.mjs --apply
-- which checks disk headroom first and runs on a direct session (port 5432).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pt_embedding_untranslated_hnsw
  ON page_translations USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL AND coalesce(translation, '') = '';

CREATE OR REPLACE FUNCTION match_semantic_untranslated(
  query_embedding vector(768),
  match_threshold FLOAT DEFAULT 0.0,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  page_id TEXT,
  book_id TEXT,
  page_number INT,
  book_title TEXT,
  book_author TEXT,
  book_language TEXT,
  book_year INT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('hnsw.ef_search', '100', true);
  RETURN QUERY
  SELECT s.page_id, s.book_id, s.page_number, s.book_title, s.book_author,
         s.book_language, s.book_year, 1 - s.dist AS similarity
  FROM (
    SELECT p.page_id, p.book_id, p.page_number, p.book_title, p.book_author,
           p.book_language, p.book_year, p.embedding <=> query_embedding AS dist
    FROM page_translations p
    WHERE p.embedding IS NOT NULL AND coalesce(p.translation, '') = ''
    ORDER BY p.embedding <=> query_embedding
    LIMIT match_count
  ) s
  WHERE 1 - s.dist > match_threshold
  ORDER BY s.dist;
END;
$$;

REVOKE ALL ON FUNCTION match_semantic_untranslated(vector, FLOAT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION match_semantic_untranslated(vector, FLOAT, INT) TO service_role;
