-- The librarian's worklist: what in the catalogue actually needs a human.
--
-- Feeds /catalog/workspace. Computed live rather than stored, so it can never
-- go stale, and kept in SQL rather than assembled from a dozen PostgREST calls
-- so the *definitions* live in one auditable place.
--
-- THE POINT OF THIS FILE IS THE DEFINITIONS, NOT THE SQL. A worklist shown to
-- someone who has catalogued this collection for eight years has to be right;
-- a list of things that are not actually wrong reads as "this system does not
-- understand my collection", and she will stop opening it. Two naive queries
-- were measured and rejected on 2026-08-01:
--
--   "1,047 records have no title" — FALSE. 812 are manuscripts, and 663 of
--   those carry full_title instead; manuscripts are described in a different
--   field by design. Genuinely nameless: 320.
--
--   "2,260 duplicate shelf marks / 25,738 records" — FALSE. shelf_mark is a
--   location and class code, not an identifier: 1,867 books legitimately share
--   "M", 1,383 share "A". There are ZERO duplicate UBNs, which is the
--   identifier that actually has to be unique.
--
-- So each category below is scoped to something a librarian would genuinely
-- act on, and every one carries samples so the number is never just a number.
--
-- EVERY SAMPLE CARRIES `uuid`, AND THAT IS THE ONLY KEY THE SITE CAN RESOLVE.
-- `bph_works.id` and `bph_works.uuid` are two DIFFERENT uuids on every row, and
-- /catalog/{key} routes a uuid-shaped key to the `uuid` column (see
-- src/lib/bph-catalog-key.ts). Three of the categories below select exactly the
-- rows where `ubn IS NULL`, so their links can only fall back to a uuid — and
-- while these samples emitted `id`, all 2,012 of them 404'd. José Bouman,
-- 2026-08-12: "I cannot access these by clicking on them, so I can't see what
-- is the case" — reported against this worklist, one week after the catalogue
-- browser's own null-ubn links were fixed in #3654. Same symptom, second path.
-- `id` is kept in the payload for debugging; never build a link from it.
--
-- Run via Supabase SQL editor or psql:
--   psql "$DATABASE_URL" -f scripts/migration/add-bph-worklist-rpc.sql

BEGIN;

-- Any of the four title columns counts as "described". Used by several
-- categories, so it lives in one place.
CREATE OR REPLACE FUNCTION public.bph_any_title(r bph_works)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    NULLIF(TRIM(r.title), ''),
    NULLIF(TRIM(r.full_title), ''),
    NULLIF(TRIM(r.uniform_title), ''),
    NULLIF(TRIM(r.parallel_title), '')
  )
$$;

CREATE OR REPLACE FUNCTION public.bph_catalogue_worklist()
RETURNS TABLE (category text, label text, detail text, n bigint, samples jsonb)
LANGUAGE sql STABLE AS $$
  -- Real physical objects, on a shelf, with no name and no catalogue number.
  -- The most interesting rows in the catalogue and currently invisible.
  SELECT 'undescribed_manuscripts',
         'Manuscripts on the shelf with no title and no UBN',
         'Real objects we hold and can locate, but which the catalogue barely describes. Each needs a title and a number.',
         count(*),
         COALESCE(jsonb_agg(jsonb_build_object('ubn', ubn, 'uuid', uuid, 'id', id, 'shelf_mark', shelf_mark, 'hint', present_location)
                  ORDER BY shelf_mark) FILTER (WHERE rn <= 25), '[]'::jsonb)
  FROM (
    SELECT w.*, row_number() OVER (ORDER BY w.shelf_mark) rn
    FROM bph_works w
    WHERE w.record_type = 'manuscript'
      AND public.bph_any_title(w) IS NULL
      AND w.shelf_mark IS NOT NULL
      AND w.ubn IS NULL
  ) t

  UNION ALL

  -- Near-empty printed records: no title, no shelf mark, no number. Almost
  -- certainly import residue rather than books — but only a librarian can say
  -- whether they are deletable, so they are surfaced, never cleaned up.
  SELECT 'empty_printed_stubs',
         'Printed records with no title, shelf mark or UBN',
         'Probably residue from an old import rather than real holdings. Needs a decision: complete them, or remove them.',
         count(*),
         COALESCE(jsonb_agg(jsonb_build_object('ubn', ubn, 'uuid', uuid, 'id', id, 'shelf_mark', shelf_mark, 'hint', author)
                  ORDER BY id) FILTER (WHERE rn <= 25), '[]'::jsonb)
  FROM (
    SELECT w.*, row_number() OVER (ORDER BY w.id) rn
    FROM bph_works w
    WHERE w.record_type = 'printed'
      AND public.bph_any_title(w) IS NULL
      AND w.shelf_mark IS NULL
      AND w.ubn IS NULL
  ) t

  UNION ALL

  -- No catalogue number at all. Findable by title, never by number — which is
  -- how the BPH actually works day to day.
  SELECT 'missing_ubn',
         'Records with no UBN',
         'These cannot be found by catalogue number, only by title. Mostly photocopies and manuscripts.',
         count(*),
         COALESCE(jsonb_agg(jsonb_build_object('ubn', ubn, 'uuid', uuid, 'id', id, 'shelf_mark', shelf_mark, 'hint', any_title)
                  ORDER BY id) FILTER (WHERE rn <= 25), '[]'::jsonb)
  FROM (
    SELECT w.*, public.bph_any_title(w) AS any_title, row_number() OVER (ORDER BY w.id) rn
    FROM bph_works w WHERE w.ubn IS NULL
  ) t

  UNION ALL

  -- The other half of the "neen" cleanup, deliberately left for a librarian:
  -- emptying "ja" would destroy the only trace that these copies ARE on loan.
  SELECT 'state_shelfmark_ja',
         'State Collection shelf mark still reads "ja"',
         'Same import fault as the "neen" values that were cleared on 30 July. Emptying these would lose the only record that the copy IS on loan from the State Collection, so it needs your decision.',
         count(*),
         COALESCE(jsonb_agg(jsonb_build_object('ubn', ubn, 'uuid', uuid, 'id', id, 'shelf_mark', shelf_mark, 'hint', any_title)
                  ORDER BY ubn) FILTER (WHERE rn <= 25), '[]'::jsonb)
  FROM (
    SELECT w.*, public.bph_any_title(w) AS any_title, row_number() OVER (ORDER BY w.ubn) rn
    FROM bph_works w WHERE lower(trim(w.state_shelf_mark)) = 'ja'
  ) t

  UNION ALL

  -- Contributor proposals waiting on an editor. Empty today; the queue exists
  -- and someone has to be told when it is not.
  SELECT 'pending_contributions',
         'Suggested changes awaiting review',
         'Corrections proposed by contributors that need an editor to accept or decline.',
         count(*),
         COALESCE(jsonb_agg(jsonb_build_object('ubn', ubn, 'id', id::text, 'shelf_mark', NULL, 'hint', proposer_email)
                  ORDER BY created_at) FILTER (WHERE rn <= 25), '[]'::jsonb)
  FROM (
    SELECT p.*, row_number() OVER (ORDER BY p.created_at) rn
    FROM bph_works_pending_changes p WHERE p.status = 'pending'
  ) t
$$;

COMMIT;
