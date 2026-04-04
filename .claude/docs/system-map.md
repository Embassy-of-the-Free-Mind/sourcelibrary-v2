# Source Library System Map

> Last audited: 2026-04-01. Use this as the primary navigation reference.

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
| **Vercel** | Next.js hosting, 5 crons | Project: `sourcelibrary-v2` |
| **MongoDB Atlas** | Primary database | DB: `bookstore`, ~17K live + ~24.5K warehouse books |
| **Supabase Postgres** | Analytics, browse cache, catalog, search | pgvector, pg_trgm, pg_cron |
| **AWS Lambda** (eu-central-1) | AI processing workers | 4 functions, SQS-triggered |
| **AWS SQS** (eu-central-1) | Job queues (FIFO) | 4 queues: OCR, translation, images, write |
| **Cloudflare R2** | Image/page storage | `images.sourcelibrary.org` |
| **Hetzner** (cax31) | Pipeline orchestration, translation, embeddings | `root@46.224.122.120`, unified scheduler |
| **Gemini AI** | OCR, translation, enrichment | 10-key rotation. BPH: `gemini-3-flash-preview`, others: `gemini-3.1-flash-lite-preview` |
| **Stripe** | Payments | Ficino Society membership |
| **Zenodo** | DOI publishing | Scholarly editions |
| **Twitter/X** | Social automation | 3h posting cron |

## Data Pipeline Flow (One Pipeline, Three Phases)

The system has **one unified pipeline** with three parallel processing phases sharing a single `jobs` collection (discriminated by `type` field):

```
Import (IA/Gallica/IIIF)
  └─> books + pages collections created
       └─> Hetzner unified scheduler (scheduler.mjs, every 10min)
            ├─ Phase 1: OCR (parallel, batch-friendly)
            │  SQS pageOcr ──> Lambda ocr-processor (×10) ──> Gemini ──> writeResults
            │
            ├─ Phase 2: Translation (Hetzner inline — self-dispatching)
            │  translate-worker.mjs (40 concurrent books) ──> Gemini direct ──> MongoDB pages
            │  200-page cap per book → translate_partial → re-queue when fresh books exhausted
            │  ⚠ Realtime API only. NEVER use Batch API for translation. Lambda is fallback only.
            │
            └─ Phase 3: Image Extraction (parallel)
               SQS pageImageExtraction ──> Lambda image-extraction-processor (×10) ──> Gemini ──> writeResults
                                                                                          │
                                                                          write-processor Lambda (×50) ──> MongoDB pages
```

Phases run concurrently with independent concurrency limits. Backpressure: `system_config.paused_phases` array.

## Supabase Layer (added 2026-03-27+)

Supabase serves derived reads for performance-critical paths. MongoDB remains source of truth.

| Table/View | Purpose | Source |
|------------|---------|--------|
| `books_catalog` | Browse cache (11s→0.6s) | Synced from MongoDB `books` |
| `page_translations` | Semantic search embeddings | pgvector, e5-base model |
| `gemini_usage` | AI cost analytics | Synced from MongoDB |
| `pipeline_snapshots` | Pipeline velocity charts | Synced from MongoDB |
| `cron_runs` | Cron execution logs | Synced from MongoDB |
| `ustc_editions` / `ustc_enrichments` | USTC catalog | Direct import |
| `contributing_library` | Library pages (was 5s timeout) | Materialized view |

Key: `src/lib/supabase.ts` (client), `.claude/docs/supabase.md` (full reference)

## Author Pages (added 2026-03-30+)

Entity-driven author system with normalized names, Wikipedia enrichment, aliases.

| Route | Purpose |
|-------|---------|
| `/author/[name]` | Author detail — catalog table, title page gallery, publisher column |
| `/browse/authors` | Author listing/browse |
| `/api/admin/revalidate-authors` | ISR revalidation endpoint |

Key: `src/app/author/`, `src/app/browse/authors/`, author normalization in `src/lib/`

## Visual Art Wing (added 2026-03-30+)

Museum artwork imports alongside historical texts. Mixed collections show both.

| Source | Script | Status |
|--------|--------|--------|
| Met Museum | `scripts/import-met-artworks.mjs` | Active, `--object-ids` flag |
| Cleveland Museum | `scripts/import-cleveland-artworks.mjs` | Active |
| Rijksmuseum | Planned | — |

Collections support `collection_type` field. Low-res artwork filtering and upgrade pipeline in place.

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
| `entities` | Encyclopedia entries | People, places, concepts |
| `authors` | Normalized author entities | Aliases, Wikipedia, enrichment |

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
| `audit_log` | Admin action trail |
| `application_errors` | Error logging |

### Research & Experiments
`experiments`, `ocr_experiments`, `ocr_judgments`, `pipeline_experiments`, `pipeline_judgments`, `split_models`, `split_training_examples`, `split_adjustments`

### Other
`external_catalog` (IIIF union catalog), `editions`, `kdp_publications`, `book_metadata_changelog`, `prompts`, `libraries`, `volunteers`, `contributions`, `feedback`, `beta_subscribers`, `email_drafts`, `comparisons`, `entity_aliases`, `translation_catalogs`, `curation_drafts`, `curator_sessions`

## File System Layout

```
src/
├── app/                    # Next.js app router
│   ├── api/                # 325 API routes (direct DB queries, no repository layer)
│   │   ├── books/[id]/     # 57 book operations
│   │   ├── pages/[id]/     # 15 page operations
│   │   ├── import/         # 26 IIIF source importers
│   │   ├── admin/          # 46 admin endpoints
│   │   ├── cron/           # 11 cron endpoints (4 active on Vercel)
│   │   ├── gallery/        # 7 gallery endpoints
│   │   ├── search/         # 6 search endpoints
│   │   ├── social/         # 11 social media endpoints
│   │   ├── stripe/         # 4 payment endpoints
│   │   ├── dataset/v1/     # Public API (keyed access)
│   │   └── ...             # experiments, analytics, ficino, etc.
│   ├── author/[name]/      # Author detail page (catalog, gallery strip)
│   ├── book/[id]/          # Reader pages (guide, summary, QA, pipeline, editions)
│   ├── browse/authors/     # Author listing
│   ├── collections/        # Collection browse & detail (supports mixed art+book)
│   ├── gallery/            # Image gallery
│   ├── admin/              # Admin dashboard pages
│   ├── blog/               # 31 blog posts (hardcoded JSX, no CMS)
│   ├── press/              # 7 press pages (hardcoded JSX)
│   ├── research/           # Research tools (atlas, diffusion, timeline)
│   ├── explore/            # Map & timeline visualizations
│   ├── ficino-society/     # Membership, discussions
│   ├── about/, support/, terms/, privacy/  # Static info pages
│   └── ...                 # ~160 pages total
│
├── components/             # 148 React components (.tsx files)
│   ├── book/               # Book detail, reader, processing
│   ├── layout/             # GlobalHeader, GlobalFooter, FeaturedCollections
│   ├── gallery/            # Gallery views
│   ├── reader/             # Page reader, zoom, sidebar
│   ├── search/             # Search results, filters
│   ├── explore/            # Map, timeline
│   ├── ui/                 # Primitives (Button, Dialog, Tabs, etc.)
│   ├── camera/             # Mobile scanning (6 components, possibly unused)
│   ├── rithmomachia/       # Game feature (12 components, possibly unused)
│   └── ...
│
├── lib/                    # 200 utility modules
│   ├── mongodb.ts          # DB connection (singleton, pool management)
│   ├── supabase.ts         # Supabase client (analytics, browse, search)
│   ├── ai.ts               # Core Gemini operations
│   ├── gemini-client.ts    # API key rotation (10 keys)
│   ├── gemini-batch.ts     # Batch API orchestration
│   ├── storage.ts          # R2 + Vercel Blob abstraction
│   ├── sqs-client.ts       # SQS queue client
│   ├── auth.ts             # NextAuth config (Google + Email)
│   ├── auth-helpers.ts     # withAuth(), withAdminAuth()
│   ├── slugify.ts          # URL slug generation, bookUrl()
│   ├── book-lookup.ts      # Book query helpers
│   ├── import-utils.ts     # IIIF manifest parsing
│   ├── page-revisions.ts   # createRevision() — MUST call before page writes
│   ├── api-client/         # Frontend API wrappers (61 files)
│   ├── types/              # TypeScript types (25 files)
│   └── ...
│
├── workers/                # Lambda function source
│   ├── ocr-processor.ts + ocr-processor-logic.ts
│   ├── translation-processor.ts + translation-processor-logic.ts
│   ├── image-extraction-processor.ts + image-extraction-processor-logic.ts
│   └── write-processor.ts + write-processor-logic.ts
│
└── hooks/                  # 8 React hooks

scripts/                    # 308 operational scripts
├── analysis/               # ~51 inspection/reporting scripts
├── batch/                  # ~33 bulk processing scripts
├── enrichment/             # ~44 metadata enrichment scripts
├── maintenance/            # ~56 data fix scripts
├── import/                 # ~17 bulk import scripts
├── one-off/                # ~7 exploratory scripts
├── aws-lambda/             # Lambda build/deploy
├── workers/                # scheduler.mjs (unified), translate-worker, pipeline-orchestrator, etc.
└── lib/                    # Shared script utilities
```

## Pages Breakdown (~170 total)

| Category | Count | Content Source | Examples |
|----------|-------|---------------|----------|
| Core library (dynamic) | ~45 | MongoDB + APIs | Book reader, search, collections, author pages, browse/authors, artworks |
| Admin/ops dashboards | ~15 | MongoDB + APIs | Pipeline control, jobs, analytics, email, KDP |
| Research/experiments | ~20 | MongoDB + APIs | OCR quality, concept diffusion, image atlas |
| Blog posts | 31 | Hardcoded JSX (no CMS) | origin-story, progress-studies, hidden-engineers |
| Press releases | 7 | Hardcoded JSX | alchemy, hermetic-tradition, kabbalah |
| Auth/legal/info | ~10 | Static JSX | signin, terms, privacy, about, support |
| Gallery | ~6 | MongoDB + APIs | Browse, collections, image viewer, curation |
| Community | ~5 | MongoDB + APIs | Ficino Society, discussions, contribute |
| Questionable/stubs | ~15 | Mixed | See below |

### Pages to audit
- `/testloader` — debug page, should not be public
- `/scan/auto`, `/scan/opencv` — experimental scanning tools
- `/fulldata` — bulk data export, should be admin-only
- `/_archived/highlights` — deprecated, still accessible

## Key Architectural Patterns

1. **No repository/service layer** — API routes query MongoDB directly via `getDb().collection()`. No ORM.
2. **API client for frontend** — `src/lib/api-client/` provides typed wrappers around API routes.
3. **SQS-driven async processing** — All AI work goes through SQS → Lambda → Gemini → write-back.
4. **Page revisions before writes** — Any script modifying `ocr.data` or `translation.data` MUST call `createRevision()` first.
5. **Admin via whitelist** — `admin_users` collection, no RBAC. `withAdminAuth()` wrapper.
6. **Key rotation for Gemini** — 10 API keys with cooldown. `gemini-client.ts` handles rotation.
7. **Hetzner for heavy crons** — Pipeline orchestration moved off Vercel to reduce costs/timeouts. Unified scheduler manages all workers.
8. **Supabase for read-heavy paths** — Browse, analytics, search, and libraries queries hit Supabase for speed. MongoDB remains source of truth; Supabase mirrors derived data via sync crons.
9. **Model routing by source** — BPH books get `gemini-3-flash-preview` (premium), all others get `gemini-3.1-flash-lite-preview` (50% cheaper). See `src/lib/types/ai-models.ts`.

## Known Dead Code & Duplicates

### Confirmed Dead Components (verified 2026-04-01, zero imports)
Issue #258 closed. These remain with no imports anywhere:

| Component | Path | Notes |
|-----------|------|-------|
| `BookEditModal.tsx` | `components/book/` | Orphaned |
| `BookPagesActions.tsx` | `components/book/` | Orphaned |
| `BookPagesStats.tsx` | `components/book/` | Orphaned |
| `JobStatusBanner.tsx` | `components/book/` | Orphaned |
| `PagesGrid.tsx` | `components/book/` | Orphaned |
| `ProcessingPanel.tsx` | `components/book/` | Orphaned |
| `ReorderModePanel.tsx` | `components/book/` | Orphaned |
| `EntityMap.tsx` | `components/explore/` | Orphaned |
| `MapSidebar.tsx` | `components/explore/` | Orphaned |
| `PipelineStageCard.tsx` | `components/pipeline/` | Orphaned |
| `PageTracker.tsx` | `components/reader/` | Orphaned |
| `SessionCard.tsx` | `components/research/` | Orphaned |
| Camera components (6) | `components/camera/` | Mobile scanning — unused, ask before deleting |
| Rithmomachia components (14) | `components/rithmomachia/` | Game — unused, ask before deleting |

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
