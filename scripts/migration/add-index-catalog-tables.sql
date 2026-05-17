-- Banned-books reference catalogs (issue #1851).
--
-- Two tables, mirroring the BPH catalog pattern (bph_works at /embed/[tenant]/catalog/[ubn]):
--   - index_catalogs:        one row per historical index (Roman 1948, Spanish 1583, Nazi 1935, …)
--   - index_catalog_entries: one row per condemned work; ~4,327 just for Roman 1948 (Bujanda final).
--
-- An entry may have sl_book_id (we hold a digitised copy) or only ustc_sn (we don't, but USTC does)
-- or neither (manuscript-only / lost work). The collection page renders the SL-held subset as the
-- primary content; the full catalog is a secondary section beneath.
--
-- Run via Supabase SQL editor or psql:
--   psql "$DATABASE_URL" -f scripts/migration/add-index-catalog-tables.sql
-- Idempotent.

CREATE TABLE IF NOT EXISTS index_catalogs (
  id              TEXT PRIMARY KEY,                       -- 'roman-1948', 'spanish-1583-quiroga', etc.
  name            TEXT NOT NULL,                          -- Display name
  short_name      TEXT,
  authority       TEXT,                                   -- "Holy See", "Spanish Inquisition", "NSDAP", etc.
  start_year      INTEGER,
  end_year        INTEGER,
  collection_slug TEXT,                                   -- Linked SL collection (e.g. 'index-librorum-prohibitorum')
  description     TEXT,
  source          TEXT,                                   -- Citation for the dataset (e.g. "Bujanda 1946 final edition")
  source_url      TEXT,
  entry_count     INTEGER DEFAULT 0,                      -- Cached count of index_catalog_entries
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS index_catalog_entries (
  id                  BIGSERIAL PRIMARY KEY,
  index_id            TEXT NOT NULL REFERENCES index_catalogs(id) ON DELETE CASCADE,
  source_id           TEXT,                               -- Original ID in source dataset (e.g. Bujanda CSV ID)

  -- Bibliographic
  title               TEXT NOT NULL,
  subtitle            TEXT,
  additional_titles   TEXT,
  original_title      TEXT,
  author              TEXT,                               -- "Surname, Forename" form
  author_normalized   TEXT,                               -- Lowercase surname for lookup
  author_alternates   TEXT[],                             -- Cross-language variants
  language            TEXT,
  place_publication   TEXT,
  publisher           TEXT,
  publication_date    TEXT,                               -- Original imprint year(s)

  -- Index-specific
  condemnation_year   INTEGER,                            -- When placed on this Index
  condemnation_period TEXT,                               -- Raw period field (often a range)
  scope               TEXT,                               -- 'opera_omnia' | 'single_work' | 'donec_corrigatur'
  censorship_type     TEXT,                               -- "Banned" | "Expurgated" | "Suspended"
  reason              TEXT,                               -- "Religious" | "Magic" | "Political" …
  censoring_body      TEXT,
  legal_ref           TEXT,
  notes               TEXT,

  -- Cross-references
  ustc_sn             BIGINT,                             -- Linked USTC edition serial number (FK to ustc_editions.sn — not enforced; USTC table may not always have the ed)
  sl_book_id          TEXT,                               -- Linked Source Library book Mongo _id
  sl_book_slug        TEXT,
  acquisition_sources JSONB,                              -- [{provider:'IA', url:'...'}, {provider:'Gallica', ...}]
  match_confidence    TEXT,                               -- 'high' | 'medium' | 'low' | null (no match)
  match_method        TEXT,                               -- 'csv_import' | 'ustc_join' | 'manual'
  field_provenance    JSONB,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_ice_index_id            ON index_catalog_entries(index_id);
CREATE INDEX IF NOT EXISTS ix_ice_author_normalized   ON index_catalog_entries(author_normalized);
CREATE INDEX IF NOT EXISTS ix_ice_ustc_sn             ON index_catalog_entries(ustc_sn)        WHERE ustc_sn IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ice_sl_book_id          ON index_catalog_entries(sl_book_id)     WHERE sl_book_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ice_condemnation_year   ON index_catalog_entries(condemnation_year);
CREATE INDEX IF NOT EXISTS ix_ice_index_sl            ON index_catalog_entries(index_id, sl_book_id);

-- Trigram index for diacritic-insensitive search on title + author
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS ix_ice_title_trgm  ON index_catalog_entries USING gin(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_ice_author_trgm ON index_catalog_entries USING gin(author gin_trgm_ops);

-- Keep entry_count in sync via trigger
CREATE OR REPLACE FUNCTION index_catalogs_refresh_entry_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE index_catalogs SET entry_count = (
      SELECT COUNT(*) FROM index_catalog_entries WHERE index_id = NEW.index_id
    ), updated_at = NOW() WHERE id = NEW.index_id;
  END IF;
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    UPDATE index_catalogs SET entry_count = (
      SELECT COUNT(*) FROM index_catalog_entries WHERE index_id = OLD.index_id
    ), updated_at = NOW() WHERE id = OLD.index_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ice_count ON index_catalog_entries;
CREATE TRIGGER trg_ice_count
AFTER INSERT OR UPDATE OR DELETE ON index_catalog_entries
FOR EACH ROW EXECUTE FUNCTION index_catalogs_refresh_entry_count();

-- Read access via anon key (matches bph_works / ustc_editions pattern)
ALTER TABLE index_catalogs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE index_catalog_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS index_catalogs_public_read ON index_catalogs;
DROP POLICY IF EXISTS index_catalog_entries_public_read ON index_catalog_entries;

CREATE POLICY index_catalogs_public_read        ON index_catalogs        FOR SELECT USING (true);
CREATE POLICY index_catalog_entries_public_read ON index_catalog_entries FOR SELECT USING (true);

COMMENT ON TABLE index_catalogs IS
  'Historical book indices (Roman Index Librorum Prohibitorum, Spanish Quiroga, Nazi 1935 list, …). One row per index/edition. Issue #1851.';
COMMENT ON TABLE index_catalog_entries IS
  'Individual works on a historical index. ~4,327 just for Roman 1948 (Bujanda final edition). sl_book_id links to a Source Library book when held; ustc_sn links to a USTC edition record when known. Issue #1851.';
