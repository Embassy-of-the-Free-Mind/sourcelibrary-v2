-- Expand bph_works to hold the full Vitec Memorix BPH catalog export (BibliotheekExportTest.csv).
-- Source: ~/Downloads/BibliotheekExportTest.csv (~28,813 rows, 49 columns).
-- Mapping covers Paul Dijstelberge's "Model Catalogus" spec + admin/internal fields.
--
-- Run via Supabase SQL editor or psql:
--   psql "$DATABASE_URL" -f scripts/migration/expand-bph-works-schema.sql

ALTER TABLE bph_works
  -- Title family (Paul §3 — short, full transcription, variant)
  ADD COLUMN IF NOT EXISTS parallel_title       TEXT, -- Full title-page transcription
  ADD COLUMN IF NOT EXISTS uniform_title        TEXT, -- Variant / engraved / French title
  -- Author family (Paul §1 — title-page form + standard form; standard already in `author`)
  ADD COLUMN IF NOT EXISTS variant_author       TEXT, -- "Variant author's name" — title-page form
  ADD COLUMN IF NOT EXISTS pseudonym            TEXT,
  -- Secondary author (Paul §2)
  ADD COLUMN IF NOT EXISTS editor               TEXT, -- standard editor/translator name
  ADD COLUMN IF NOT EXISTS variant_editor       TEXT, -- title-page form
  -- Imprint variants (Paul §4 — printer/publisher already exist as standard form)
  ADD COLUMN IF NOT EXISTS variant_printer      TEXT,
  ADD COLUMN IF NOT EXISTS variant_publisher    TEXT,
  -- Location (Paul §10 — Location + Cabinet)
  ADD COLUMN IF NOT EXISTS present_location     TEXT, -- e.g. "Leeszaal", "Depot"
  ADD COLUMN IF NOT EXISTS state_shelf_mark     TEXT, -- "BPH State Collection shelf mark"
  -- Hierarchy
  ADD COLUMN IF NOT EXISTS series_title         TEXT,
  ADD COLUMN IF NOT EXISTS volume_title         TEXT,
  -- Notes (Paul §9)
  ADD COLUMN IF NOT EXISTS bibliography         TEXT,
  ADD COLUMN IF NOT EXISTS remarks              TEXT,
  ADD COLUMN IF NOT EXISTS internal_remarks     TEXT, -- admin
  -- Physical (Paul §7, §8)
  ADD COLUMN IF NOT EXISTS number_of_copies     INTEGER,
  ADD COLUMN IF NOT EXISTS object_size_cm       TEXT,
  ADD COLUMN IF NOT EXISTS binding              TEXT,
  ADD COLUMN IF NOT EXISTS bound_with           TEXT,
  -- Provenance / Collection (Paul §11)
  ADD COLUMN IF NOT EXISTS provenance           TEXT,
  -- Admin (Paul §13)
  ADD COLUMN IF NOT EXISTS picturae_barcode     TEXT,
  ADD COLUMN IF NOT EXISTS uuid                 TEXT,
  ADD COLUMN IF NOT EXISTS work_status          TEXT, -- raw "Status" column (e.g. "avail. ...", "neen")
  ADD COLUMN IF NOT EXISTS acquisition_date     TEXT, -- kept TEXT, source data is messy (mix of years/dates/null)
  ADD COLUMN IF NOT EXISTS acquisition_source   TEXT,
  ADD COLUMN IF NOT EXISTS price                TEXT, -- TEXT — values include currency / "neen" / blanks
  ADD COLUMN IF NOT EXISTS fully_approved       TEXT,
  ADD COLUMN IF NOT EXISTS delivered_to_customer TEXT,
  ADD COLUMN IF NOT EXISTS publish_scan         TEXT,
  ADD COLUMN IF NOT EXISTS file_count           INTEGER,
  ADD COLUMN IF NOT EXISTS thumbnail            TEXT,
  ADD COLUMN IF NOT EXISTS modified_time        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS modified_by_username TEXT,
  ADD COLUMN IF NOT EXISTS modified_by_email    TEXT,
  -- Bridge to Source Library (filled by enrichment, not from CSV)
  ADD COLUMN IF NOT EXISTS sl_book_id           TEXT,
  ADD COLUMN IF NOT EXISTS sl_book_slug         TEXT,
  -- Generated full-text search vector across all public-facing fields
  ADD COLUMN IF NOT EXISTS search_tsv           TSVECTOR;

-- Recompute search_tsv for full simple-search coverage (every field a user might type)
CREATE OR REPLACE FUNCTION bph_works_search_tsv_update() RETURNS TRIGGER AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.parallel_title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.uniform_title, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.author, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.variant_author, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.pseudonym, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW.editor, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.variant_editor, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW.place, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW.printer, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW.publisher, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW.variant_printer, '')), 'D') ||
    setweight(to_tsvector('simple', coalesce(NEW.variant_publisher, '')), 'D') ||
    setweight(to_tsvector('simple', coalesce(NEW.keywords, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.language, '')), 'D') ||
    setweight(to_tsvector('simple', coalesce(NEW.shelf_mark, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW.state_shelf_mark, '')), 'D') ||
    setweight(to_tsvector('simple', coalesce(NEW.present_location, '')), 'D') ||
    setweight(to_tsvector('simple', coalesce(NEW.series_title, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW.volume_title, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW.bibliography, '')), 'D') ||
    setweight(to_tsvector('simple', coalesce(NEW.remarks, '')), 'D') ||
    setweight(to_tsvector('simple', coalesce(NEW.provenance, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW.binding, '')), 'D') ||
    setweight(to_tsvector('simple', coalesce(NEW.bound_with, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bph_works_search_tsv_trigger ON bph_works;
CREATE TRIGGER bph_works_search_tsv_trigger
  BEFORE INSERT OR UPDATE ON bph_works
  FOR EACH ROW EXECUTE FUNCTION bph_works_search_tsv_update();

-- Indexes for advanced search + filters
CREATE INDEX IF NOT EXISTS bph_works_search_tsv_idx        ON bph_works USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS bph_works_year_idx              ON bph_works (year);
CREATE INDEX IF NOT EXISTS bph_works_language_idx          ON bph_works (language);
CREATE INDEX IF NOT EXISTS bph_works_author_trgm_idx       ON bph_works USING GIN (author gin_trgm_ops);
CREATE INDEX IF NOT EXISTS bph_works_title_trgm_idx        ON bph_works USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS bph_works_place_trgm_idx        ON bph_works USING GIN (place gin_trgm_ops);
CREATE INDEX IF NOT EXISTS bph_works_printer_trgm_idx      ON bph_works USING GIN (printer gin_trgm_ops);
CREATE INDEX IF NOT EXISTS bph_works_publisher_trgm_idx    ON bph_works USING GIN (publisher gin_trgm_ops);
CREATE INDEX IF NOT EXISTS bph_works_provenance_idx        ON bph_works (provenance);
CREATE INDEX IF NOT EXISTS bph_works_sl_book_id_idx        ON bph_works (sl_book_id) WHERE sl_book_id IS NOT NULL;

-- pg_trgm must be enabled (no-op if already)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- After running this, run scripts/migration/import-bph-catalog.mjs to upsert all 28,813 rows.
-- Then run UPDATE bph_works SET ubn = ubn; to backfill search_tsv on existing rows.
