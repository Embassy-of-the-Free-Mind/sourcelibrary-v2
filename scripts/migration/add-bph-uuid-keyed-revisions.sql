-- Make the BPH catalogue editor work for records that have no UBN.
--
-- WHY THIS EXISTS
--
-- Memorix issues no UBN for manuscripts or photographs. 2,012 of 29,881 rows
-- (812 manuscripts + 959 photocopies + a few printed stubs) have `ubn IS NULL`,
-- and that is correct data, not missing data — José Bouman, 2026-08-12:
--
--   "Manuscripts never have a UBN, instead they have a manuscript number
--    (M+ number, or just a number, like 216, 217, 218)."
--
-- But the whole edit path is hard-keyed on a non-null UBN:
--
--   * bph_works_revisions.ubn is `TEXT NOT NULL REFERENCES bph_works(ubn)`
--   * applyWorkRevision() fetches with .eq('ubn', ubn) and inserts a revision
--     row carrying that ubn
--   * the edit page fetches with .eq('ubn', ubn) and notFound()s otherwise
--
-- So every one of those 2,012 records 404s on /catalog/{key}/edit, and no new
-- manuscript can be created at all without inventing a UBN for it. #3654 made
-- these records *viewable* by accepting a uuid in the URL; it did not make them
-- editable, which is the other half of what was reported:
--
--   José Bouman, 2026-07-31 — "It is not possible to click on titles with a
--   shelf mark M (+number), nor on those with shelfmark Fot (+ number) TO EDIT
--   THEM or see more information"
--   José Bouman, 2026-08-13 — "the blank form should show other fields than the
--   one for printed books. No UBN required."
--
-- Inventing a UBN is not an option: the BPH writes the UBN into the physical
-- book by hand, so a synthetic one would end up in ink inside a manuscript that
-- is not supposed to have one. The identifier has to stay absent.
--
-- WHAT THIS DOES
--
-- Adds `uuid` as an alternative revision key, so a revision can target a work
-- by UBN (as all 30k existing revisions do) or by uuid (manuscripts, photos).
-- Every existing row keeps its ubn; nothing is rewritten.
--
-- MEASURED BEFORE WRITING (production, 2026-08-13, all 29,881 rows paged):
--   uuid NULL/empty ............ 107   (all record_type='printed', all have a ubn)
--   duplicate uuid values ...... 0
--   rows with neither key ...... 0     <- nothing becomes unaddressable
--   ubn values of uuid shape ... 0     <- the shape-based routing stays unambiguous
--
-- The 107 uuid-less rows are backfilled below so the UNIQUE constraint can be
-- added; they are all UBN-keyed printed books whose links do not change.
--
-- THIS MIGRATION PAGES A HUMAN. Step 1 writes `uuid` on 107 rows without
-- writing any revision rows, and `uuid` sits in the integrity monitor's
-- `identifiers` hash group — so the 04:30 scan reports them as UNEXPLAINED and
-- ntfy alerts. That is the monitor working correctly (it cannot tell this from
-- a stray credential), but it cost an investigation on 2026-08-14 because
-- nobody predicted it. If you re-run this on another environment, tell whoever
-- watches the channel first, and mark the resulting events reviewed with a note
-- naming this file. See "If you are writing a migration that touches
-- bph_works" in .claude/docs/bph-catalogue-disaster-recovery.md.
--
-- Applied to production 2026-08-13 ~22:55Z. The uuid backfill is one-way: it
-- only fills nulls, so re-running is a no-op rather than a re-randomisation.
--
-- Run via Supabase SQL editor, or through the IPv4 SESSION pooler — the stored
-- SUPABASE_DB_URL points at db.<ref>.supabase.co, which no longer resolves, and
-- at port 6543, the TRANSACTION pooler, which refuses DDL. Session pooler is
-- port 5432, user postgres.<ref>; this project answers on aws-1-eu-west-1. See
-- scripts/migration/add-index-catalog-author-held.mjs for the region-probing
-- connection helper. The backfill in step 5 runs ~3 minutes and exceeds the
-- default statement_timeout — SET statement_timeout first or it rolls back.

BEGIN;

-- 1. Every work needs a durable uuid before uuid can be a key. `uuid` is TEXT
--    (not the uuid type) — it holds Memorix's own identifiers, so keep the
--    column type and just generate text-shaped uuids for the stragglers.
UPDATE bph_works
   SET uuid = gen_random_uuid()::text
 WHERE uuid IS NULL OR TRIM(uuid) = '';

-- 2. A foreign key needs a unique target. Verified 0 duplicates above; this
--    will fail loudly rather than silently if that ever stops being true.
ALTER TABLE bph_works
  ADD CONSTRAINT bph_works_uuid_key UNIQUE (uuid);

-- 3. A revision may now be keyed by either identifier.
ALTER TABLE bph_works_revisions
  ALTER COLUMN ubn DROP NOT NULL;

ALTER TABLE bph_works_revisions
  ADD COLUMN IF NOT EXISTS work_uuid TEXT REFERENCES bph_works(uuid);

-- 4. ...but never by neither. This is the invariant the NOT NULL used to carry:
--    a revision that points at no work is history with no subject.
ALTER TABLE bph_works_revisions
  ADD CONSTRAINT bph_revision_targets_a_work
  CHECK (ubn IS NOT NULL OR work_uuid IS NOT NULL);

-- 5. Backfill work_uuid on existing revisions so history reads uniformly and a
--    future migration can drop the ubn key without losing the join.
UPDATE bph_works_revisions r
   SET work_uuid = w.uuid
  FROM bph_works w
 WHERE r.ubn = w.ubn
   AND r.work_uuid IS NULL;

CREATE INDEX IF NOT EXISTS bph_works_revisions_work_uuid_idx
  ON bph_works_revisions (work_uuid);

-- 6. The contributor queue has the same FK on ubn. Its ubn is already nullable
--    (a contributor may propose a new work without knowing the UBN), but a
--    proposal against an EXISTING manuscript still has nothing to point at, so
--    it needs the same uuid key. No CHECK here: unlike a revision, a pending
--    row legitimately targets no work yet.
ALTER TABLE bph_works_pending_changes
  ADD COLUMN IF NOT EXISTS work_uuid TEXT REFERENCES bph_works(uuid);

UPDATE bph_works_pending_changes p
   SET work_uuid = w.uuid
  FROM bph_works w
 WHERE p.ubn = w.ubn
   AND p.work_uuid IS NULL;

CREATE INDEX IF NOT EXISTS bph_works_pending_changes_work_uuid_idx
  ON bph_works_pending_changes (work_uuid);

COMMIT;
