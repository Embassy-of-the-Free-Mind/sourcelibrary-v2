-- translation_catalogs.source_url (#2564, Sink C)
--
-- The grounded FT enumeration captures a link to where each prior English
-- translation actually lives (archive.org / publisher / WorldCat). The Sink C
-- harvester (scripts/enrichment/harvest-ft-into-translation-catalogs.mjs,
-- --from-enum) writes it into this column. Without the column, `--apply`
-- inserts 400 on every row.
--
-- Applied to the live `secondrenaissance` project on 2026-06-21 via the Supabase
-- Management API; committed here so the schema change is reproducible and tracked
-- alongside the other migrations. Idempotent.

ALTER TABLE public.translation_catalogs
  ADD COLUMN IF NOT EXISTS source_url text;
