-- #5099 step 3 of 3: make the v4 vectors the live ones. Reversible: clip-embeddings-v4-rollback.sql.
--
-- Run ONLY after scripts/audit/clip-v4-shadow-verify.mjs exits 0 and
-- scripts/eval/clip-index-recall.mjs --column=embedding_v4 is no worse than the
-- live column on the bench targets. Then, within the same minute, switch the
-- CLIP server to v4 (the query side must move with the stored side — a v4 query
-- against v2 rows is the "mixed" state #5099 measured as the worst one):
--   printf '[Service]\nEnvironment=CLIP_RUNTIME=v4\n' > /etc/systemd/system/sl-clip-server.service.d/runtime.conf
--   systemctl daemon-reload && systemctl restart sl-clip-server
--
-- Nothing is deleted. The v2 vectors stay in `embedding_v2` (with their index),
-- so rollback is two renames. The functions match_clip_images/match_clip_text are
-- plpgsql (body re-parsed per session), so they follow the NAME `embedding` —
-- checked 2026-09-30: neither is a BEGIN ATOMIC body, which would bind to the
-- old column instead.

-- A. Outside any transaction, before the swap (minutes; the table stays readable).
--    Same index type and lists as the live one, so the only change is the vectors.
--    ivfflat trains its lists on the rows present at build time: build it on the
--    FILLED column, never earlier.
SET maintenance_work_mem = '512MB';
CREATE INDEX CONCURRENTLY IF NOT EXISTS clip_embeddings_embedding_v4_idx
  ON clip_embeddings USING ivfflat (embedding_v4 vector_cosine_ops) WITH (lists = 32);

-- B. The swap: one short transaction.
BEGIN;
LOCK TABLE clip_embeddings IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE stale int; missing int; total int;
BEGIN
  SELECT count(*) FILTER (WHERE embedding_v4 IS NOT NULL AND embedding_v4_url IS DISTINCT FROM image_url),
         count(*) FILTER (WHERE embedding_v4 IS NULL),
         count(*)
    INTO stale, missing, total FROM clip_embeddings;
  IF stale > 0 THEN RAISE EXCEPTION 'cutover refused: % rows have a v4 vector of an older image_url — rerun the shadow worker', stale; END IF;
  -- Rows the v4 server could not fetch (dead source URL) go live with NO vector:
  -- they drop out of visual search instead of sitting in the wrong space. Their
  -- v2 vector stays in embedding_v2. More than 0.5% means something else is wrong.
  IF missing > total * 0.005 THEN RAISE EXCEPTION 'cutover refused: % of % rows have no v4 vector', missing, total; END IF;
  RAISE NOTICE 'cutover: % rows, % without a v4 vector', total, missing;
END $$;

ALTER TABLE clip_embeddings RENAME COLUMN embedding TO embedding_v2;
ALTER TABLE clip_embeddings ALTER COLUMN embedding_v2 DROP NOT NULL;
ALTER TABLE clip_embeddings RENAME COLUMN embedding_v4 TO embedding;
ALTER INDEX clip_embeddings_embedding_idx RENAME TO clip_embeddings_embedding_v2_idx;
ALTER INDEX clip_embeddings_embedding_v4_idx RENAME TO clip_embeddings_embedding_idx;
COMMIT;

-- C. After the server restart, outside the lock: stamp the rows with their space.
--    (Batched by id prefix so no statement holds many row locks for long.)
-- UPDATE clip_embeddings SET embedding_model = 'Xenova/clip-vit-base-patch32@transformers-4.3.0-q8'
--  WHERE embedding IS NOT NULL AND embedding_model = 'Xenova/clip-vit-base-patch32' AND id LIKE 'artwork-%';
--  ... 'cover-%', 'gallery-%'
