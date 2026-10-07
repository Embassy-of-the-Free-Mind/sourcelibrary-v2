-- #5099 rollback: undo clip-embeddings-v4-cutover.sql. Put the v2 vectors back
-- under the name the RPCs read, and switch the server back IN THE SAME MINUTE:
--   printf '[Service]\nEnvironment=CLIP_RUNTIME=v2\n' > /etc/systemd/system/sl-clip-server.service.d/runtime.conf
--   systemctl daemon-reload && systemctl restart sl-clip-server
--
-- Rows first inserted after the cutover have no v2 vector, so after this they
-- have embedding NULL and drop out of visual search. The nightly backfill skips
-- ids that already exist, so it will not refill them; list them with
--   SELECT id FROM clip_embeddings WHERE embedding IS NULL
-- and decide. Nothing here deletes a row.
-- Only possible while the v2 runtime is still installed (before the retire step).

BEGIN;
LOCK TABLE clip_embeddings IN ACCESS EXCLUSIVE MODE;
ALTER TABLE clip_embeddings RENAME COLUMN embedding TO embedding_v4;
ALTER TABLE clip_embeddings RENAME COLUMN embedding_v2 TO embedding;
ALTER INDEX clip_embeddings_embedding_idx RENAME TO clip_embeddings_embedding_v4_idx;
ALTER INDEX clip_embeddings_embedding_v2_idx RENAME TO clip_embeddings_embedding_idx;
COMMIT;

UPDATE clip_embeddings SET embedding_model = 'Xenova/clip-vit-base-patch32'
 WHERE embedding_model <> 'Xenova/clip-vit-base-patch32' AND embedding IS NOT NULL;
