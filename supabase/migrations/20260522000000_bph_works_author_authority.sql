-- Add canonical author authority columns to bph_works.
--
-- The BPH catalogue keeps `author` (canonical-ish form, free text) and
-- `variant_author` (title-page transcription). Issue #1921 P3 adds a third
-- layer: a VIAF cluster id that pins identity for cross-archive matching
-- and a Wikidata Q-id for downstream linkage.
--
-- Columns:
--   author_entity_id       — VIAF cluster id (numeric string). Empty string
--                            means "explicitly unlinked"; NULL means "not yet
--                            checked". The editor UI writes empty string on
--                            Clear so we can distinguish editor intent from
--                            untouched rows in backfill scripts.
--   author_canonical_name  — Denormalised canonical display name (e.g.
--                            "Boccalini, Traiano"). Saves a join when
--                            rendering catalogue pages.
--   author_wikidata_qid    — Wikidata Q-id (e.g. "Q352718") when VIAF
--                            aggregates the link. NULL when unknown.
--
-- The editor pipeline:
--   1. Picker calls /api/authority/author/search with the typed name.
--   2. Cataloguer picks a row → form sets author_entity_id + sibling fields.
--   3. Save POSTs to /api/[tenant]/catalog/[ubn]/edit which calls
--      applyWorkRevision (bph-catalog.ts). Revision history captures the
--      change like any other field edit.
--
-- Issue #1921 (P3).

ALTER TABLE bph_works
  ADD COLUMN IF NOT EXISTS author_entity_id       TEXT,
  ADD COLUMN IF NOT EXISTS author_canonical_name  TEXT,
  ADD COLUMN IF NOT EXISTS author_wikidata_qid    TEXT;

-- Index for cross-archive matching queries — finding all books that share
-- a canonical author (e.g. Jung↔BPH alignment by VIAF cluster) is the
-- primary read pattern. Partial index keeps it small since most rows will
-- be NULL until backfilled.
CREATE INDEX IF NOT EXISTS idx_bph_works_author_entity_id
  ON bph_works (author_entity_id)
  WHERE author_entity_id IS NOT NULL AND author_entity_id <> '';

CREATE INDEX IF NOT EXISTS idx_bph_works_author_wikidata_qid
  ON bph_works (author_wikidata_qid)
  WHERE author_wikidata_qid IS NOT NULL AND author_wikidata_qid <> '';

COMMENT ON COLUMN bph_works.author_entity_id IS
  'VIAF cluster id for the canonical author. Empty string = explicitly unlinked, NULL = not yet checked. Set by the catalogue editor (#1921 P3).';
COMMENT ON COLUMN bph_works.author_canonical_name IS
  'Denormalised canonical author name from VIAF (e.g. "Boccalini, Traiano"). Saves a join on read.';
COMMENT ON COLUMN bph_works.author_wikidata_qid IS
  'Wikidata Q-id corresponding to the VIAF cluster, when VIAF aggregates the cross-link.';
