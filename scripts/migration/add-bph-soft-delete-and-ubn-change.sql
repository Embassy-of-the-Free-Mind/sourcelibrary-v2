-- BPH catalogue: delete a record (soft) and correct a record's UBN.
--
-- PRIOR ART: scripts/migration/add-bph-uuid-keyed-revisions.sql (the FKs this
-- file relaxes), add-bph-worklist-rpc.sql (the RPC re-issued below, copied
-- from the LIVE definition on 2026-10-16, not from that file).
--
-- WHY
--
-- José Bouman, 2026-10-07: "How can we delete a complete record? For the
-- moment only me and Paul should have that possibility. And of course the
-- system has to ask you first." (#6800)
-- José Bouman, 2026-10-14: "Need to be able to make a correction in the UBN
-- (to correct mistakes...). Now it cannot be changed." (#6799)
--
-- DELETE IS SOFT. bph_works is the system of record (see
-- .claude/docs/bph-catalogue-disaster-recovery.md); a deleted record keeps its
-- row, gains deleted_at/deleted_by/deleted_reason, disappears from search,
-- export, counts and the worklist, and can be restored by a catalogue admin.
-- Nothing in the app ever issues a row DELETE for a catalogue record.
--
-- A UBN CHANGE MUST NOT ORPHAN HISTORY. bph_works_revisions.ubn and
-- bph_works_pending_changes.ubn reference bph_works(ubn) with the default
-- ON UPDATE NO ACTION, so changing a UBN that has any history would be
-- rejected outright. ON UPDATE CASCADE carries the history to the new number.
-- (bph_works.id is the primary key; ubn is only a unique column, so nothing
-- else keys on it.) The old number is kept in previous_ubns so /catalog/<old>
-- can redirect and Source Library book links keyed on the old UBN still
-- resolve.
--
-- Idempotent: safe to re-run.

BEGIN;

ALTER TABLE public.bph_works
  ADD COLUMN IF NOT EXISTS deleted_at     timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by     text,
  ADD COLUMN IF NOT EXISTS deleted_reason text,
  ADD COLUMN IF NOT EXISTS previous_ubns  text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_bph_works_deleted_at
  ON public.bph_works (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bph_works_previous_ubns
  ON public.bph_works USING gin (previous_ubns);

ALTER TABLE public.bph_works_revisions
  DROP CONSTRAINT IF EXISTS bph_works_revisions_ubn_fkey,
  ADD CONSTRAINT bph_works_revisions_ubn_fkey
    FOREIGN KEY (ubn) REFERENCES public.bph_works(ubn) ON UPDATE CASCADE;

ALTER TABLE public.bph_works_pending_changes
  DROP CONSTRAINT IF EXISTS bph_works_pending_changes_ubn_fkey,
  ADD CONSTRAINT bph_works_pending_changes_ubn_fkey
    FOREIGN KEY (ubn) REFERENCES public.bph_works(ubn) ON UPDATE CASCADE;

-- The worklist must not count deleted records. Live definition with one
-- change: every bph_works scan gains `w.deleted_at IS NULL`.
CREATE OR REPLACE FUNCTION public.bph_catalogue_worklist()
 RETURNS TABLE(category text, label text, detail text, n bigint, samples jsonb)
 LANGUAGE sql
 STABLE
AS $function$
  -- Real physical objects, on a shelf, with no name and no catalogue number.
  -- The most interesting rows in the catalogue and currently invisible.
  -- José Bouman answered this one on 2026-08-12: "These are indeed incomplete
  -- descriptions and they will be enhanced (sooner or later). Leave them as
  -- they are." So it stays visible as a known backlog, but it no longer asks
  -- for a number — manuscripts never get one — and it no longer reads as a
  -- question awaiting a decision that has already been made.
  SELECT 'undescribed_manuscripts',
         'Manuscripts on the shelf with no title yet',
         'Known incomplete descriptions, to be enhanced when there is time (José, 12 Aug). Listed so they are not forgotten; nothing to decide.',
         count(*),
         COALESCE(jsonb_agg(jsonb_build_object('ubn', ubn, 'uuid', uuid, 'id', id, 'shelf_mark', shelf_mark, 'hint', present_location)
                  ORDER BY shelf_mark) FILTER (WHERE rn <= 25), '[]'::jsonb)
  FROM (
    SELECT w.*, row_number() OVER (ORDER BY w.shelf_mark) rn
    FROM bph_works w
    WHERE w.deleted_at IS NULL AND w.record_type = 'manuscript'
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
    WHERE w.deleted_at IS NULL AND w.record_type = 'printed'
      AND public.bph_any_title(w) IS NULL
      AND w.shelf_mark IS NULL
      AND w.ubn IS NULL
  ) t

  UNION ALL

  -- Records with NO WAY TO FIND THE OBJECT: no catalogue number and no shelf
  -- mark either.
  --
  -- This category used to be "Records with no UBN", all 2,012 of them, and it
  -- was wrong in the way this file exists to prevent — it counted correct data
  -- as a defect. José Bouman, 2026-08-12, answering it:
  --
  --   "Manuscripts never have a UBN, instead they have a manuscript number
  --    (M+ number, or just a number, like 216, 217, 218). […] M-numbers
  --    (manuscripts) and FOT-items don't have a UBN"
  --
  -- 1,771 of the 2,012 are exactly those manuscripts (812) and photocopies
  -- (959), correctly catalogued, and no amount of librarian attention would
  -- ever change them. Asking about them forever is how a worklist teaches
  -- someone to stop opening it. What is genuinely actionable is a record with
  -- neither identifier — nothing to search by and nothing to find on a shelf.
  -- Measured 2026-08-13: 253 rows, of which 228 have no title either (they are
  -- the empty_printed_stubs above) and 25 have a title but no location at all.
  SELECT 'unfindable_records',
         'Records with no UBN and no shelf mark',
         'Nothing to look them up by and nothing to find them on a shelf with. Each needs an identifier, or removing.',
         count(*),
         COALESCE(jsonb_agg(jsonb_build_object('ubn', ubn, 'uuid', uuid, 'id', id, 'shelf_mark', shelf_mark, 'hint', any_title)
                  ORDER BY id) FILTER (WHERE rn <= 25), '[]'::jsonb)
  FROM (
    SELECT w.*, public.bph_any_title(w) AS any_title, row_number() OVER (ORDER BY w.id) rn
    FROM bph_works w
    WHERE w.deleted_at IS NULL AND w.ubn IS NULL
      AND (w.shelf_mark IS NULL OR TRIM(w.shelf_mark) = '')
  ) t

  UNION ALL

  -- The other half of the "neen" cleanup, deliberately left for a librarian:
  -- emptying "ja" would destroy the only trace that these copies ARE on loan.
  -- Answered and swept on 2026-08-13: José chose "yes" over emptying, because
  -- the value records that the copy IS on loan. The 31 rows were translated by
  -- scripts/maintenance/translate-ja-state-shelfmark.mjs and the normaliser now
  -- maps ja→yes at the write boundary, so this returns 0 and drops out of the
  -- page. It is KEPT as a standing detector: a non-zero count here means a
  -- Memorix re-import has reintroduced the Dutch.
  SELECT 'state_shelfmark_ja',
         'State Collection shelf mark reads "ja" again',
         'Cleared on 13 Aug (translated to "yes"). If this is non-zero, an import has put the Dutch back — the normaliser should have prevented it.',
         count(*),
         COALESCE(jsonb_agg(jsonb_build_object('ubn', ubn, 'uuid', uuid, 'id', id, 'shelf_mark', shelf_mark, 'hint', any_title)
                  ORDER BY ubn) FILTER (WHERE rn <= 25), '[]'::jsonb)
  FROM (
    SELECT w.*, public.bph_any_title(w) AS any_title, row_number() OVER (ORDER BY w.ubn) rn
    FROM bph_works w WHERE w.deleted_at IS NULL AND lower(trim(w.state_shelf_mark)) = 'ja'
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
$function$

;

-- The integrity monitor must SEE a delete, a restore and a UBN change. Live
-- definition of bph_row_hashes with four columns appended to the identifiers
-- group. Hash-neutral for every existing row: concat_ws() skips NULLs, the
-- deleted_* columns are NULL until a delete, and an empty previous_ubns is
-- folded to NULL. So applying this flags nothing; the first real delete or
-- UBN change shows up as an identifiers change, explained by its revision.
CREATE OR REPLACE FUNCTION public.bph_row_hashes(r bph_works)
 RETURNS TABLE(biblio text, location text, notes text, identifiers text, automation text)
 LANGUAGE sql
 IMMUTABLE
AS $function$
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
      r.icn_registration_number, r.uuid::text,
      r.deleted_at::text, r.deleted_by, r.deleted_reason,
      NULLIF(r.previous_ubns::text, '{}')
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
$function$;

COMMIT;
