-- Diacritic-insensitive search for bph_works (issue #1680).
--
-- Goal: searching "Boehme" finds "Böhme", "Goerlitz" finds "Görlitz", "Mueller"
-- finds "Müller". Postgres `unaccent` handles the accent stripping; on top we
-- collapse the standard German digraphs so the convention "ö ↔ oe" matches
-- symmetrically. The normalisation runs on both stored values (generated
-- columns) and the user query (in `src/lib/text-normalize.ts` — keep these
-- in sync).
--
-- Run via Supabase SQL editor or psql:
--   psql "$DATABASE_URL" -f scripts/migration/add-bph-diacritic-normalization.sql
--
-- Idempotent. CREATE INDEX without CONCURRENTLY because the script is meant to
-- be run during a window where bph_works writes are paused (BPH catalogue is
-- a slow-trickle import, so blocking writes for index build is fine).

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- IMMUTABLE wrapper. Extension's unaccent() is declared STABLE — generated
-- columns and expression indexes require IMMUTABLE.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

-- normalize_bph_text:
--   1. lowercase
--   2. unaccent (strips diacritics: Böhme → Bohme)
--   3. collapse German digraphs (oe→o, ue→u, ae→a, ss→s)
--
-- Order matters. Unaccent first means "Böhme" → "bohme" (no digraph), then the
-- digraph rules are a no-op on it. "Boehme" → "boehme" → "bohme" via oe→o.
-- Both forms converge on "bohme" — that's the property we need.
CREATE OR REPLACE FUNCTION public.normalize_bph_text(t text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$
  SELECT regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          public.immutable_unaccent(lower(coalesce(t, ''))),
          'oe', 'o', 'g'
        ),
        'ue', 'u', 'g'
      ),
      'ae', 'a', 'g'
    ),
    'ss', 's', 'g'
  )
$$;

-- Generated columns. Each one folds the standard field together with its
-- variants so a per-field filter (Advanced > Author, etc.) finds variant
-- spellings without separate ilike calls.
ALTER TABLE bph_works
  ADD COLUMN IF NOT EXISTS title_norm      text GENERATED ALWAYS AS (
    public.normalize_bph_text(concat_ws(' ', title, parallel_title, uniform_title))
  ) STORED,
  ADD COLUMN IF NOT EXISTS author_norm     text GENERATED ALWAYS AS (
    public.normalize_bph_text(concat_ws(' ', author, variant_author, pseudonym))
  ) STORED,
  ADD COLUMN IF NOT EXISTS editor_norm     text GENERATED ALWAYS AS (
    public.normalize_bph_text(concat_ws(' ', editor, variant_editor))
  ) STORED,
  ADD COLUMN IF NOT EXISTS place_norm      text GENERATED ALWAYS AS (
    public.normalize_bph_text(place)
  ) STORED,
  ADD COLUMN IF NOT EXISTS printer_norm    text GENERATED ALWAYS AS (
    public.normalize_bph_text(concat_ws(' ', printer, variant_printer))
  ) STORED,
  ADD COLUMN IF NOT EXISTS publisher_norm  text GENERATED ALWAYS AS (
    public.normalize_bph_text(concat_ws(' ', publisher, variant_publisher))
  ) STORED,
  ADD COLUMN IF NOT EXISTS shelf_mark_norm text GENERATED ALWAYS AS (
    public.normalize_bph_text(concat_ws(' ', shelf_mark, state_shelf_mark))
  ) STORED,
  -- Combined column for the general search box (`q` parameter).
  ADD COLUMN IF NOT EXISTS search_norm     text GENERATED ALWAYS AS (
    public.normalize_bph_text(concat_ws(' ',
      title, parallel_title, uniform_title,
      author, variant_author, pseudonym,
      editor, variant_editor,
      place, printer, publisher, variant_printer, variant_publisher,
      shelf_mark, state_shelf_mark,
      keywords, language, series_title, volume_title
    ))
  ) STORED;

-- Trigram indexes for fast substring search (ILIKE '%pattern%').
CREATE INDEX IF NOT EXISTS idx_bph_search_norm_trgm
  ON bph_works USING gin (search_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_bph_title_norm_trgm
  ON bph_works USING gin (title_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_bph_author_norm_trgm
  ON bph_works USING gin (author_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_bph_editor_norm_trgm
  ON bph_works USING gin (editor_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_bph_place_norm_trgm
  ON bph_works USING gin (place_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_bph_printer_norm_trgm
  ON bph_works USING gin (printer_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_bph_publisher_norm_trgm
  ON bph_works USING gin (publisher_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_bph_shelf_mark_norm_trgm
  ON bph_works USING gin (shelf_mark_norm gin_trgm_ops);
