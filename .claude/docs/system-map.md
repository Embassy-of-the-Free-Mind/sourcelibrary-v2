# Source Library System Map

> Last audited: 2026-04-24; spot-refreshed 2026-07-03 (model names, concurrency, file counts). Use this as the primary navigation reference.

## Architecture Overview

```
Users ──> Vercel (Next.js 16) ──> MongoDB Atlas (bookstore)
                │                        ▲
                ├──> Supabase Postgres   │ write-processor
                │    (analytics, browse, catalog, search)
                │                        │
                ├──> Cloudflare R2       │
                │    (images.sourcelibrary.org)  │
                │                        │
                ├──> SQS Queues ──> Lambda Workers ──> Gemini AI
                │    (eu-central-1)   (OCR, Translation, Images)
                │
                ├──> Hetzner (46.224.122.120)
                │    (pipeline orchestration, translate-worker, embedding server)
                │
                ├──> Stripe (Ficino Society payments)
                ├──> Twitter/X API (@SourceLibrary_)
                ├──> Zenodo (DOI minting)
                ├──> Museum APIs (Met, Cleveland, Rijksmuseum, AIC)
                └──> IIIF Sources (IA, Gallica, Wellcome, etc.)
```

## Infrastructure Map

| Service | Purpose | Key Config |
|---------|---------|------------|
| **Vercel** | Next.js hosting, 7 crons | Project: `sourcelibrary-v2` |
| **MongoDB Atlas** | Primary database | DB: `bookstore`, ~17K live + ~24.5K warehouse books |
| **Supabase Postgres** | Analytics, browse cache, catalog, search | pgvector, pg_trgm, pg_cron |
| **AWS Lambda** (eu-central-1) | AI processing workers | 4 functions, SQS-triggered |
| **AWS SQS** (eu-central-1) | Job queues (FIFO) | 4 queues: OCR, translation, images, write |
| **Cloudflare R2** | Image/page storage | `images.sourcelibrary.org` |
| **Hetzner** (cax31) | Pipeline orchestration, translation, embeddings | `root@46.224.122.120`, unified scheduler |
| **Gemini AI** | OCR, translation, enrichment | 3 unique keys (3 GCP projects). BPH: `gemini-3-flash-preview`, others: `gemini-3.1-flash-lite` |
| **Stripe** | Payments | Ficino Society membership |
| **Zenodo** | DOI publishing | Scholarly editions |
| **Twitter/X** | Social automation | 3h posting cron |

## Data Pipeline Flow

The pipeline has **13+ phases** managed by `pipeline-orchestrator.mjs` (every 2 min) and `enrich-worker.mjs` (every 5 min) on Hetzner. Books flow through `pipeline_auto.status` states:

```
Import (IA/Gallica/IIIF/Wellcome/etc.)
  └─> Phase 0: Auto-enroll ──> queued
       └─> Phase 1: Archive (download images to R2) ──> archiving ──> archive_complete
            └─> Phase 1.25: Split detection (spread scans → individual pages)
            └─> Phase 1.5: Preview OCR (first 25 pages via Lambda, fast turnaround)
            └─> Phase 1.7: Preview translation (inline via Vercel)
       └─> Phase 2: Batch OCR (Gemini Batch API, 3.1-flash-lite) ──> ocr_submitted
            └─> Phase 3: OCR completion check ──> ocr_complete
       └─> Phase 3.5: Metadata enrichment (catalog lookups, no Gemini) ──> metadata_enriched
       └─> Phase 3.7: Transliteration (non-Latin scripts, 3.1-flash-lite)
       └─> Phase 4: Translation dispatch (creates job for translate-worker)
            │  translate-worker.mjs (40 concurrent books) ──> Gemini realtime ──> MongoDB pages
            │  ⚠ Realtime API only. NEVER use Batch API for translation.
            └─> Phase 5: Translation completion ──> translate_complete

  enrich-worker.mjs (every 5 min):
       └─> Phase 6: Summary + Index (3.1-flash-lite) ──> summary_indexed
       └─> Phase 7: Chapter extraction (3.1-flash-lite) ──> chapters_complete
       └─> Phase 7.5: Quality scoring (3.1-flash-lite, 0-100 score)
       └─> Phase 7.6: Collection assignment (3.1-flash-lite, additive)

  pipeline-orchestrator.mjs (continued):
       └─> Phase 8: Image extraction (Lambda) ──> images_submitted ──> images_complete
       └─> Phase 8.5: Staleness detection (>48h stuck → retry or flag)
       └─> Phase 8.9: Cover selection + page cleanup ──> cover_selected
       └─> Phase 9: Finalize (validate OCR >10%, auto-unhide) ──> complete

  batch-collector.mjs (every 10 min):
       Polls Gemini Batch API, saves OCR results, zombie reaper (>6h), ghost cleanup
```

Concurrency limits managed by `system_config.adaptive_limits` (auto-halved when Atlas degrades). Backpressure: `system_config.paused_phases` array.

## Supabase Layer (added 2026-03-27+)

Supabase serves derived reads for performance-critical paths. MongoDB remains source of truth.

| Table/View | Purpose | Source |
|------------|---------|--------|
| `books_catalog` | Browse cache (11s→0.6s) | Synced from MongoDB `books` |
| `page_translations` | Semantic search embeddings | pgvector, Gemini embedding-2-preview (768d/3072d) |
| `gemini_usage` | AI cost analytics | Synced from MongoDB |
| `pipeline_snapshots` | Pipeline velocity charts | Synced from MongoDB |
| `cron_runs` | Cron execution logs | Synced from MongoDB |
| `ustc_editions` / `ustc_enrichments` | USTC catalog | Direct import |
| `contributing_library` | Library pages (was 5s timeout) | Materialized view |

Key: `src/lib/supabase.ts` (client), `.claude/docs/supabase.md` (full reference — see **Sync Points (Complete Map)** for every Mongo→Supabase write path and **Known Sync Gaps** for documented edge cases like the PATCH-bypass)

## Author Pages (added 2026-03-30+)

Entity-driven author system with normalized names, Wikipedia enrichment, aliases.

| Route | Purpose |
|-------|---------|
| `/author/[name]` | Author detail — catalog table, title page gallery, publisher column |
| `/browse/authors` | Author listing/browse |
| `/api/admin/revalidate-authors` | ISR revalidation endpoint |

Key: `src/app/author/`, `src/app/browse/authors/`, author normalization in `src/lib/`

## Visual Art Wing (added 2026-03-30+)

Museum artwork imports alongside historical texts. ~18K artworks. Mixed collections show both.

| Source | Script | Status |
|--------|--------|--------|
| Met Museum | `scripts/import-met-artworks.mjs` | Active |
| Cleveland Museum | `scripts/import-cleveland-artworks.mjs` | Active |
| Wikimedia Commons | `scripts/import-commons-artworks.mjs` | Active (NOT `import-artwork.mjs`) |
| Rijksmuseum, AIC | Various | Active |

Routes: `/artwork/[slug]`, `/artist/[name]`, `/api/artwork/`. Collections support `collection_type` field. Gemini Vision cataloging, CLIP embeddings (3072d), semantic search.

## MongoDB Collections (73)

### Core Data
| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `books` | Book metadata (~17K live) | `id`, `title`, `author`, `slug`, `pages_count`, `pages_ocr`, `pages_translated` |
| `books_warehouse` | Archived books (~24.5K) | Same schema, moved for Atlas perf |
| `pages` | Individual pages (~3.1M live) | `book_id`, `ocr.data`, `translation.data`, `detected_images`, `page_type` |
| `pages_warehouse` | Archived pages (~6.4M) | Same schema |
| `deleted_books` | Soft-deleted books | Same as books, recoverable |
| `collections` | Book groupings | `slug`, `name`, `hidden`, `collection_type` |
| `entities` | Legacy per-string author/encyclopedia layer (people, places, concepts). **Being retired for authorship** — superseded by `authors`. | linked via `books.author_entity_id` |
| `authors` | **Canonical person thesaurus** — one doc per person, `_id`=slug. Books FK via `books.author_id`. | variants, variant_slugs, viaf_id, wikidata_id, entity_ids · see `.claude/docs/author-identity-system.md` |
| `translation_catalogs` | **Prior-translation registry** — known English translations the first-translation verifier checks first. ~24k rows (UNESCO Index Translationum, Loeb, Brill, Penguin…). Drives `is_first_translation`. | source, author, english_title, translator, pub_year, completeness · see `.claude/docs/first-translation-system.md` |

### Processing
| Collection | Purpose |
|------------|---------|
| `jobs` | Processing job queue |
| `batch_jobs` | Batch OCR/translation jobs |
| `page_revisions` | OCR/translation history (MUST create before writes) |
| `gemini_usage` | AI cost tracking (single source of truth) |
| `system_config` | Global settings (`processing_control` with `paused` flag) |

### User & Social
| Collection | Purpose |
|------------|---------|
| `users` | NextAuth accounts |
| `admin_users` | Admin whitelist |
| `likes`, `highlights`, `reading_history` | User engagement |
| `discussions`, `discussion_replies` | Ficino Society forum |
| `social_posts`, `social_config` | Twitter automation |
| `purchases` | Stripe payments |

### Gallery & Media
| Collection | Purpose |
|------------|---------|
| `gallery_images` | Extracted page images |
| `gallery_collections` | Curated image sets |
| `gallery_embeddings` | Image similarity vectors |
| `detected_images` | Gemini image detection results |

### Analytics & Monitoring
| Collection | Purpose |
|------------|---------|
| `analytics_events`, `analytics_pageviews` | User behavior (migrating to Supabase) |
| `pipeline_snapshots`, `pipeline_health_daily` | Pipeline metrics (mirrored to Supabase) |
| `cron_runs` | Cron execution logs (mirrored to Supabase) |
| `audit_log` | Admin action trail (prunable telemetry — in prune-telemetry.mjs scope) |
| `book_events` | PERMANENT per-book history (e.g. `image_resolution_upgrade` with OCR-input provenance, #3191/#3186) — never prune. Books flagged for re-OCR carry `books.reocr_candidate` |
| `application_errors` | Error logging |

### Research & Experiments
`experiments`, `ocr_experiments`, `ocr_judgments`, `pipeline_experiments`, `pipeline_judgments`, `split_models`, `split_training_examples`, `split_adjustments`

### Other
`external_catalog` (IIIF union catalog), `editions`, `kdp_publications`, `book_metadata_changelog`, `prompts`, `libraries`, `volunteers`, `contributions`, `feedback`, `beta_subscribers`, `email_drafts`, `comparisons`, `entity_aliases`, `translation_catalogs`, `curation_drafts`, `curator_sessions`

## File System Layout

```
src/
├── app/                    # Next.js app router
│   ├── api/                # ~400 API routes (direct DB queries, no repository layer)
│   │   ├── books/[id]/     # 60 book operations
│   │   ├── admin/          # 60 admin endpoints
│   │   ├── import/         # 26 IIIF source importers
│   │   ├── iiif/[id]/      # IIIF we EXPOSE (manifest/canvas/search) → .claude/docs/iiif-api.md
│   │   ├── pages/[id]/     # 15 page operations
│   │   ├── cron/           # 6 active cron routes (7 scheduled in vercel.json)
│   │   ├── search/         # 8 search endpoints (main, unified, visual, semantic, suggest, etc.)
│   │   ├── gallery/        # 8 gallery endpoints
│   │   ├── social/         # 11 social media endpoints
│   │   ├── embassy/        # 9 librarian/chat endpoints
│   │   ├── embed/          # 7 embed endpoints (BPH, Bhutan)
│   │   ├── image/          # Image proxy
│   │   ├── mcp/            # MCP server endpoint (OAuth)
│   │   ├── health/         # Health check (+ auth sub-route)
│   │   ├── artwork/        # Artwork search
│   │   ├── stripe/         # 4 payment endpoints
│   │   ├── dataset/v1/     # Public API (keyed access)
│   │   └── ...             # experiments, analytics, scan, catalog, etc.
│   ├── author/[name]/      # Author detail page (catalog, gallery strip)
│   ├── artist/[name]/      # Artist detail page (artworks)
│   ├── artwork/[slug]/     # Artwork detail page
│   ├── book/[id]/          # Reader pages (guide, summary, QA, pipeline, editions)
│   ├── browse/authors/     # Author listing (+ [letter] sub-route)
│   ├── collections/        # Collection browse & detail (supports mixed art+book)
│   ├── gallery/            # Image gallery
│   ├── librarian/          # Agentic Librarian (room/, thread/, voice/)
│   ├── podcast/            # Podcast player + RSS feed
│   ├── shwep/[number]/     # SHWEP podcast integration
│   ├── search/             # Search UI (+ visual search)
│   ├── embed/              # Institutional embeds (bhutan/, bph/ with catalog sub-routes)
│   ├── work/[id]/          # Work-level linking (WEMI)
│   ├── hieroglyphs/        # Egyptian hieroglyphs page
│   ├── tablets/            # Cuneiform tablets page
│   ├── rithmomachia/       # Mathematical board game (guide, scenarios)
│   ├── admin/              # Admin dashboard pages
│   ├── blog/               # 58 blog posts (hardcoded JSX, no CMS)
│   ├── press-release/      # Press release page
│   ├── research/           # Research tools (atlas, diffusion, timeline)
│   ├── explore/            # Map & timeline visualizations
│   ├── ficino-society/     # Membership, discussions
│   ├── catalog/, census/, encyclopedia/  # Reference browse pages
│   ├── languages/, timeline/, topics/    # Content browse pages
│   ├── about/, support/, terms/, privacy/  # Static info pages
│   └── ...                 # 87 top-level app directories
│
├── components/             # 250 React components (.tsx files)
│   ├── book/               # Book detail, reader, processing
│   ├── layout/             # GlobalHeader, GlobalFooter, FeaturedCollections
│   ├── gallery/            # Gallery views (+ IconclassFilter)
│   ├── reader/             # Page reader, zoom, sidebar
│   ├── search/             # Search results, filters
│   ├── explore/            # Map, timeline
│   ├── ui/                 # Primitives (Button, Dialog, Tabs, etc.)
│   ├── camera/             # Mobile scanning (6 components, likely unused)
│   ├── rithmomachia/       # Game components (14, live feature)
│   └── ...
│
├── lib/                    # ~166 top-level modules + subdirectories
│   ├── mongodb.ts          # DB connection (singleton, pool management)
│   ├── supabase.ts         # Supabase client (analytics, browse, search)
│   ├── ai.ts               # Core Gemini operations
│   ├── gemini-client.ts    # API key rotation (3 keys, 3 GCP projects)
│   ├── gemini-batch.ts     # Batch API orchestration
│   ├── semantic-search.ts  # 7-lane search, embedding-2-preview (768d/3072d)
│   ├── semantic-alignment.ts # Embedding-based quality measurement
│   ├── storage.ts          # R2 + Vercel Blob abstraction
│   ├── sqs-client.ts       # SQS queue client
│   ├── auth.ts             # NextAuth config (Google + Email/Resend magic links)
│   ├── auth-helpers.ts     # withAuth(), withAdminAuth()
│   ├── slugify.ts          # URL slug generation, bookUrl()
│   ├── book-lookup.ts      # Book query helpers
│   ├── book-index.ts       # Reads from book_indexes collection
│   ├── import-utils.ts     # IIIF manifest parsing
│   ├── page-revisions.ts   # createRevision() — MUST call before page writes
│   ├── adaptive-limits.ts  # system_config.adaptive_limits read/write
│   ├── iconclass-categories.ts # Iconclass visual classification
│   ├── page-split/         # Split detection (dedup, ghost pages, ML detection)
│   ├── rithmomachia/       # Game engine (35+ files)
│   ├── taxonomy/           # Faceted vocabulary (6 facets), tagging
│   ├── embassy/            # Librarian chat tools
│   ├── api-client/         # Frontend API wrappers
│   ├── types/              # TypeScript types (ai-models.ts, book.ts, etc.)
│   └── ...
│
├── workers/                # Lambda function source
│   ├── ocr-processor.ts + ocr-processor-logic.ts
│   ├── translation-processor.ts + translation-processor-logic.ts
│   ├── image-extraction-processor.ts + image-extraction-processor-logic.ts
│   └── write-processor.ts + write-processor-logic.ts
│
└── hooks/                  # 8 React hooks

scripts/                    # Operational scripts
├── analysis/               # ~50 inspection/reporting scripts
├── batch/                  # Bulk processing scripts
├── enrichment/             # Metadata enrichment scripts
├── maintenance/            # Data fix scripts
├── import/                 # Bulk import scripts + JSON manifests
├── migration/              # Data migration scripts (~49 files)
├── eval/                   # Quality evaluation scripts
├── experiments/            # One-off experiments
├── aws-lambda/             # Lambda build/deploy
├── workers/                # Hetzner workers (40 files):
│   ├── scheduler.mjs       # Unified cron scheduler
│   ├── pipeline-orchestrator.mjs  # Main pipeline (every 2 min)
│   ├── enrich-worker.mjs   # Enrichment phases (every 5 min)
│   ├── translate-worker.mjs # Realtime translation (40 concurrent)
│   ├── batch-collector.mjs  # Gemini Batch API results (every 10 min)
│   ├── embed-gemini.mjs     # Embedding generation
│   ├── clip-server.mjs      # CLIP visual search server
│   ├── archive-*.mjs        # Source-specific archivers (7 variants)
│   └── sync-*.mjs           # Supabase sync workers
└── lib/                    # Shared script utilities
```

## Pages Breakdown (87 top-level dirs)

| Category | Count | Content Source | Examples |
|----------|-------|---------------|----------|
| Core library (dynamic) | ~50 | MongoDB + APIs | Book reader, search, collections, author, artist, artwork, work, browse |
| Agentic features | ~5 | Gemini + MongoDB | Librarian room, thread, voice; search v2 |
| Content pages | ~8 | MongoDB | Podcast, SHWEP, hieroglyphs, tablets, encyclopedia, languages |
| Institutional embeds | ~6 | MongoDB | embed/bhutan, embed/bph (each with book, catalog, collections) |
| Admin/ops dashboards | ~15 | MongoDB + APIs | Pipeline control, jobs, analytics, email, KDP |
| Research/experiments | ~20 | MongoDB + APIs | OCR quality, concept diffusion, image atlas |
| Blog posts | 39 | Hardcoded JSX (no CMS) | origin-story, progress-studies, hidden-engineers |
| Press | 1 | Hardcoded JSX | press-release |
| Auth/legal/info | ~10 | Static JSX | signin, terms, privacy, about, support |
| Gallery | ~6 | MongoDB + APIs | Browse, collections, image viewer, curation |
| Community | ~5 | MongoDB + APIs | Ficino Society, discussions, contribute |
| Games | ~4 | Client-side | Rithmomachia (guide, scenarios) |

### Pages to audit
- `/testloader` — debug page, should not be public
- `/scan/auto`, `/scan/opencv` — experimental scanning tools
- `/fulldata` — bulk data export, should be admin-only

## Key Architectural Patterns

1. **No repository/service layer** — API routes query MongoDB directly via `getDb().collection()`. No ORM.
2. **API client for frontend** — `src/lib/api-client/` provides typed wrappers around API routes.
3. **SQS-driven async processing** — All AI work goes through SQS → Lambda → Gemini → write-back.
4. **Page revisions before writes** — Any script modifying `ocr.data` or `translation.data` MUST call `createRevision()` first.
5. **Admin via whitelist** — `admin_users` collection, no RBAC. `withAdminAuth()` wrapper.
6. **Key rotation for Gemini** — 3 API keys (3 GCP projects) with cooldown. `gemini-client.ts` handles rotation.
7. **Hetzner for heavy crons** — Pipeline orchestration moved off Vercel to reduce costs/timeouts. Unified scheduler manages all workers.
8. **Supabase for read-heavy paths** — Browse, analytics, search, and libraries queries hit Supabase for speed. MongoDB remains source of truth; Supabase mirrors derived data via sync crons.
9. **Model routing by source** — BPH books get `gemini-3-flash-preview` (premium), all others get `gemini-3.1-flash-lite` (50% cheaper). See `src/lib/types/ai-models.ts`.
10. **Two quality systems on image extraction** — One Gemini call emits both `gallery_quality` (per illustration, curatorial: "worth showing?") and `scan_quality` (per page, technical: "how cleanly digitized?"). They look similar but answer different questions. Design + extension plan in `.claude/docs/automated-image-quality-system.md`. Public-facing version: `/blog/what-makes-a-good-scan`. The live prompt + rubric live in `scripts/workers/image-extract-worker.mjs:117` and `scripts/workers/pipeline-orchestrator.mjs:1836`; `prompts/image-extraction/image-extraction-v0.md` is an out-of-date archive.

## Known Dead Code & Duplicates

### Confirmed Dead Components (last audit 2026-05-25, zero imports)
Issue #258 closed. These remain with no imports anywhere:

| Component | Path | Notes |
|-----------|------|-------|
| `BookEditModal.tsx` | `components/book/` | Orphaned |
| `JobStatusBanner.tsx` | `components/book/` | Orphaned |
| `PagesGrid.tsx` | `components/book/` | Orphaned |
| `ProcessingPanel.tsx` | `components/book/` | Orphaned |
| `EntityMap.tsx` | `components/explore/` | Orphaned |
| `MapSidebar.tsx` | `components/explore/` | Orphaned |
| `PipelineStageCard.tsx` | `components/pipeline/` | Orphaned |
| `PageTracker.tsx` | `components/reader/` | Orphaned |
| `SessionCard.tsx` | `components/research/` | Orphaned |
| Camera components (6) | `components/camera/` | Mobile scanning — unused, ask before deleting |

**Deleted in #1986** (no longer in this table): `BookPagesActions.tsx`, `BookPagesStats.tsx`, `ReorderModePanel.tsx`, `SparkLine.tsx`, `HideWhenEmbedded.tsx`, `InputWidget.tsx`, plus `_archived/` batch panels and api-client files. See `.claude/handoffs/2026-05-25-pr1980-split.md` for the audit + verification process.

**Before deleting any row above:** grep-verify zero imports across the repo. Static analysis (graph tools) can miss dynamic requires, framework conventions, and recent additions — see `.claude/docs/code-review-graph.md` "Staleness — the main failure mode."

Note: Rithmomachia is a **live feature** (`/rithmomachia`, guide, scenarios, blog post) — NOT dead code.

`Footer.tsx` was previously listed but no longer exists (already deleted).

### Duplicate Functions
| Function | Location A | Location B | Action |
|----------|-----------|-----------|--------|
| `withTimeout()` | `lib/collections-utils.ts` | `api/books/search/route.ts` (local, different signature) | Different impls, both used |
| `sortCollections()` | `lib/collections-utils.ts` | `api/books/search/route.ts` (local) | Consolidate to lib |

### Disabled Cron Routes
7 cron API routes still exist in code but are removed from `vercel.json` (moved to Hetzner):
`submit-batch-ocr`, `process-batches`, `sync-page-counts`, `sync-gallery-images`, `enrich-books`, `post-import-pipeline`, `archive-ocr`

### Root tmp Scripts (128)
All `_tmp-*` files at project root. Per convention, these should not be committed.
