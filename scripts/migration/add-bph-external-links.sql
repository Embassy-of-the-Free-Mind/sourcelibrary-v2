-- Add external-link columns to bph_works so the catalogue can surface BPH-held
-- works that were digitised by another archive (Internet Archive, CMC Kloss,
-- MDZ, Gallica, e-rara, etc.) without conflating them with BPH-native scans.
--
-- Invariant: sl_book_id continues to mean "BPH digitised this work and we host
-- the scans on Source Library." The new sl_external_* columns mean "BPH holds
-- this work physically and a scan is available on Source Library, sourced from
-- another provider." A row may have both filled (rare but possible — same UBN
-- has both a BPH scan and a cross-provider match), or neither, or only one.
--
-- Run via Supabase SQL editor or psql:
--   psql "$DATABASE_URL" -f scripts/migration/add-bph-external-links.sql

ALTER TABLE bph_works
  ADD COLUMN IF NOT EXISTS sl_external_book_id TEXT,
  ADD COLUMN IF NOT EXISTS sl_external_slug    TEXT,
  ADD COLUMN IF NOT EXISTS sl_external_source  TEXT;
  -- sl_external_source mirrors the source Mongo book's image_source.provider
  -- (e.g. 'internet_archive', 'cmc_kloss', 'mdz', 'gallica', 'e-rara',
  -- 'google_books', 'allard_pierson', 'bodleian', 'vatican', 'cambridge',
  -- 'laurenziana'). Free-text rather than enum because new providers get
  -- added periodically and we don't want an ALTER per provider.

CREATE INDEX IF NOT EXISTS bph_works_sl_external_book_id_idx
  ON bph_works (sl_external_book_id) WHERE sl_external_book_id IS NOT NULL;
