-- page_texts — the language-keyed sibling of page_translations (#4095).
--
-- WHY A SIBLING TABLE AND NOT A `lang` COLUMN ON page_translations
--
-- `page_translations` holds ONE translation per page (4.5M rows) plus its
-- vector, and it is the hot table behind every semantic lane: match_semantic,
-- match_pages_in_books, the librarian, /api/search. Adding `lang` to its
-- primary key means migrating 4.5M rows and rebuilding an HNSW index that four
-- read paths depend on, to gain 38K Spanish rows. The sibling table costs
-- nothing to the English path — `match_semantic` keeps working unchanged — and
-- the English rows can move in later as a deliberate, separately-verified step.
--
-- THE SHAPE IS LANGUAGE-KEYED, NOT SPANISH-SHAPED
--
-- `.claude/docs/i18n.md` rule 1: one language-keyed map per layer, never
-- per-language columns. This table is that rule at the vector layer — the next
-- language is a KEY (`lang = 'fr'`), not a table, a column or an RPC. Mongo's
-- side of the same rule is `pages.translations.<iso>`.
--
-- WHY THE VECTOR INDEX IS PARTIAL, ONE PER LANGUAGE
--
-- HNSW returns the globally nearest N vectors and a WHERE clause filters them
-- AFTERWARDS, so a `lang = 'es'` predicate against one shared index would strip
-- the result set to zero whenever the query's true neighbours are in another
-- language. That is exactly the cross-lingual bug match_semantic was BELIEVED
-- to have fixed in May 2026 — it was not; the fix was inert until #4439 (see
-- add-match-semantic-rpc.sql). A partial index per language makes it
-- structurally impossible instead of relying on a branch: `WHERE lang = 'es'`
-- matches the index predicate, so the scan happens inside that language. That
-- distinction is the lesson of #4439 — this design was right for the right
-- reason, and it is the pattern to reach for if `page_translations` ever needs
-- a per-language index of its own.
--
-- NOTE (#4439): the protection above covers `filter_lang` (which TEXT to read)
-- and nothing else. `match_page_texts` also takes filter_language /
-- filter_languages / filter_exclude_languages — the BOOK's language — and those
-- are post-filtered over the partial index's candidates, with the same silent
-- zero. Fixed in fix-semantic-language-prefilter.sql.
--
-- Adding a language therefore means running the runner again with --lang=<iso>;
-- until you do, that language's rows are searched by sequential scan (correct,
-- just slower). The runner prints which partial indexes exist.

CREATE TABLE IF NOT EXISTS page_texts (
  page_id         text NOT NULL,
  lang            text NOT NULL,
  book_id         text NOT NULL,
  page_number     integer,
  -- The translated page text, cleaned by scripts/lib/page-embedding-text.mjs
  -- (editorial wrappers dropped content-and-all). This column is quoted from,
  -- so it obeys quote-and-snippet-integrity.md the same way `translation` does.
  text            text,
  embedding       vector(768),
  book_title      text,
  book_author     text,
  book_language   text,
  book_year       integer,
  updated_at      timestamptz,
  embedding_model text,
  -- Freshness watermark of the Mongo source at embed time, so a re-translation
  -- that never got re-embedded is detectable. Same meaning as
  -- page_translations.mongo_updated_at; NOT a write timestamp.
  mongo_updated_at timestamptz,
  PRIMARY KEY (page_id, lang)
);

CREATE INDEX IF NOT EXISTS page_texts_book_lang_idx ON page_texts (book_id, lang);
CREATE INDEX IF NOT EXISTS page_texts_lang_idx      ON page_texts (lang);

-- ── The keyword lane ────────────────────────────────────────────────
--
-- Semantic search alone is not a search box. A reader looking for «alquimia»
-- or an exact phrase needs lexical matching, and on the English side that is
-- Atlas Search over `translation.data` (src/lib/atlas-search.ts). The Spanish
-- text is already HERE, 38K rows of it, so a Postgres full-text index gives the
-- lexical lane for free — and with real Spanish stemming, which the English
-- Atlas index (lucene.standard) does not have.
--
-- ONE function decides which stemmer a language gets, and both the write side
-- (the trigger below) and the read side (search_page_texts) call it. A language
-- Postgres has no dictionary for falls back to 'simple' — exact-token matching,
-- which is honest, rather than stemming Nahuatl as if it were Spanish.
CREATE OR REPLACE FUNCTION page_text_config(lang TEXT) RETURNS regconfig
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE lang
    WHEN 'es' THEN 'spanish'
    WHEN 'fr' THEN 'french'
    WHEN 'de' THEN 'german'
    WHEN 'it' THEN 'italian'
    WHEN 'pt' THEN 'portuguese'
    WHEN 'nl' THEN 'dutch'
    WHEN 'ru' THEN 'russian'
    WHEN 'ar' THEN 'arabic'
    WHEN 'en' THEN 'english'
    ELSE 'simple'
  END::regconfig;
$$;

ALTER TABLE page_texts ADD COLUMN IF NOT EXISTS tsv tsvector;

-- A TRIGGER, not a GENERATED column. A generated column cannot be altered in
-- place: teaching page_text_config a new language would mean dropping and
-- recreating the column, which silently drops its index too (the trap in
-- search-filters-and-lanes.md). With a trigger, a new language is a
-- CREATE OR REPLACE plus a no-op UPDATE over that language's rows.
CREATE OR REPLACE FUNCTION page_texts_tsv_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.tsv := to_tsvector(page_text_config(NEW.lang), COALESCE(NEW.text, ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS page_texts_tsv_update ON page_texts;
CREATE TRIGGER page_texts_tsv_update
  BEFORE INSERT OR UPDATE OF text, lang ON page_texts
  FOR EACH ROW EXECUTE FUNCTION page_texts_tsv_trigger();

-- One GIN index for every language. Unlike HNSW, GIN returns ALL matching rows
-- rather than the nearest N, so filtering by `lang` afterwards is exact — the
-- partial-index-per-language discipline above is a vector-index requirement,
-- not a general one.
CREATE INDEX IF NOT EXISTS page_texts_tsv_idx ON page_texts USING gin (tsv);

-- Lexical page search in ONE language. Same return shape as match_page_texts,
-- so the two lanes merge without a second mapper.
CREATE OR REPLACE FUNCTION search_page_texts(
  query_text TEXT,
  filter_lang TEXT,
  match_count INT DEFAULT 25,
  filter_language TEXT DEFAULT NULL,
  filter_year_min INT DEFAULT NULL,
  filter_year_max INT DEFAULT NULL,
  filter_book_ids TEXT[] DEFAULT NULL
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
  cfg regconfig := page_text_config(filter_lang);
  q tsquery := websearch_to_tsquery(cfg, query_text);
BEGIN
  IF q IS NULL OR numnode(q) = 0 THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    p.page_id, p.book_id, p.page_number, p.text,
    p.book_title, p.book_author, p.book_language, p.book_year,
    ts_rank_cd(p.tsv, q)::float AS similarity
  FROM page_texts p
  WHERE p.lang = filter_lang
    AND p.tsv @@ q
    AND (filter_book_ids IS NULL OR p.book_id = ANY(filter_book_ids))
    AND (filter_language IS NULL OR p.book_language = filter_language)
    AND (filter_year_min IS NULL OR p.book_year >= filter_year_min)
    AND (filter_year_max IS NULL OR p.book_year <= filter_year_max)
    -- Hidden / deduped pages live at page_number <= 0, same as the Atlas lane.
    AND p.page_number > 0
  ORDER BY ts_rank_cd(p.tsv, q) DESC
  LIMIT match_count;
END;
$$;

-- Global page-level semantic search in ONE language.
--
-- Column names deliberately mirror match_semantic (including `translation` for
-- the text) so src/lib/semantic-search.ts maps one row shape for both RPCs and
-- the two paths cannot drift apart in their snippet handling.
--
-- `filter_lang` is the TEXT language (which edition of the page to read).
-- `filter_language` / `filter_languages` / `filter_exclude_languages` are the
-- BOOK's language — the edition filter, unchanged in meaning from every other
-- search surface (search-filters-and-lanes.md). Two different things; the
-- names are the ones each layer already uses.
CREATE OR REPLACE FUNCTION match_page_texts(
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
BEGIN
  RETURN QUERY
  SELECT
    p.page_id,
    p.book_id,
    p.page_number,
    p.text,
    p.book_title,
    p.book_author,
    p.book_language,
    p.book_year,
    1 - (p.embedding <=> query_embedding) AS similarity
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
    AND 1 - (p.embedding <=> query_embedding) > match_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Scoped variant — pages of specific books, in one language. Companion to
-- match_pages_in_books, used by in-book search on a localized surface.
CREATE OR REPLACE FUNCTION match_page_texts_in_books(
  query_embedding vector(768),
  filter_lang TEXT,
  book_ids TEXT[],
  match_threshold FLOAT DEFAULT 0.3,
  match_count INT DEFAULT 10
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
    p.page_id, p.book_id, p.page_number, p.text,
    p.book_title, p.book_author, p.book_language, p.book_year,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM page_texts p
  WHERE p.lang = filter_lang
    AND p.book_id = ANY(book_ids)
    AND p.embedding IS NOT NULL
    AND 1 - (p.embedding <=> query_embedding) > match_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Read-only for the browser roles. `page_translations` carries the full ALL
-- grant that Supabase's default privileges hand out; there is no reason for a
-- new table to inherit it, and the writers here are the service role and the
-- direct postgres connection. Narrow it explicitly.
GRANT SELECT ON page_texts TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON page_texts FROM anon, authenticated;
