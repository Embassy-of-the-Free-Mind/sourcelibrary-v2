-- BPH Memorix → bph_works schema migration (2026-05-19)
--
-- This is the FINAL Memorix sync. After applying this + the companion .mjs
-- sync script, bph_works becomes the authoritative source for the BPH
-- catalog. Memorix is no longer pulled.
--
-- Companion docs:
--   .claude/docs/bph-memorix-alignment-2026-05-19.md
--   scripts/migration/bph-memorix-final-sync.mjs
--
-- Idempotency: each ADD COLUMN uses IF NOT EXISTS so this can be re-run
-- safely. The CREATE TYPE uses a DO block to skip if the enum already
-- exists.

BEGIN;

-- 1. record_type discriminator
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bph_record_type') THEN
    CREATE TYPE bph_record_type AS ENUM ('printed', 'manuscript', 'photocopy');
  END IF;
END $$;

ALTER TABLE bph_works
  ADD COLUMN IF NOT EXISTS record_type bph_record_type NOT NULL DEFAULT 'printed';

-- 2. Lossless preservation of every Memorix field per record
ALTER TABLE bph_works
  ADD COLUMN IF NOT EXISTS memorix_raw JSONB,
  ADD COLUMN IF NOT EXISTS memorix_files JSONB,
  ADD COLUMN IF NOT EXISTS memorix_modified_time TIMESTAMPTZ;

COMMENT ON COLUMN bph_works.memorix_raw IS
  'Full field map from the Memorix XML record for this row (every <field name> → values). Source of truth for fields not promoted to columns.';
COMMENT ON COLUMN bph_works.memorix_files IS
  'List of jp2/scan file references from <files> in Memorix: [{uuid,name,filesize,mimetype}]. Used to match Picturae delivery to records.';

-- 3. Sammelband cross-listing (same physical scan, dual catalogued)
ALTER TABLE bph_works
  ADD COLUMN IF NOT EXISTS cross_listed_with_uuid UUID;

COMMENT ON COLUMN bph_works.cross_listed_with_uuid IS
  'Other bph_works.uuid that catalogues the same physical scan from a different perspective (e.g. printed↔manuscript). Two known cases as of 2026-05-19: RIT001000026, RIT001000028.';

-- 4. Manuscript-specific promoted columns (Handschriften)
ALTER TABLE bph_works
  ADD COLUMN IF NOT EXISTS full_title TEXT,
  ADD COLUMN IF NOT EXISTS script TEXT,
  ADD COLUMN IF NOT EXISTS scribe TEXT,
  ADD COLUMN IF NOT EXISTS iconography TEXT,
  ADD COLUMN IF NOT EXISTS compiler TEXT,
  ADD COLUMN IF NOT EXISTS contents TEXT,
  ADD COLUMN IF NOT EXISTS physical_description TEXT,
  ADD COLUMN IF NOT EXISTS characterization TEXT,
  ADD COLUMN IF NOT EXISTS origin TEXT,
  ADD COLUMN IF NOT EXISTS icn_registration_number TEXT,
  ADD COLUMN IF NOT EXISTS illumination_illustration TEXT,
  ADD COLUMN IF NOT EXISTS edition_note TEXT,
  ADD COLUMN IF NOT EXISTS statement_of_responsibility TEXT,
  ADD COLUMN IF NOT EXISTS ms_date TEXT;

COMMENT ON COLUMN bph_works.ms_date IS
  'Raw date string from Handschriften XML (e.g. "17th century; ca. 1650-1654"). Distinct from year_raw which targets printed-book year_of_publication.';

-- 5. Photocopy / journal article columns (Fotocopieen)
ALTER TABLE bph_works
  ADD COLUMN IF NOT EXISTS journal_title TEXT,
  ADD COLUMN IF NOT EXISTS volume_number TEXT,
  ADD COLUMN IF NOT EXISTS pagination TEXT,
  ADD COLUMN IF NOT EXISTS annotation TEXT;

-- 6. Denormalized file counters (kept in sync from bph_work_files for fast catalog rendering)
ALTER TABLE bph_works
  ADD COLUMN IF NOT EXISTS memorix_file_count INT,
  ADD COLUMN IF NOT EXISTS memorix_total_file_bytes BIGINT;

COMMENT ON COLUMN bph_works.memorix_file_count IS
  'Count of files from Memorix <files> for this record. Backfilled by sync .mjs; later kept in sync with bph_work_files row count.';
COMMENT ON COLUMN bph_works.memorix_total_file_bytes IS
  'Sum of filesize from Memorix <files>. Used for storage planning before R2 ingestion.';

-- 7. Indexes
CREATE INDEX IF NOT EXISTS idx_bph_works_record_type
  ON bph_works (record_type);
CREATE INDEX IF NOT EXISTS idx_bph_works_cross_listed_with
  ON bph_works (cross_listed_with_uuid)
  WHERE cross_listed_with_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bph_works_memorix_raw_gin
  ON bph_works USING GIN (memorix_raw);

-- 8. Per-file inventory table (populated by Step 9 once the scans XML arrives)
--
-- bph_work_uuid is TEXT (not UUID with FK) because bph_works.uuid is TEXT and
-- has 102 NULL rows (Allard-Pierson backfill); a partial unique index on the
-- non-null subset isn't valid as an FK target. Integrity is maintained by the
-- sync script — Step 8 deletes manually clear bph_work_files rows in the same
-- transaction.
CREATE TABLE IF NOT EXISTS bph_work_files (
  file_uuid TEXT PRIMARY KEY,
  bph_work_uuid TEXT NOT NULL,
  file_name TEXT,
  file_size BIGINT,
  mimetype TEXT,
  ordering INT,
  memorix_folder_uuid TEXT,
  dc_identifier TEXT,
  r2_path TEXT,
  received_at TIMESTAMPTZ,
  r2_size_bytes BIGINT,
  page_number_in_record INT,
  is_title_page BOOLEAN,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE bph_work_files IS
  'Per-file inventory derived from the Memorix scans XML. file_uuid is the stable join key from Memorix. r2_path/received_at track R2 ingestion state — NULL means "not yet uploaded". bph_work_uuid references bph_works.uuid logically but has no FK constraint (parent column is TEXT and not unique).';

CREATE INDEX IF NOT EXISTS idx_bph_work_files_work_uuid
  ON bph_work_files (bph_work_uuid);
CREATE INDEX IF NOT EXISTS idx_bph_work_files_unreceived
  ON bph_work_files (received_at)
  WHERE received_at IS NULL;

COMMIT;

-- Post-flight verification (run separately, not in the same transaction):
--
-- SELECT record_type, COUNT(*) FROM bph_works GROUP BY 1;
--   expect: printed = ~28,167, manuscript = 812, photocopy = 959 after data sync
--
-- SELECT COUNT(*) FROM bph_works WHERE memorix_raw IS NOT NULL;
--   expect: ~29,938 after backfill (everything except the 3 deleted rows)
--
-- SELECT COUNT(*) FROM bph_works WHERE cross_listed_with_uuid IS NOT NULL;
--   expect: 4 (two pairs)
--
-- SELECT COUNT(*) FROM bph_work_files;
--   expect: 0 until Step 9 runs (scans XML ingest, separate follow-up PR)
