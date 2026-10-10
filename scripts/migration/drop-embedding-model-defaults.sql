-- The model label is the WRITER's assertion, never a column default (#6175).
--
-- add-embedding-model-columns.sql (#2124, 2026-06-06) added
--   embedding_model TEXT NOT NULL DEFAULT 'gemini-embedding-2-preview'
-- and the DEFAULT stamped every existing row — including the page_translations rows that
-- embed-translations.mjs had filled with multilingual-e5-base vectors between 2026-03-31 and
-- 2026-04-14 and that no Gemini pass ever replaced. Those rows have read "gemini" since, and
-- semantic search (Gemini query vectors) cannot reach them. A default can only ever guess.
--
-- After this, an INSERT that does not name its model fails (NOT NULL), which is the point.
-- Every writer of these four tables names it as of the #6175 PR:
--   page_translations      scripts/lib/page-embedding-text.mjs buildPageEmbeddingRow (embed-gemini, enrich Phase 6)
--   book_embeddings        enrich-worker upsertBookEmbedding, scripts/migration/backfill-book-embeddings.mjs
--   artwork_embeddings     scripts/migration/backfill-artwork-embeddings.mjs
--   gallery_text_embeddings scripts/migration/backfill-gallery-text-embeddings.mjs
-- page_texts and site_pages never had a default. clip_embeddings keeps its default for now: its
-- writers stamp the runtime label (clip-server.mjs), but that is the #5099 cutover's to change.
--
-- APPLY ONLY AFTER the PR's code is live on Hetzner (git pull on the box) — an old writer that
-- omits the column would start failing its inserts.
--   psql "$SUPABASE_DB_URL" -f scripts/migration/drop-embedding-model-defaults.sql
-- Undo: ALTER TABLE <t> ALTER COLUMN embedding_model SET DEFAULT 'gemini-embedding-2-preview';

ALTER TABLE page_translations       ALTER COLUMN embedding_model DROP DEFAULT;
ALTER TABLE book_embeddings         ALTER COLUMN embedding_model DROP DEFAULT;
ALTER TABLE artwork_embeddings      ALTER COLUMN embedding_model DROP DEFAULT;
ALTER TABLE gallery_text_embeddings ALTER COLUMN embedding_model DROP DEFAULT;
