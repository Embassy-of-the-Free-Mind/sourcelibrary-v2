# Embeddings

Source Library has **six embedding stores** in Supabase, indexing different things at different granularities. All live in the `secondrenaissance` project (ID `ykhxaecbbxaaqlujuzde`). No embeddings live in Mongo Atlas — Atlas holds the source of truth for content; Supabase holds derived vectors.

## The five stores

| Table | Dim | Model | Granularity | Filled by | Read via RPC | Used at |
|---|---|---|---|---|---|---|
| `page_translations` | 768 (vector) | `gemini-embedding-2-preview` | One row per translated page | **`enrich-worker` Phase 6 (inline)** + `scripts/workers/embed-gemini.mjs` (Hetzner cron, bulk) | `match_semantic`, `match_pages_in_books` | `src/lib/semantic-search.ts` global + scoped page search |
| `book_embeddings` | 768 (vector) | `gemini-embedding-2-preview` | One row per book (title + author + summary + entities) | `enrich-worker` Phase 6.5 (inline) | `match_books_semantic` | `src/lib/semantic-search.ts` book-level retrieval |
| `artwork_embeddings` | **3072 (halfvec)** | `gemini-embedding-2-preview` | One row per artwork (title + author + summary + subjects + figures + symbols) | `scripts/migration/backfill-artwork-embeddings.mjs` + `scripts/workers/image-embeddings-cron.mjs` | `match_artworks_semantic` | `src/lib/semantic-search.ts` artwork retrieval |
| `gallery_text_embeddings` | 768 (vector) | `gemini-embedding-2-preview` | One row per gallery image (museum description text) | `scripts/workers/image-embeddings-cron.mjs` | `match_gallery_text` | `src/lib/embeddings.ts`, `src/app/api/gallery/{route,similar/route}.ts` |
| `clip_embeddings` | 512 (vector) | CLIP visual | One row per image (artwork covers, gallery extractions) | `scripts/backfill-clip-embeddings.mjs` + `scripts/workers/image-embeddings-cron.mjs` | `match_gallery_text` (CLIP text→image) | gallery similar-image queries |
| `page_texts` | 768 (vector) | `gemini-embedding-2-preview` | One row per translated page **per language** (`page_id, lang`) | `scripts/workers/embed-page-texts.mjs --lang=<iso>` (bulk) + `es-translate-worker.mjs` (inline) | `match_page_texts`, `match_page_texts_in_books`, `search_page_texts` (lexical) | Spanish/localized page search: `/api/search?lang=es`, `/api/books/:id/search?lang=es` |

Approximate current row counts (May 2026): pages ~3.9M, books 33,828, artworks 19,731, gallery_text 116,641, clip 151,957.

## `page_texts` — the language-keyed store (#4095)

`page_translations` holds ONE translation per page, and that translation is
English. Every other language lives in `page_texts`, keyed `(page_id, lang)` —
the vector-layer form of the rule in `.claude/docs/i18n.md`: **one
language-keyed shape per layer, never per-language columns or tables.** The next
language is a key, not a feature.

- **Why a sibling table and not a `lang` column on `page_translations`.** That
  table is 4.5M rows behind four read paths (`match_semantic`,
  `match_pages_in_books`, the librarian, `/api/search`). Widening its primary
  key means migrating all of it and rebuilding an HNSW index those paths depend
  on, to gain 38K Spanish rows. The sibling costs the English path nothing; the
  English rows can move in later as a separately-verified step.
- **The vector index is PARTIAL, one per language** (`page_texts_embedding_es_idx`).
  HNSW returns the globally nearest N and filters afterwards, so a shared index
  plus `WHERE lang = 'es'` would strip results to zero whenever the true
  neighbours are in another language — the same cross-lingual bug fixed in
  `match_semantic` in May 2026. A partial index makes it structurally
  impossible. **Adding a language means running
  `scripts/migration/add-page-texts-table.mjs --lang=<iso>` again**; until you
  do, that language is searched by sequential scan (correct, just slower).
- **There is a lexical lane too**, which the English store does not have here:
  a `tsv` column, a GIN index, and `search_page_texts`. English keyword search
  is Atlas (`pages_search`, mapping `translation.data`/`ocr.data`,
  `dynamic: false`); reaching `translations.es.data` would mean rebuilding that
  index over 18.9M pages on shared search capacity for 38K rows. Postgres full
  text over the copy we already hold is free and gives real per-language
  stemming, which `lucene.standard` does not. Which stemmer a language gets is
  decided once, in the SQL function `page_text_config`, called by BOTH the
  write-side trigger and the read-side RPC — so index and query cannot disagree.
- **No OCR fallback.** `pageEmbeddingInput` falls back to the original text so
  an untranslated page still gets a vector. `pageTextForLang` does NOT: a row in
  `lang = 'es'` is a promise that the text IS Spanish, and falling back would
  put Latin into the Spanish lane, where it would be retrieved for Spanish
  queries and quoted as the Spanish edition.
- **Staleness is checked on every run, not behind a flag.** The Spanish
  audit→repair loop (`scripts/audit/es-edition-quality.mjs` → the worker's
  `--strict --pages=@report` mode) REWRITES pages, and the row carries the
  snippet that gets quoted as well as the vector — so a stale row serves text
  that is no longer in the book.
- **Coverage:** `scripts/audit/page-texts-coverage.mjs --lang=es` compares the
  counter, the readable pages and the embedded rows, and reports the writer's
  age rather than only the row count (`measurement-instruments.md`).

The row shape and the upsert live with the English ones in
`scripts/lib/page-embedding-text.mjs`; the per-book writer is
`scripts/lib/embed-book-page-texts.mjs`. Four writers, one composer — for the
reason that module exists.

## Why three different dimensions

- **768 (`vector`)** is the Gemini `gemini-embedding-2-preview` default and fits well inside `pgvector`'s `vector_cosine_ops` HNSW operator class (cap: 2000 dims). Used for the three text stores that index short-to-medium passages: pages, book summaries, gallery captions.
- **3072 (`halfvec`)** is the same Gemini model's max-quality output. Artwork descriptions are longer and need the extra capacity. 3072 is above the 2000-dim HNSW cap for `vector_cosine_ops`, so the column type is `halfvec` (fp16) and the index uses `halfvec_cosine_ops` — see `lesson_pgvector_hnsw_dim_cap.md` for the gotcha. The 7th-decimal-place precision loss is negligible for retrieval.
- **512 (`vector`)** is CLIP's native output dim. Visual model, completely independent from the Gemini text embeddings.

## Who writes what, when

- **Page vectors have TWO writers since 2026-08-07, and one shared composer.** `enrich-worker` Phase 6 writes them inline (via `scripts/lib/embed-book-pages.mjs`) so a book is searchable by meaning the moment it finishes enrichment; `embed-gemini.mjs` remains the bulk tool. Both compose text and rows through **`scripts/lib/page-embedding-text.mjs`** — import it, never re-type it, for the same reason as the book-level composer below.
  - **Why the pipeline gained a writer.** The cron was the SOLE writer until it was found commented out behind a `#PAUSED-GEMINI` marker, log empty and dated June 9 — two months dark. Measured: 2,462 live books with zero page vectors, 4,420 more under 90%; semantic search blind on ~45% of the corpus with nothing alerting, because an unembedded book and a book with no match return the same empty list. A step outside the pipeline can be switched off without anything downstream noticing.
  - **`updated_at` on this table is NOT a write timestamp.** It mirrors the Mongo source's `updated_at` (see `mongo_updated_at`, which `--restale` compares for drift). A freshness monitor that reads it will report the table as months stale while it is being written to right now — verified 2026-08-07, mid-backfill, when it read "42d ago". Check row counts over time, or the log, not this column.
- `embed-gemini.mjs` is the page-level bulk workhorse. Embeds OCR + translation per page. Runs as a Hetzner cron (see `.claude/docs/hetzner-scheduler-crontab.md`); modes: `--full`, `--incremental` (default), `--missing-only`, `--book ID`, `--books-file PATH`. Cost: free tier on `gemini-embedding-2-preview`, ~13 texts/sec sustained per process; `--worker-id`/`--worker-count` shard across processes. **`--missing-only` cannot reach a book with ZERO rows** (it only scans books already present) — that is what `--books-file` is for.
- `enrich-worker` Phase 6.5 writes `book_embeddings` inline as books finish enrichment. **Not in `image-embeddings-cron.mjs`** — see the file header comment + issue #2021 for why.
  - **The embedded text has ONE composer: `scripts/lib/book-embedding-text.mjs`.** It used to be copy-pasted into the worker, the backfill migration, and a search eval spike, and all three copies carried the same two field-name bugs: they read `.name` on people/places/concepts (the index extractor emits `.term`) and keyed topic terms on `entries`, a legacy shape present on ~1k of 18k `book_indexes` docs. Measured on live Supabase before the 2026-07-27 fix: **14,237 rows contained the literal line `People: , , , ,`** and only 1,019 of 36,078 had a `Topics:` line at all — book-level semantic search was matching on title, author, summary and section headings alone, discarding every entity and term the extraction had produced. Import the composer; never re-type it. The failure mode is silent (a wrong field name yields well-formed text that says nothing), so it is pinned by `tests/unit/book-embedding-text.test.ts`.
  - A projection that omits a source field empties its line just as quietly — use `BOOK_INDEX_EMBEDDING_PROJECTION` from the same module rather than hand-listing fields.
  - **Composer changes only take effect on re-embed.** Existing rows keep whatever text was current when they were written; fixing the code does not repair the corpus. Re-run `scripts/migration/backfill-book-embeddings.mjs` (`--incremental` skips rows that already exist, so a full re-embed needs a targeted run).
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

`page_translations` (~3.9M rows) is **not cleaned** by the maintenance script. The table holds the actual translation text (column `translation`, Gemini Batch output) — deleting from it destroys readable content, unlike the embedding-only tables above. The script prints a COUNT query for visibility but no DELETE. If orphans there ever need cleaning, treat it as a deliberate one-off: derive the live set from `bookstore.books` (NOT `book_embeddings`, which only covers embedded books), cross-check `bookstore.deleted_books`, sample-inspect, archive before DELETE.

### Re-embedding
- Page-level: `node scripts/workers/embed-gemini.mjs --book <id>` re-embeds a specific book.
- Book-level: enrich-worker Phase 6.5 handles it during enrichment. To force, re-run enrichment for the book.
- Artwork / gallery / clip: idempotent backfill scripts in `scripts/migration/` — delete the row(s) and re-run the cron.

### Index health
The HNSW index has to be present and the planner has to choose it — `CREATE INDEX` succeeds silently even when it produces an unusable index above the dim cap. Always `EXPLAIN ANALYZE` a real `match_*` query after touching a vector column or index. See `lesson_pgvector_hnsw_dim_cap.md` and `lesson_silent_probe_failures.md`.

### Cost
Page-level embedding cost was zero for the full backfill (free tier). Incremental runs are negligible. The artwork / gallery / CLIP cron runs on paid Tier 3 because it batches across many tables and would otherwise risk hitting free-tier quota at burst times.
