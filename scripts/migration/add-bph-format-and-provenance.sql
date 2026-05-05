-- Add bibliographic format + per-field provenance to bph_works.
--
-- `bibliographic_format` is the cataloger's "what fold of sheet is this" answer
-- (folio / quarto / octavo / duodecimo / sextodecimo / smaller). Vitec Memorix
-- export doesn't include it; we derive from `object_size_cm` height where
-- possible, and leave NULL when there's no signal.
--
-- `field_provenance` is a JSONB map keyed by field name. Each entry records
-- `source` (e.g. "import", "derived_from_size", "manual"), `evidence` (free
-- text — what we used to decide), and `derived_at` (ISO timestamp). This lets
-- Paul's team distinguish authoritative cataloged data from our heuristic
-- backfill, and gives librarians a clear path to override (set the field by
-- hand, write `source: "manual"`).
--
-- Run via:
--   psql "$DATABASE_URL" -f scripts/migration/add-bph-format-and-provenance.sql

ALTER TABLE bph_works
  ADD COLUMN IF NOT EXISTS bibliographic_format TEXT,
  ADD COLUMN IF NOT EXISTS field_provenance     JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS bph_works_format_idx ON bph_works (bibliographic_format)
  WHERE bibliographic_format IS NOT NULL;
