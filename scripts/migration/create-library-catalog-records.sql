-- library_catalog_records — multi-tenant bibliographic catalogue table.
--
-- Replaces the per-tenant pattern (bph_works, would-be kloss_works, etc.)
-- with one unified table keyed by tenant_id. Each tenant brings its own
-- bibliographic export; the shared columns are the BPH-aligned superset,
-- and tenant-specific fields live in the JSONB `metadata` column.
--
-- This migration is additive — bph_works stays in place. The new generic
-- /api/catalog/[tenant] route reads from this table; /api/catalog/bph
-- continues to read from bph_works until a later migration consolidates.
--
-- Run via Supabase SQL editor or the migration runner.

CREATE TABLE IF NOT EXISTS library_catalog_records (
  id BIGSERIAL PRIMARY KEY,

  -- Tenant identity. Matches tenants.slug in MongoDB.
  tenant_id TEXT NOT NULL,

  -- Tenant-specific external catalogue ID.
  --   BPH:  ubn (e.g. "0123456")
  --   Kloss: priref (CMC catalogue priref, e.g. "322")
  catalog_id TEXT NOT NULL,

  -- ───────── Common bibliographic fields (BPH-aligned superset) ─────────

  title TEXT,
  parallel_title TEXT,
  uniform_title TEXT,

  author TEXT,
  variant_author TEXT,
  pseudonym TEXT,

  editor TEXT,
  variant_editor TEXT,

  place TEXT,
  printer TEXT,
  publisher TEXT,
  variant_printer TEXT,
  variant_publisher TEXT,

  -- Numeric year (best-effort parsed from free-text)
  year INT,
  -- Original free-text year for display ("[ca. 1805-06]", "MDLXXX", etc.)
  year_text TEXT,

  shelf_mark TEXT,
  state_shelf_mark TEXT,
  present_location TEXT,

  keywords TEXT,
  language TEXT,

  series_title TEXT,
  volume_title TEXT,

  bibliography TEXT,
  remarks TEXT,

  number_of_copies INT,
  object_size_cm TEXT,
  binding TEXT,
  bound_with TEXT,

  provenance TEXT,
  thumbnail TEXT,
  file_count INT,

  -- ───────── Linkage to live Source Library data ─────────

  -- When this catalogue row is digitised on Source Library,
  -- sl_book_id points at the live Mongo books.id.
  sl_book_id TEXT,
  sl_book_slug TEXT,

  -- External-archive identifiers (Internet Archive, USTC, etc.) for
  -- catalogue rows that aren't digitised on SL but exist elsewhere.
  ia_identifier TEXT,
  ustc_sn TEXT,

  -- Cross-provider linkage: the work is held physically by this tenant
  -- but the scan we surface lives at another archive. Kept separate
  -- from sl_book_id so digitised-here counters stay precise.
  sl_external_book_id TEXT,
  sl_external_slug TEXT,
  sl_external_source TEXT,

  -- ───────── Tenant-specific extras ─────────

  -- Anything not in the shared columns lives here. Examples:
  --   Kloss: kloss_shelf_mark, digital_references[], notes[], scan_verification{...}
  --   BPH:   variant_keywords, donor_provenance, conservation_notes
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- ───────── Bookkeeping ─────────

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Each tenant's catalogue IDs are unique within that tenant.
  CONSTRAINT library_catalog_records_tenant_catalog_id_key
    UNIQUE (tenant_id, catalog_id)
);

-- ───────── Indexes ─────────
-- Every query starts with tenant_id, so compound indexes lead with it.

CREATE INDEX IF NOT EXISTS idx_lcr_tenant_id
  ON library_catalog_records(tenant_id);

CREATE INDEX IF NOT EXISTS idx_lcr_tenant_sl_book
  ON library_catalog_records(tenant_id, sl_book_id)
  WHERE sl_book_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lcr_tenant_year
  ON library_catalog_records(tenant_id, year);

CREATE INDEX IF NOT EXISTS idx_lcr_tenant_title
  ON library_catalog_records(tenant_id, title);

CREATE INDEX IF NOT EXISTS idx_lcr_tenant_author
  ON library_catalog_records(tenant_id, author);

CREATE INDEX IF NOT EXISTS idx_lcr_tenant_shelf_mark
  ON library_catalog_records(tenant_id, shelf_mark);

-- GIN index on metadata for tenant-specific facet queries.
CREATE INDEX IF NOT EXISTS idx_lcr_metadata_gin
  ON library_catalog_records USING GIN (metadata);

-- ───────── updated_at trigger ─────────

CREATE OR REPLACE FUNCTION library_catalog_records_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS library_catalog_records_set_updated_at ON library_catalog_records;
CREATE TRIGGER library_catalog_records_set_updated_at
  BEFORE UPDATE ON library_catalog_records
  FOR EACH ROW
  EXECUTE FUNCTION library_catalog_records_touch_updated_at();

-- ───────── Notes ─────────
-- Full-text search and diacritic normalisation indexes are deliberately
-- omitted from this initial migration. They'll be added in a follow-up
-- (mirroring add-bph-diacritic-normalization.sql) once the column shape
-- has settled across tenants.
