-- Widen the BPH catalogue's general search box to cover every public field.
--
-- José Bouman (BPH) reported that searching by UBN returns nothing. That was the
-- visible symptom of a narrower problem: `search_norm` -- the column the search
-- box actually queries -- covered only 20 of the ~40 populated fields, so a
-- librarian searching by anything outside the title/author/imprint block got
-- silence rather than results. Populated but unsearchable before this change:
--
--   remarks 7,572 . present_location 7,194 . bibliography 5,110
--   object_size_cm 4,417 . provenance 4,142 . ustc_sn 3,504
--   picturae_barcode 3,066 . bound_with 2,838 . ia_identifier 853
--   annotation 754 . full_title 663 . physical_description 199 . ...
--
-- UBN itself is deliberately NOT added here. `search_norm` is matched with
-- ILIKE '%q%' and UBNs are 1-5 digit numbers, so folding them in would make
-- every 4-digit year search also match the UBNs containing those digits
-- (searching 1545 would drag in 15450-15459, 11545, 21545, 31545...). UBN gets a
-- precise lane in the API instead: exact match for an all-digit query, ILIKE for
-- the non-numeric ones ("BPH 131", "PH144"). See src/app/api/catalog/bph/route.ts.
--
-- DELIBERATELY EXCLUDED -- this column feeds a PUBLIC search box, so a match is
-- itself a disclosure: anyone could probe for records containing a phrase.
-- Do not add any of these:
--   internal_remarks (1,705 rows)  -- staff working notes
--   exhibition_history             -- staff-only, see add-bph-exhibition-history.sql
--   price (38) / acquisition_source (308) / acquisition_date  -- commercial
--   work_status / fully_approved / delivered_to_customer / publish_scan -- workflow
--   modified_by_username / modified_by_email  -- personal data
--   ia_match_validation_notes  -- internal QA notes
--
-- `contributors` (JSONB) is not included: it is an empty array on all 29,879
-- rows today, and a generated column cannot contain the subquery needed to pull
-- names out of it. Revisit if it is ever populated.
--
-- NOTE ON STYLE -- do not "tidy" this into concat_ws(). concat_ws is STABLE
-- (it can invoke arbitrary type output functions), and Postgres refuses a
-- non-immutable generation expression, so the whole migration fails with
-- `42P17: generation expression is not immutable`. COALESCE + || is immutable.
-- add-bph-diacritic-normalization.sql in this directory shows concat_ws and
-- does NOT match what is deployed -- production was built with the || form and
-- that file would fail if re-run. Verified against pg_get_expr, 2026-07-31.
--
-- A generated column's expression cannot be altered in place, so the column is
-- dropped and recreated. That also drops idx_bph_search_norm_trgm, recreated
-- below -- without it every search-box query becomes a seq scan. Both are in one
-- transaction so search is never live without its index.
--
-- Run via Supabase SQL editor or psql:
--   psql "$DATABASE_URL" -f scripts/migration/expand-bph-search-norm.sql

BEGIN;

ALTER TABLE bph_works DROP COLUMN IF EXISTS search_norm;

ALTER TABLE bph_works
  ADD COLUMN search_norm text GENERATED ALWAYS AS (
    public.normalize_bph_text(
      -- Title family
      COALESCE(title, ''::text) || ' '::text ||
      COALESCE(parallel_title, ''::text) || ' '::text ||
      COALESCE(uniform_title, ''::text) || ' '::text ||
      COALESCE(full_title, ''::text) || ' '::text ||
      COALESCE(series_title, ''::text) || ' '::text ||
      COALESCE(volume_title, ''::text) || ' '::text ||
      COALESCE(journal_title, ''::text) || ' '::text ||
      COALESCE(volume_number, ''::text) || ' '::text ||
      -- Authorship
      COALESCE(author, ''::text) || ' '::text ||
      COALESCE(variant_author, ''::text) || ' '::text ||
      COALESCE(pseudonym, ''::text) || ' '::text ||
      COALESCE(author_canonical_name, ''::text) || ' '::text ||
      COALESCE(editor, ''::text) || ' '::text ||
      COALESCE(variant_editor, ''::text) || ' '::text ||
      COALESCE(compiler, ''::text) || ' '::text ||
      COALESCE(scribe, ''::text) || ' '::text ||
      COALESCE(statement_of_responsibility, ''::text) || ' '::text ||
      -- Imprint
      COALESCE(place, ''::text) || ' '::text ||
      COALESCE(printer, ''::text) || ' '::text ||
      COALESCE(publisher, ''::text) || ' '::text ||
      COALESCE(variant_printer, ''::text) || ' '::text ||
      COALESCE(variant_publisher, ''::text) || ' '::text ||
      COALESCE(impressum_original, ''::text) || ' '::text ||
      COALESCE(edition_note, ''::text) || ' '::text ||
      COALESCE(ms_date, ''::text) || ' '::text ||
      COALESCE(origin, ''::text) || ' '::text ||
      -- Location & ownership
      COALESCE(shelf_mark, ''::text) || ' '::text ||
      COALESCE(state_shelf_mark, ''::text) || ' '::text ||
      COALESCE(present_location, ''::text) || ' '::text ||
      COALESCE(provenance, ''::text) || ' '::text ||
      COALESCE(collection, ''::text) || ' '::text ||
      -- Subject & language
      COALESCE(keywords, ''::text) || ' '::text ||
      COALESCE(language, ''::text) || ' '::text ||
      COALESCE(script, ''::text) || ' '::text ||
      -- Physical description
      COALESCE(binding, ''::text) || ' '::text ||
      COALESCE(bound_with, ''::text) || ' '::text ||
      COALESCE(physical_description, ''::text) || ' '::text ||
      COALESCE(object_size_cm, ''::text) || ' '::text ||
      COALESCE(pagination, ''::text) || ' '::text ||
      COALESCE(characterization, ''::text) || ' '::text ||
      COALESCE(iconography, ''::text) || ' '::text ||
      COALESCE(illumination_illustration, ''::text) || ' '::text ||
      -- Notes (public only)
      COALESCE(bibliography, ''::text) || ' '::text ||
      COALESCE(remarks, ''::text) || ' '::text ||
      COALESCE(annotation, ''::text) || ' '::text ||
      COALESCE(contents, ''::text) || ' '::text ||
      -- Identifiers (UBN handled in the API)
      COALESCE(ustc_sn::text, ''::text) || ' '::text ||
      COALESCE(ia_identifier, ''::text) || ' '::text ||
      COALESCE(picturae_barcode, ''::text) || ' '::text ||
      COALESCE(icn_registration_number, ''::text)
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_bph_search_norm_trgm
  ON bph_works USING gin (search_norm gin_trgm_ops);

COMMIT;
