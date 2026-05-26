# Embeddings

Source Library has **five embedding stores** in Supabase, indexing different things at different granularities. All live in the `secondrenaissance` project (ID `ykhxaecbbxaaqlujuzde`). No embeddings live in Mongo Atlas — Atlas holds the source of truth for content; Supabase holds derived vectors.

## The five stores

| Table | Dim | Model | Granularity | Filled by | Read via RPC | Used at |
|---|---|---|---|---|---|---|
| `page_translations` | 768 (vector) | `gemini-embedding-2-preview` | One row per translated page | `scripts/workers/embed-gemini.mjs` (Hetzner cron) | `match_semantic`, `match_pages_in_books` | `src/lib/semantic-search.ts` global + scoped page search |
| `book_embeddings` | 768 (vector) | `gemini-embedding-2-preview` | One row per book (title + author + summary + entities) | `enrich-worker` Phase 6.5 (inline) | `match_books_semantic` | `src/lib/semantic-search.ts` book-level retrieval |
| `artwork_embeddings` | **3072 (halfvec)** | `gemini-embedding-2-preview` | One row per artwork (title + author + summary + subjects + figures + symbols) | `scripts/migration/backfill-artwork-embeddings.mjs` + `scripts/workers/image-embeddings-cron.mjs` | `match_artworks_semantic` | `src/lib/semantic-search.ts` artwork retrieval |
| `gallery_text_embeddings` | 768 (vector) | `gemini-embedding-2-preview` | One row per gallery image (museum description text) | `scripts/workers/image-embeddings-cron.mjs` | `match_gallery_text` | `src/lib/embeddings.ts`, `src/app/api/gallery/{route,similar/route}.ts` |
| `clip_embeddings` | 512 (vector) | CLIP visual | One row per image (artwork covers, gallery extractions) | `scripts/backfill-clip-embeddings.mjs` + `scripts/workers/image-embeddings-cron.mjs` | `match_gallery_text` (CLIP text→image) | gallery similar-image queries |

Approximate current row counts (May 2026): pages ~3.9M, books 33,828, artworks 19,731, gallery_text 116,641, clip 151,957.

## Why three different dimensions

- **768 (`vector`)** is the Gemini `gemini-embedding-2-preview` default and fits well inside `pgvector`'s `vector_cosine_ops` HNSW operator class (cap: 2000 dims). Used for the three text stores that index short-to-medium passages: pages, book summaries, gallery captions.
- **3072 (`halfvec`)** is the same Gemini model's max-quality output. Artwork descriptions are longer and need the extra capacity. 3072 is above the 2000-dim HNSW cap for `vector_cosine_ops`, so the column type is `halfvec` (fp16) and the index uses `halfvec_cosine_ops` — see `lesson_pgvector_hnsw_dim_cap.md` for the gotcha. The 7th-decimal-place precision loss is negligible for retrieval.
- **512 (`vector`)** is CLIP's native output dim. Visual model, completely independent from the Gemini text embeddings.

## Who writes what, when

- `embed-gemini.mjs` is the page-level workhorse. Embeds OCR + translation per page. Runs as a Hetzner cron (see `.claude/docs/hetzner-scheduler-crontab.md`); modes: `--full`, `--incremental` (default), `--missing-only`, `--book ID`. Cost: free tier on `gemini-embedding-2-preview`, ~13 texts/sec sustained.
- `enrich-worker` Phase 6.5 writes `book_embeddings` inline as books finish enrichment. **Not in `image-embeddings-cron.mjs`** — see the file header comment + issue #2021 for why.
- `image-embeddings-cron.mjs` is the nightly catch-up for the three image-side tables that don't have an inline writer: `artwork_embeddings`, `gallery_text_embeddings`, `clip_embeddings`. Each underlying backfill is idempotent (loads already-embedded IDs, embeds the diff). The cron re-exports `GEMINI_API_KEY=$GEMINI_API_KEY_TIER3` so Gemini text runs on paid Tier 3 quota.

## Who reads them

All retrieval flows through `src/lib/semantic-search.ts` (text) or `src/lib/embeddings.ts` (gallery). The RPC names map 1:1 to the table they query — `match_books_semantic` reads `book_embeddings`, etc. Callers:

- **Global page search:** `/api/search` (and the MCP server's `search_within_book` / `search_concept`) → `match_semantic`.
- **In-book page search:** `match_pages_in_books` scans pages for a given book_id set — faster than the global RPC when you already know the books.
- **Book-level retrieval:** `match_books_semantic` for "find me books similar to this concept."
- **Artwork retrieval:** `match_artworks_semantic` for the artwork browse / search experience.
- **Gallery similar-image:** `/api/gallery/similar` → `match_gallery_text` (CLIP text→image alignment + Gemini text-on-description).

## Maintenance

### Stale rows
Embeddings are kept for hidden books on purpose — visibility toggles and re-embedding is expensive. They are NOT kept for books that have been deleted from Mongo entirely; those are pure orphans.

Run `scripts/maintenance/delete-stale-embeddings.mjs` periodically. It cross-references each table's `book_id` against the full Mongo `books` collection (visible + hidden + everything) and deletes only the rows with no matching book at all. Default is dry-run; `--apply` writes.

Baseline at 2026-05-26 (after first cleanup pass): 338 truly orphaned rows total across `book_embeddings`, `artwork_embeddings`, and `clip_embeddings`. `gallery_text_embeddings` was already clean. The numbers should stay small as long as the script runs occasionally; deletions in Mongo are rare (CRITICAL data protection rules forbid bulk deletes).

`page_translations` (~3.9M rows) is too big for REST paging — the script prints a SQL one-liner to run in the Supabase editor when needed. The DELETE there uses `WHERE NOT EXISTS (SELECT 1 FROM book_embeddings …)` as a proxy for "book still exists" — works because `book_embeddings` has one row per book and the cleanup runs on it first.

### Re-embedding
- Page-level: `node scripts/workers/embed-gemini.mjs --book <id>` re-embeds a specific book.
- Book-level: enrich-worker Phase 6.5 handles it during enrichment. To force, re-run enrichment for the book.
- Artwork / gallery / clip: idempotent backfill scripts in `scripts/migration/` — delete the row(s) and re-run the cron.

### Index health
The HNSW index has to be present and the planner has to choose it — `CREATE INDEX` succeeds silently even when it produces an unusable index above the dim cap. Always `EXPLAIN ANALYZE` a real `match_*` query after touching a vector column or index. See `lesson_pgvector_hnsw_dim_cap.md` and `lesson_silent_probe_failures.md`.

### Cost
Page-level embedding cost was zero for the full backfill (free tier). Incremental runs are negligible. The artwork / gallery / CLIP cron runs on paid Tier 3 because it batches across many tables and would otherwise risk hitting free-tier quota at burst times.
