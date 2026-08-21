-- Change detection for the BPH catalogue: make "distorted" knowable.
--
-- WHY THIS EXISTS
-- ---------------
-- bph_works is the BPH's system of record. Backups protect against LOSS; the
-- revision trail protects edits made through the editor. Neither protects
-- against DISTORTION — a script, a stray credential, or a well-meaning bulk
-- sweep silently changing thousands of rows. That is the failure mode you do
-- not find out about, because nothing is missing and nothing errors.
--
-- Only the editor path (applyWorkRevision) writes bph_works_revisions. Plenty
-- of other code writes bph_works directly — the sl_book_id sync cron, the NAS
-- ingest, format derivation, dedupe, the various backfills — and any of them
-- could change a title or a shelf mark without leaving a trace. Measured
-- 2026-08-01: 20,093 revisions exist, of which 46 are human; the other ~29,800
-- rows have been edited over eight years with no per-field history at all.
--
-- So this compares the catalogue against itself, nightly, and asks of every
-- change: IS THIS EXPLAINED? A change with a matching revision row is
-- accounted for. A change touching only automation-owned columns is expected.
-- Anything else is unexplained and pages a human.
--
-- HOW IT WORKS
-- ------------
-- Per row we store five group hashes rather than one. A single whole-row hash
-- would tell you *that* something changed but not *what kind* — and the
-- 6-hourly sl_book_id sync would then make every night look like a change.
-- Grouping lets the expected churn (automation) be distinguished from the
-- things nobody should be touching unattended (bibliography, location, notes).
--
-- Deliberately NOT hashed: search_tsv and the *_norm generated columns (derived
-- — they change when their sources do, which is already caught), and
-- last-checked bookkeeping. field_provenance IS hashed: a writer that edits a
-- record and forges its provenance should show up.
--
-- Run via Supabase SQL editor or psql:
--   psql "$DATABASE_URL" -f scripts/migration/add-bph-integrity-monitor.sql

BEGIN;

-- Current fingerprint, one row per catalogue record.
CREATE TABLE IF NOT EXISTS bph_works_integrity (
  -- bph_works.id is TEXT, not uuid (bph_works_revisions.id IS uuid — don't
  -- copy this type from there).
  id                text PRIMARY KEY,
  ubn               text,
  hash_biblio       text NOT NULL,
  hash_location     text NOT NULL,
  hash_notes        text NOT NULL,
  hash_identifiers  text NOT NULL,
  hash_automation   text NOT NULL,
  first_seen        timestamptz NOT NULL DEFAULT now(),
  last_checked      timestamptz NOT NULL DEFAULT now(),
  last_changed      timestamptz
);

-- Append-only log of every detected change. This is the artifact you show
-- someone who asks "how would you know if my work had been altered?".
CREATE TABLE IF NOT EXISTS bph_works_integrity_events (
  id            bigserial PRIMARY KEY,
  detected_at   timestamptz NOT NULL DEFAULT now(),
  work_id       text,          -- bph_works.id (text)
  ubn           text,
  kind          text NOT NULL,          -- inserted | changed | deleted
  groups_changed text[],                -- biblio | location | notes | identifiers | automation
  explanation   text NOT NULL,          -- revision | automation | UNEXPLAINED
  revision_id   uuid,                   -- matching bph_works_revisions.id when explanation='revision'
  reviewed_at   timestamptz,            -- set by a human who has looked
  reviewed_by   text,
  note          text
);

CREATE INDEX IF NOT EXISTS idx_bph_integrity_events_detected
  ON bph_works_integrity_events (detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_bph_integrity_events_unexplained
  ON bph_works_integrity_events (explanation, detected_at DESC)
  WHERE explanation = 'UNEXPLAINED';

-- Column groups. Keeping these in one function makes the classification
-- auditable in a single place: if you add a column to bph_works, decide here
-- which group owns it. Anything unlisted lands in 'biblio' by default, which
-- fails LOUD (an unexplained change) rather than silent — the safe direction.
CREATE OR REPLACE FUNCTION public.bph_row_hashes(r bph_works)
RETURNS TABLE (biblio text, location text, notes text, identifiers text, automation text)
LANGUAGE sql IMMUTABLE AS $$
  SELECT
    md5(concat_ws('|',
      r.title, r.parallel_title, r.uniform_title, r.full_title,
      r.series_title, r.volume_title, r.journal_title, r.volume_number,
      r.author, r.variant_author, r.pseudonym, r.author_canonical_name,
      r.editor, r.variant_editor, r.compiler, r.scribe,
      r.statement_of_responsibility, r.author_entity_id, r.author_viaf_id,
      r.author_wikidata_qid, r.contributors::text,
      r.place, r.printer, r.publisher, r.variant_printer, r.variant_publisher,
      r.impressum_original, r.edition_note, r.ms_date, r.origin,
      r.year, r.year_raw, r.language, r.detected_language, r.script,
      r.keywords, r.record_type, r.object_size, r.object_size_cm,
      r.bibliographic_format, r.binding, r.bound_with, r.physical_description,
      r.pagination, r.characterization, r.iconography,
      r.illumination_illustration, r.number_of_copies, r.thumbnail
    )),
    md5(concat_ws('|',
      r.shelf_mark, r.state_shelf_mark, r.present_location, r.location,
      r.provenance, r.collection, r.cross_listed_with_uuid
    )),
    md5(concat_ws('|',
      r.bibliography, r.remarks, r.annotation, r.contents,
      r.internal_remarks, r.exhibition_history, r.field_provenance::text
    )),
    md5(concat_ws('|',
      r.ubn, r.ustc_sn::text, r.ia_identifier, r.ia_url, r.picturae_barcode,
      r.icn_registration_number, r.uuid::text
    )),
    -- Columns owned by automation. Changes confined here are expected churn:
    -- the 6-hourly sl_book_id sync, IA matching, first-translation derivation,
    -- Memorix file bookkeeping, and the acquisition/workflow fields.
    md5(concat_ws('|',
      r.sl_book_id, r.sl_book_slug,
      r.sl_external_book_id, r.sl_external_slug, r.sl_external_source,
      r.is_first_translation::text,
      r.ia_match_confidence::text, r.ia_match_method, r.ia_title_similarity::text,
      r.ia_author_match::text, r.ia_year_match::text, r.ia_matched_at::text,
      r.ia_match_validated::text, r.ia_match_is_same_work::text,
      r.ia_match_is_same_edition::text, r.ia_match_validated_by,
      r.ia_match_validation_notes, r.ia_match_validated_at::text,
      r.memorix_file_count::text, r.memorix_files::text,
      r.memorix_total_file_bytes::text, r.memorix_modified_time::text,
      r.memorix_raw::text, r.file_count::text,
      r.modified_time::text, r.modified_by_username, r.modified_by_email,
      r.status, r.work_status, r.fully_approved, r.delivered_to_customer,
      r.publish_scan, r.acquisition_date, r.acquisition_source, r.price,
      r.created_at::text
    ))
$$;

-- One pass: fingerprint every row, log what moved, update the baseline.
-- Returns the events it just recorded so the caller can alert on them.
CREATE OR REPLACE FUNCTION public.bph_integrity_scan()
RETURNS TABLE (kind text, explanation text, ubn text, groups_changed text[])
LANGUAGE plpgsql AS $$
DECLARE
  run_at timestamptz := now();
BEGIN
  CREATE TEMP TABLE _cur ON COMMIT DROP AS
  SELECT w.id, w.ubn, h.biblio, h.location, h.notes, h.identifiers, h.automation
  FROM bph_works w, LATERAL public.bph_row_hashes(w) h;

  -- Rows that vanished. Never expected; a delete is always worth a human look.
  INSERT INTO bph_works_integrity_events (detected_at, work_id, ubn, kind, groups_changed, explanation)
  SELECT run_at, i.id, i.ubn, 'deleted', ARRAY[]::text[], 'UNEXPLAINED'
  FROM bph_works_integrity i
  WHERE NOT EXISTS (SELECT 1 FROM _cur c WHERE c.id = i.id);

  DELETE FROM bph_works_integrity i
  WHERE NOT EXISTS (SELECT 1 FROM _cur c WHERE c.id = i.id);

  -- Changed rows, with their explanation resolved in one place.
  INSERT INTO bph_works_integrity_events
        (detected_at, work_id, ubn, kind, groups_changed, explanation, revision_id)
  SELECT run_at, c.id, c.ubn, 'changed', g.groups,
         CASE
           WHEN rev.id IS NOT NULL THEN 'revision'
           WHEN g.groups = ARRAY['automation']::text[] THEN 'automation'
           ELSE 'UNEXPLAINED'
         END,
         rev.id
  FROM _cur c
  JOIN bph_works_integrity i ON i.id = c.id
  CROSS JOIN LATERAL (
    SELECT ARRAY_REMOVE(ARRAY[
      CASE WHEN c.biblio      IS DISTINCT FROM i.hash_biblio      THEN 'biblio'      END,
      CASE WHEN c.location    IS DISTINCT FROM i.hash_location    THEN 'location'    END,
      CASE WHEN c.notes       IS DISTINCT FROM i.hash_notes       THEN 'notes'       END,
      CASE WHEN c.identifiers IS DISTINCT FROM i.hash_identifiers THEN 'identifiers' END,
      CASE WHEN c.automation  IS DISTINCT FROM i.hash_automation  THEN 'automation'  END
    ], NULL) AS groups
  ) g
  LEFT JOIN LATERAL (
    SELECT r.id FROM bph_works_revisions r
    WHERE r.ubn = c.ubn AND r.applied_at > i.last_checked - interval '1 minute'
    ORDER BY r.applied_at DESC LIMIT 1
  ) rev ON true
  WHERE array_length(g.groups, 1) > 0;

  -- New rows. Explained if a 'create' revision exists, else worth a look —
  -- rows appearing in a catalogue of record without provenance is its own problem.
  INSERT INTO bph_works_integrity_events (detected_at, work_id, ubn, kind, groups_changed, explanation, revision_id)
  SELECT run_at, c.id, c.ubn, 'inserted', ARRAY[]::text[],
         CASE WHEN rev.id IS NOT NULL THEN 'revision' ELSE 'UNEXPLAINED' END, rev.id
  FROM _cur c
  LEFT JOIN bph_works_integrity i ON i.id = c.id
  LEFT JOIN LATERAL (
    SELECT r.id FROM bph_works_revisions r
    WHERE r.ubn = c.ubn AND r.change_type = 'create'
    ORDER BY r.applied_at DESC LIMIT 1
  ) rev ON true
  WHERE i.id IS NULL
    -- First run establishes the baseline rather than reporting 29,879 inserts.
    AND EXISTS (SELECT 1 FROM bph_works_integrity);

  -- Roll the baseline forward.
  INSERT INTO bph_works_integrity AS t
        (id, ubn, hash_biblio, hash_location, hash_notes, hash_identifiers, hash_automation, last_checked)
  SELECT c.id, c.ubn, c.biblio, c.location, c.notes, c.identifiers, c.automation, run_at
  FROM _cur c
  ON CONFLICT (id) DO UPDATE SET
    ubn              = EXCLUDED.ubn,
    hash_biblio      = EXCLUDED.hash_biblio,
    hash_location    = EXCLUDED.hash_location,
    hash_notes       = EXCLUDED.hash_notes,
    hash_identifiers = EXCLUDED.hash_identifiers,
    hash_automation  = EXCLUDED.hash_automation,
    last_checked     = EXCLUDED.last_checked,
    last_changed     = CASE
      WHEN t.hash_biblio      IS DISTINCT FROM EXCLUDED.hash_biblio
        OR t.hash_location    IS DISTINCT FROM EXCLUDED.hash_location
        OR t.hash_notes       IS DISTINCT FROM EXCLUDED.hash_notes
        OR t.hash_identifiers IS DISTINCT FROM EXCLUDED.hash_identifiers
        OR t.hash_automation  IS DISTINCT FROM EXCLUDED.hash_automation
      THEN run_at ELSE t.last_changed END;

  RETURN QUERY
    SELECT e.kind, e.explanation, e.ubn, e.groups_changed
    FROM bph_works_integrity_events e
    WHERE e.detected_at = run_at
    ORDER BY (e.explanation = 'UNEXPLAINED') DESC, e.ubn;
END;
$$;

COMMIT;
