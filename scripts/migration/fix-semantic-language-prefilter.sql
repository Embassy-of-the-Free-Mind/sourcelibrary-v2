-- Shadow functions for issue #4439 — language filters are a post-filter over an
-- HNSW candidate set, so a non-dominant language returns 0 rows.
--
-- ADDITIVE AND SAFE TO RUN. Nothing in this file touches a live RPC. It creates
-- three `*_prefilter_v2` twins of the serving functions so the fix can be
-- EXPLAINed, timed and recall-tested against production data before anyone
-- replaces the functions the site actually calls. The replacement lives in
-- `apply-semantic-language-prefilter.sql` and is held for a human.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IS ACTUALLY WRONG
--
-- `add-match-semantic-rpc.sql` claims a fix landed 2026-05-17: "when
-- filter_language(s) is set, branch to a sequential-scan path that filters by
-- language FIRST then sorts by similarity." The branch exists. It does not
-- force a sequential scan. Both branches end in the same two lines:
--
--     ORDER BY p.embedding <=> query_embedding
--     LIMIT match_count;
--
-- That is precisely the shape pgvector's HNSW index serves, so the planner
-- takes the index in BOTH branches and the language predicate is applied to
-- candidates the index has already chosen. Recall then tracks the language's
-- share of the table rather than the query: Latin at 36% survives, Chinese at
-- 2.2% does not.
--
-- Measured against production 2026-08-31 (query: "the stone that draws iron,
-- the south-pointing needle, magnetic attraction"):
--
--   filter                        match_count      rows   latency
--   ────────────────────────────  ───────────  ────────  ────────
--   none                                   15        15     940ms   (Latin/English/Greek)
--   language = 'Latin'                     15        15      69ms
--   languages = ['Chinese']                15         0     210ms
--   languages = ['Chinese']                40         0     228ms
--   languages = ['Chinese']               100         0      60ms
--   languages = ['Chinese']               500         0      73ms
--   languages = ['Chinese']              2000         0      91ms
--   languages = ['Chinese']             10000      1000    47579ms
--
-- The last row is the positive control on the mechanism, and it is the whole
-- proof. At match_count = 10000 the planner abandons the HNSW index (a LIMIT
-- that large costs more through the graph than a scan), falls back to a real
-- sequential scan, and the SAME query returns Chinese rows whose top
-- similarity is 0.7040 — against a global unfiltered top of 0.728. The
-- material was always there, at competitive similarity. Only the plan stood
-- between the query and it. 60–230ms for an alleged scan of 4.5M rows was
-- the tell all along.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE FIX, AND WHY IT HAS TWO PATHS
--
-- Path A — iterative index scan (pgvector >= 0.8.0). `hnsw.iterative_scan`
-- makes the index keep walking the graph until `match_count` rows have
-- survived the WHERE clause, bounded by `hnsw.max_scan_tuples`. This is the
-- mechanism pgvector added for exactly this problem. It stays sub-second and
-- it works for `exclude_languages` too, which a pre-filter does not (see
-- below). `relaxed_order` may emit rows slightly out of distance order, so the
-- inner scan is wrapped and re-sorted over at most `match_count` rows.
--
-- Path B — exact pre-filter, for pgvector < 0.8.0. Two independent things stop
-- the HNSW index being chosen, because one of them being subtly wrong is how
-- the 2026-05-17 "fix" became inert:
--
--   1. The distance is computed inside a subquery fenced with `OFFSET 0`, so
--      the outer `ORDER BY s.dist` is an ordering over a subquery output
--      column and cannot be matched to the `<=>` operator on an indexed
--      column. `OFFSET 0` blocks subquery pull-up; without it the planner
--      flattens the subquery and we are back where we started.
--   2. `enable_indexscan = off` for the duration of the transaction. pgvector
--      HNSW is only reachable as a plain (ordered) index scan, so this removes
--      it outright, while leaving BITMAP index scans available — which is what
--      we want the partial `page_translations_lang_idx` on `book_language` to
--      serve. `set_config(..., true)` is transaction-local; PostgREST runs one
--      transaction per request, so it cannot leak into another query.
--
-- Which path a call takes is decided by reading `pg_extension.extversion`, not
-- by probing a GUC. Setting an unknown `hnsw.*` parameter can silently succeed
-- as a placeholder on some builds, which would make the probe report success
-- and take the wrong branch — a check that cannot fail is not a check.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFIED, NOT ASSUMED
--
-- The plans below come from a local pgvector 0.8.6 (docker pgvector/pgvector:pg17)
-- loaded with 60,000 rows at the corpus's real language proportions (Latin 36.0%,
-- English 11.8%, Sanskrit 3.2%, Chinese 2.2%, Arabic 1.2%), each language's
-- vectors drawn around its own centroid so the query's true neighbours really
-- are Latin. The language btree was dropped and the planner pushed toward the
-- vector index (`enable_seqscan = off`, `enable_bitmapscan = off`) — the most
-- index-favouring conditions obtainable. If a shape cannot reach HNSW there, it
-- cannot reach it in production.
--
--   A. OLD SHAPE (as committed)
--        Limit
--          ->  Index Scan using page_translations_embedding_idx
--                Order By: (embedding <=> $q)
--                Filter: (book_language = ANY ('{Chinese}'))
--      → 0 rows.   The bug, reproduced.
--
--   B. OFFSET 0 fence alone
--        Limit -> Sort -> Subquery Scan on s -> Seq Scan on page_translations
--      → 15 rows.  The fence alone defeats the index even under maximum
--                  index-favouring pressure.
--
--   C. OFFSET 0 fence + enable_indexscan = off
--        identical plan to B.
--      → 15 rows.  The GUC is belt to the fence's braces; neither is load-
--                  bearing alone, which is the point — the 2026-05-17 fix had
--                  exactly one mechanism and it was the wrong one.
--
-- End-to-end through the functions themselves, same forcing:
--
--   match_semantic (live)          0 Chinese rows
--   v2, Path A (iterative scan)   15 rows, top similarity 0.7916
--   v2, Path B (fenced)           15 rows, top similarity 0.7950
--   v2, exclude 3 languages       15 rows
--   v2, unfiltered                15 rows  (HNSW path, unchanged)
--
-- Path A's slightly lower top similarity is `relaxed_order` doing what it says:
-- approximate ordering in exchange for staying on the index. Path B is exact.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- KNOWN COST, STATED UP FRONT
--
-- Path B is exact and slow, and how slow depends entirely on how many rows the
-- language predicate admits:
--
--   * An INCLUDE filter on a non-dominant language (Chinese 100,613 rows,
--     Arabic 54,352, Sanskrit 142,513) can use the partial btree on
--     `book_language` via a bitmap scan. Expect ~1–4s: bounded, correct, and
--     the honest price of exact search.
--   * An EXCLUDE filter (`NOT (book_language = ANY(...))`) has no usable
--     index and degrades to a full scan of 4.5M rows. That is the 47.6s
--     measured above. It is a correct answer nobody will wait for.
--
-- So on pgvector < 0.8.0 this fix turns "confidently wrong in 100ms" into
-- "right, eventually" — an improvement, but not a finished one. On >= 0.8.0
-- Path A gives both. If production is on < 0.8.0 the follow-up is either an
-- extension upgrade or per-language PARTIAL HNSW indexes, which is already the
-- pattern `page_texts` uses (`page_texts_embedding_es_idx`; see
-- `.claude/docs/embeddings.md`).
--
-- NOT MEASURED, AND SOMEONE MUST: production p95 for either path on the real
-- 4.5M-row table. The local box is 60,000 rows and every variant there runs in
-- under 55ms, which tells you the ordering of the costs and nothing about the
-- absolute numbers. The one real production data point is the 47.6s above, and
-- that is a full scan with no index help at all — the pessimistic bound for
-- Path B on an exclude filter, not an estimate for the include filters. Take
-- the timings from `EXPLAIN (ANALYZE)` against the shadow before replacing
-- anything; the tolerance that matters is the MCP request path, not a psql
-- prompt.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- HOW TO VERIFY (do this, do not read the SQL and believe it — that is the
-- exact mistake of 2026-05-17)
--
--   \timing on
--   SET hnsw.ef_search = 40;
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT * FROM match_semantic_prefilter_v2(
--     (SELECT embedding FROM page_translations WHERE book_language = 'Latin'
--        AND embedding IS NOT NULL LIMIT 1),
--     0.3, 15, NULL, NULL, NULL, NULL, ARRAY['Chinese'], NULL);
--
-- A plan containing `Index Scan using page_translations_embedding_idx` in the
-- FILTERED branch means the fix did not take. What you want to see is either a
-- Bitmap Heap Scan on `page_translations_lang_idx` (Path B) or an Index Scan
-- reporting far more tuples touched than returned (Path A, iterating).
--
-- The end-to-end recall test — the one that pins the MECHANISM rather than an
-- output — is `scripts/audit/semantic-language-filter-recall.mjs`, which
-- asserts that a non-dominant language filter returns rows on a query whose
-- unfiltered top hits are all Western. Point it at either function:
--
--   node --env-file=.env.production.local \
--     scripts/audit/semantic-language-filter-recall.mjs --rpc=match_semantic_prefilter_v2
--
-- Related: `.claude/docs/invariants/search-filters-and-lanes.md`, and the
-- lesson this issue is the origin of — a ranked filter's recall tracks the
-- base rate, so positive-control the mechanism, never the output.

-- ── Version probe ────────────────────────────────────────────────────────────
-- Read the extension version rather than probing a GUC: setting an unknown
-- `hnsw.*` parameter can succeed as a placeholder on builds that do not
-- reserve the prefix, so a probe that "works" proves nothing. Array comparison
-- is element-wise, which gives correct numeric ordering (0.10.0 > 0.8.0), where
-- a string compare would not.

CREATE OR REPLACE FUNCTION pgvector_supports_iterative_scan()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT string_to_array(split_part(extversion, '-', 1), '.')::INT[] >= ARRAY[0, 8, 0]
     FROM pg_extension WHERE extname = 'vector'),
    FALSE
  );
$$;

-- Read-callable by the same roles as the functions it serves, so the
-- verification script can reach it with the service role.
GRANT EXECUTE ON FUNCTION pgvector_supports_iterative_scan() TO anon, authenticated, service_role;

-- ── page_translations (English page store) ───────────────────────────────────

CREATE OR REPLACE FUNCTION match_semantic_prefilter_v2(
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
  can_iterate BOOLEAN := pgvector_supports_iterative_scan();
BEGIN
  IF NOT has_language_filter THEN
    -- Unfiltered: the HNSW index is exactly right here and always was.
    RETURN QUERY
    SELECT p.page_id, p.book_id, p.page_number, p.translation, p.book_title,
           p.book_author, p.book_language, p.book_year,
           1 - (p.embedding <=> query_embedding) AS similarity
    FROM page_translations p
    WHERE p.embedding IS NOT NULL
      AND 1 - (p.embedding <=> query_embedding) > match_threshold
      AND (filter_year_min IS NULL OR p.book_year >= filter_year_min)
      AND (filter_year_max IS NULL OR p.book_year <= filter_year_max)
    ORDER BY p.embedding <=> query_embedding
    LIMIT match_count;
    RETURN;
  END IF;

  IF can_iterate THEN
    -- Path A: let the index keep walking until match_count rows survive the
    -- filter. Inner LIMIT drives the index; outer sort repairs relaxed_order.
    PERFORM set_config('hnsw.iterative_scan', 'relaxed_order', true);
    PERFORM set_config('hnsw.max_scan_tuples', '50000', true);
    PERFORM set_config('hnsw.ef_search', '100', true);

    RETURN QUERY
    SELECT s.page_id, s.book_id, s.page_number, s.translation, s.book_title,
           s.book_author, s.book_language, s.book_year, 1 - s.dist AS similarity
    FROM (
      SELECT p.page_id, p.book_id, p.page_number, p.translation, p.book_title,
             p.book_author, p.book_language, p.book_year,
             (p.embedding <=> query_embedding) AS dist
      FROM page_translations p
      WHERE p.embedding IS NOT NULL
        AND (filter_language IS NULL OR p.book_language = filter_language)
        AND (filter_languages IS NULL OR array_length(filter_languages, 1) IS NULL
             OR p.book_language = ANY(filter_languages))
        AND (filter_exclude_languages IS NULL OR array_length(filter_exclude_languages, 1) IS NULL
             OR p.book_language IS NULL OR NOT (p.book_language = ANY(filter_exclude_languages)))
        AND 1 - (p.embedding <=> query_embedding) > match_threshold
        AND (filter_year_min IS NULL OR p.book_year >= filter_year_min)
        AND (filter_year_max IS NULL OR p.book_year <= filter_year_max)
      ORDER BY p.embedding <=> query_embedding
      LIMIT match_count
    ) s
    ORDER BY s.dist;
    RETURN;
  END IF;

  -- Path B: exact pre-filter. Two fences, deliberately redundant.
  PERFORM set_config('enable_indexscan', 'off', true);

  RETURN QUERY
  SELECT s.page_id, s.book_id, s.page_number, s.translation, s.book_title,
         s.book_author, s.book_language, s.book_year, 1 - s.dist AS similarity
  FROM (
    SELECT p.page_id, p.book_id, p.page_number, p.translation, p.book_title,
           p.book_author, p.book_language, p.book_year,
           (p.embedding <=> query_embedding) AS dist
    FROM page_translations p
    WHERE p.embedding IS NOT NULL
      AND (filter_language IS NULL OR p.book_language = filter_language)
      AND (filter_languages IS NULL OR array_length(filter_languages, 1) IS NULL
           OR p.book_language = ANY(filter_languages))
      AND (filter_exclude_languages IS NULL OR array_length(filter_exclude_languages, 1) IS NULL
           OR p.book_language IS NULL OR NOT (p.book_language = ANY(filter_exclude_languages)))
      AND (filter_year_min IS NULL OR p.book_year >= filter_year_min)
      AND (filter_year_max IS NULL OR p.book_year <= filter_year_max)
    OFFSET 0  -- optimization fence: stops the outer ORDER BY reaching the index
  ) s
  WHERE 1 - s.dist > match_threshold
  ORDER BY s.dist
  LIMIT match_count;
END;
$$;

-- ── page_texts (language-keyed page store, #4095) ────────────────────────────
-- Same defect, same shape. `filter_lang` (which TEXT to read) is unaffected —
-- it is served by a partial HNSW index per language, which is structurally
-- immune. The BOOK-language filters below are not.

CREATE OR REPLACE FUNCTION match_page_texts_prefilter_v2(
  query_embedding vector(768),
  filter_lang TEXT,
  match_threshold FLOAT DEFAULT 0.3,
  match_count INT DEFAULT 15,
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
  can_iterate BOOLEAN := pgvector_supports_iterative_scan();
BEGIN
  IF NOT has_language_filter THEN
    RETURN QUERY
    SELECT p.page_id, p.book_id, p.page_number, p.text, p.book_title,
           p.book_author, p.book_language, p.book_year,
           1 - (p.embedding <=> query_embedding) AS similarity
    FROM page_texts p
    WHERE p.lang = filter_lang
      AND p.embedding IS NOT NULL
      AND 1 - (p.embedding <=> query_embedding) > match_threshold
      AND (filter_year_min IS NULL OR p.book_year >= filter_year_min)
      AND (filter_year_max IS NULL OR p.book_year <= filter_year_max)
    ORDER BY p.embedding <=> query_embedding
    LIMIT match_count;
    RETURN;
  END IF;

  IF can_iterate THEN
    PERFORM set_config('hnsw.iterative_scan', 'relaxed_order', true);
    PERFORM set_config('hnsw.max_scan_tuples', '50000', true);
    PERFORM set_config('hnsw.ef_search', '100', true);

    RETURN QUERY
    SELECT s.page_id, s.book_id, s.page_number, s.translation, s.book_title,
           s.book_author, s.book_language, s.book_year, 1 - s.dist AS similarity
    FROM (
      SELECT p.page_id, p.book_id, p.page_number, p.text AS translation,
             p.book_title, p.book_author, p.book_language, p.book_year,
             (p.embedding <=> query_embedding) AS dist
      FROM page_texts p
      WHERE p.lang = filter_lang
        AND p.embedding IS NOT NULL
        AND (filter_language IS NULL OR p.book_language = filter_language)
        AND (filter_languages IS NULL OR array_length(filter_languages, 1) IS NULL
             OR p.book_language = ANY(filter_languages))
        AND (filter_exclude_languages IS NULL OR array_length(filter_exclude_languages, 1) IS NULL
             OR p.book_language IS NULL OR NOT (p.book_language = ANY(filter_exclude_languages)))
        AND 1 - (p.embedding <=> query_embedding) > match_threshold
        AND (filter_year_min IS NULL OR p.book_year >= filter_year_min)
        AND (filter_year_max IS NULL OR p.book_year <= filter_year_max)
      ORDER BY p.embedding <=> query_embedding
      LIMIT match_count
    ) s
    ORDER BY s.dist;
    RETURN;
  END IF;

  PERFORM set_config('enable_indexscan', 'off', true);

  RETURN QUERY
  SELECT s.page_id, s.book_id, s.page_number, s.translation, s.book_title,
         s.book_author, s.book_language, s.book_year, 1 - s.dist AS similarity
  FROM (
    SELECT p.page_id, p.book_id, p.page_number, p.text AS translation,
           p.book_title, p.book_author, p.book_language, p.book_year,
           (p.embedding <=> query_embedding) AS dist
    FROM page_texts p
    WHERE p.lang = filter_lang
      AND p.embedding IS NOT NULL
      AND (filter_language IS NULL OR p.book_language = filter_language)
      AND (filter_languages IS NULL OR array_length(filter_languages, 1) IS NULL
           OR p.book_language = ANY(filter_languages))
      AND (filter_exclude_languages IS NULL OR array_length(filter_exclude_languages, 1) IS NULL
           OR p.book_language IS NULL OR NOT (p.book_language = ANY(filter_exclude_languages)))
      AND (filter_year_min IS NULL OR p.book_year >= filter_year_min)
      AND (filter_year_max IS NULL OR p.book_year <= filter_year_max)
    OFFSET 0
  ) s
  WHERE 1 - s.dist > match_threshold
  ORDER BY s.dist
  LIMIT match_count;
END;
$$;

-- ── book_embeddings (book-level discovery) ───────────────────────────────────
-- Same ORDER BY shape, same defect, but ~36K rows rather than 4.5M, so the
-- exact pre-filter is cheap here (a full scan of 36K vectors is tens of ms) and
-- there is no reason to reach for the iterative path at all. Worth fixing even
-- so: `semanticBookSearch` passes `filter_language`, and a Chinese-language
-- book search on a Western-leaning query has exactly the same silent zero.

CREATE OR REPLACE FUNCTION match_books_semantic_prefilter_v2(
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
  IF filter_language IS NULL THEN
    RETURN QUERY
    SELECT b.book_id, b.title, b.author, b.year, b.language, b.summary_text,
           b.metadata, 1 - (b.embedding <=> query_embedding) AS similarity
    FROM book_embeddings b
    WHERE 1 - (b.embedding <=> query_embedding) > match_threshold
      AND (filter_year_min IS NULL OR b.year >= filter_year_min)
      AND (filter_year_max IS NULL OR b.year <= filter_year_max)
    ORDER BY b.embedding <=> query_embedding
    LIMIT match_count;
    RETURN;
  END IF;

  PERFORM set_config('enable_indexscan', 'off', true);

  RETURN QUERY
  SELECT s.book_id, s.title, s.author, s.year, s.language, s.summary_text,
         s.metadata, 1 - s.dist AS similarity
  FROM (
    SELECT b.book_id, b.title, b.author, b.year, b.language, b.summary_text,
           b.metadata, (b.embedding <=> query_embedding) AS dist
    FROM book_embeddings b
    WHERE b.language = filter_language
      AND (filter_year_min IS NULL OR b.year >= filter_year_min)
      AND (filter_year_max IS NULL OR b.year <= filter_year_max)
    OFFSET 0
  ) s
  WHERE 1 - s.dist > match_threshold
  ORDER BY s.dist
  LIMIT match_count;
END;
$$;

-- Shadow functions are callable by the service role only — they exist for
-- verification, not for serving. Nothing in `src/` references them.
GRANT EXECUTE ON FUNCTION match_semantic_prefilter_v2(vector, FLOAT, INT, TEXT, TEXT, INT, INT, TEXT[], TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION match_page_texts_prefilter_v2(vector, TEXT, FLOAT, INT, TEXT, INT, INT, TEXT[], TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION match_books_semantic_prefilter_v2(vector, FLOAT, INT, TEXT, INT, INT) TO service_role;
