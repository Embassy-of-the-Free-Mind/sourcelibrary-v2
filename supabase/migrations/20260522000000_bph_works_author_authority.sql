-- Add canonical author authority columns to bph_works.
--
-- The BPH catalogue keeps `author` (canonical-ish form, free text) and
-- `variant_author` (title-page transcription). Issue #1921 P3 adds a third
-- layer: a foreign key into the shared `entities` collection (MongoDB,
-- written by both this editor and the batch enrichment script
-- scripts/enrichment/viaf-author-linking.mjs) plus three denormalised
-- display fields so the catalogue page can render without a join.
--
-- Columns:
--   author_entity_id       — Foreign key to the `entities` collection
--                            (entity._id as string). Empty string means
--                            "explicitly unlinked"; NULL means "not yet
--                            checked". The editor UI writes empty string on
--                            Clear so backfill scripts can distinguish
--                            editor intent from untouched rows.
--   author_canonical_name  — Denormalised canonical display name (e.g.
--                            "Boccalini, Traiano"). Saves a join when
--                            rendering catalogue pages.
--   author_wikidata_qid    — Wikidata Q-id (e.g. "Q352718") when VIAF
--                            aggregates the link. NULL when unknown.
--   author_viaf_id         — Denormalised VIAF cluster id (e.g. "22156484")
--                            for direct viaf.org linking on the catalogue
--                            page. NULL when the canonical was set only
--                            via Wikidata.
--
-- The editor pipeline:
--   1. Picker calls /api/authority/author/search with the typed name.
--   2. Cataloguer picks a row → POST /api/authority/author/link upserts
--      into the `entities` collection (existing shape) and returns
--      entity._id. Form sets the four sibling fields.
--   3. Save POSTs to /api/[tenant]/catalog/[ubn]/edit which calls
--      applyWorkRevision (bph-catalog.ts). Revision history captures the
--      change like any other field edit.
--
-- Issue #1921 (P3).

ALTER TABLE bph_works
  ADD COLUMN IF NOT EXISTS author_entity_id       TEXT,
  ADD COLUMN IF NOT EXISTS author_canonical_name  TEXT,
  ADD COLUMN IF NOT EXISTS author_wikidata_qid    TEXT,
  ADD COLUMN IF NOT EXISTS author_viaf_id         TEXT;

-- Indexes for cross-archive matching — finding all books that share a
-- canonical author (e.g. Jung↔BPH alignment by VIAF cluster) is the main
-- read pattern. Partial indexes stay small since most rows will be NULL
-- until backfilled.
CREATE INDEX IF NOT EXISTS idx_bph_works_author_entity_id
  ON bph_works (author_entity_id)
  WHERE author_entity_id IS NOT NULL AND author_entity_id <> '';

CREATE INDEX IF NOT EXISTS idx_bph_works_author_viaf_id
  ON bph_works (author_viaf_id)
  WHERE author_viaf_id IS NOT NULL AND author_viaf_id <> '';

CREATE INDEX IF NOT EXISTS idx_bph_works_author_wikidata_qid
  ON bph_works (author_wikidata_qid)
  WHERE author_wikidata_qid IS NOT NULL AND author_wikidata_qid <> '';

COMMENT ON COLUMN bph_works.author_entity_id IS
  'FK to the entities collection (entity._id as string). Empty string = explicitly unlinked, NULL = not yet checked. Set by the catalogue editor (#1921 P3).';
COMMENT ON COLUMN bph_works.author_canonical_name IS
  'Denormalised canonical author name from VIAF (e.g. "Boccalini, Traiano"). Saves a join on read.';
COMMENT ON COLUMN bph_works.author_wikidata_qid IS
  'Wikidata Q-id corresponding to the VIAF cluster, when VIAF aggregates the cross-link.';
COMMENT ON COLUMN bph_works.author_viaf_id IS
  'Denormalised VIAF cluster id for direct viaf.org linking. NULL when canonical was set only via Wikidata.';
