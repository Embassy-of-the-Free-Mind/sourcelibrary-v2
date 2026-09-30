-- #5099 step 1 of 3: a SHADOW column for the transformers v4 re-embed of clip_embeddings.
--
-- @huggingface/transformers 4.3.0 gives different CLIP vectors than the
-- @xenova/transformers 2.17 server that wrote every row here (median cosine
-- 0.993, same model file, same image bytes). A v4 query against v2 rows changes
-- the top hit on half of text->image queries, so the runtime cannot be switched
-- until every row has a v4 vector. The v4 vectors are written HERE, beside the
-- live `embedding` column, which nothing in this step touches.
--
--   embedding_v4      the v4 vector (scripts/maintenance/clip-v4-shadow-reembed.mjs)
--   embedding_v4_url  the image_url it was embedded from. A row whose image_url
--                     changes afterwards (e.g. --fix-gallery-crops) is stale and
--                     is re-embedded; the worker compares the two.
--   embedding_v4_at   when
--
-- Additive and nullable: ADD COLUMN without a default is a catalog-only change.
-- No index here — an ivfflat index trains its lists on the data present at build
-- time, so it is built on the FILLED column in the cutover step.
--
-- Next: clip-embeddings-v4-cutover.sql (after scripts/audit/clip-v4-shadow-verify.mjs passes).
-- Undo: ALTER TABLE clip_embeddings DROP COLUMN embedding_v4, DROP COLUMN embedding_v4_url, DROP COLUMN embedding_v4_at;

ALTER TABLE clip_embeddings
  ADD COLUMN IF NOT EXISTS embedding_v4 vector(512),
  ADD COLUMN IF NOT EXISTS embedding_v4_url TEXT,
  ADD COLUMN IF NOT EXISTS embedding_v4_at TIMESTAMPTZ;
