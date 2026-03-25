# Source Library System Map

> Last audited: 2026-03-25. Use this as the primary navigation reference.

## Architecture Overview

```
Users ──> Vercel (Next.js 16) ──> MongoDB Atlas (bookstore)
                │                        ▲
                ├──> Cloudflare R2       │ write-processor
                │    (images.sourcelibrary.org)  │
                │                        │
                ├──> SQS Queues ──> Lambda Workers ──> Gemini AI
                │    (eu-central-1)   (OCR, Translation, Images)
                │
                ├──> Hetzner (46.224.122.120)
                │    (pipeline orchestration crons)
                │
                ├──> Stripe (Ficino Society payments)
                ├──> Twitter/X API (@SourceLibrary_)
                ├──> Zenodo (DOI minting)
                └──> IIIF Sources (IA, Gallica, Wellcome, etc.)
```

## Infrastructure Map

| Service | Purpose | Key Config |
|---------|---------|------------|
| **Vercel** | Next.js hosting, 4 crons | Project: `sourcelibrary-v2` |
| **MongoDB Atlas** | Primary database | DB: `bookstore`, ~38,195 books |
| **AWS Lambda** (eu-central-1) | AI processing workers | 3 functions, SQS-triggered |
| **AWS SQS** (eu-central-1) | Job queues (FIFO) | 4 queues: OCR, translation, images, write |
| **Cloudflare R2** | Image/page storage | `images.sourcelibrary.org` |
| **Hetzner** (cax31) | Pipeline orchestration | `root@46.224.122.120`, crons not in git |
| **Gemini AI** | OCR, translation, enrichment | 10-key rotation, model: `gemini-3-flash-preview` |
| **Stripe** | Payments | Ficino Society membership |
| **Zenodo** | DOI publishing | Scholarly editions |
| **Twitter/X** | Social automation | 3h posting cron |

## Data Pipeline Flow (One Pipeline, Three Phases)

The system has **one unified pipeline** with three parallel processing phases sharing a single `jobs` collection (discriminated by `type` field):

```
Import (IA/Gallica/IIIF)
  └─> books + pages collections created
       └─> Hetzner cron (post-import-pipeline, every 10min)
            ├─ Phase 1: OCR (parallel, batch-friendly)
            │  SQS pageOcr ──> Lambda ocr-processor (×10) ──> Gemini ──> writeResults
            │
            ├─ Phase 2: Translation (FIFO sequential — needs cross-page context)
            │  SQS pageTranslation ──> Lambda translation-processor (×15) ──> Gemini ──> writeResults
            │  ⚠ Realtime API only. NEVER use Batch API for translation.
            │
            └─ Phase 3: Image Extraction (parallel)
               SQS pageImageExtraction ──> Lambda image-extraction-processor (×10) ──> Gemini ──> writeResults
                                                                                          │
                                                                          write-processor Lambda (×50) ──> MongoDB pages
```

Phases run concurrently with independent concurrency limits. Backpressure: `system_config.paused_phases` array.

## MongoDB Collections (73)

### Core Data
| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `books` | Book metadata | `id`, `title`, `author`, `slug`, `pages_count`, `pages_ocr`, `pages_translated` |
| `pages` | Individual pages | `book_id`, `ocr.data`, `translation.data`, `detected_images`, `page_type` |
| `deleted_books` | Soft-deleted books | Same as books, recoverable |
| `collections` | Book groupings | `slug`, `name`, `hidden` |
| `entities` | Encyclopedia entries | People, places, concepts |

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
| `analytics_events`, `analytics_pageviews` | User behavior |
| `pipeline_snapshots`, `pipeline_health_daily` | Pipeline metrics |
| `cron_runs` | Cron execution logs |
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
│   ├── book/[id]/          # Reader pages (guide, summary, QA, pipeline, editions)
│   ├── collections/        # Collection browse & detail
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
├── workers/                # sync-worker.mjs (Hetzner cron replacement)
└── lib/                    # Shared script utilities
```

## Pages Breakdown (~170 total)

| Category | Count | Content Source | Examples |
|----------|-------|---------------|----------|
| Core library (dynamic) | ~40 | MongoDB + APIs | Book reader, search, collections, author pages |
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
7. **Hetzner for heavy crons** — Pipeline orchestration moved off Vercel to reduce costs/timeouts.

## Known Dead Code & Duplicates

### Unused Components (29 remaining — safe to delete)
6 deleted since last audit: BetaGateModal, useBetaGate, QualityBadge, ReadingSidebar, PageThumbnail, Skeleton.

| Component | Path | Notes |
|-----------|------|-------|
| `Footer.tsx` | `components/layout/` | Superseded by `GlobalFooter.tsx` |
| `BookEditModal.tsx` | `components/book/` | Orphaned |
| `BookPagesActions.tsx` | `components/book/` | Orphaned |
| `BookPagesStats.tsx` | `components/book/` | Orphaned |
| `JobStatusBanner.tsx` | `components/book/` | Orphaned |
| `PagesGrid.tsx` | `components/book/` | Orphaned |
| `ProcessingPanel.tsx` | `components/book/` | Orphaned |
| `ReorderModePanel.tsx` | `components/book/` | Orphaned |
| Camera components (6) | `components/camera/` | Mobile scanning feature — verify if still wanted |
| Rithmomachia components (12) | `components/rithmomachia/` | Game feature — verify if still wanted |
| `EntityMap.tsx` | `components/explore/` | Internal only |
| `MapSidebar.tsx` | `components/explore/` | Internal only |
| `PipelineStageCard.tsx` | `components/pipeline/` | Orphaned |
| `PageTracker.tsx` | `components/reader/` | Imported but unused |
| `SessionCard.tsx` | `components/research/` | Orphaned |

### Duplicate Functions
| Function | Location A | Location B | Action |
|----------|-----------|-----------|--------|
| `withTimeout()` | `lib/collections-utils.ts` | `app/page.tsx` (local) | Consolidate to lib |
| `sortCollections()` | `lib/collections-utils.ts` | `app/page.tsx` (local) | Consolidate to lib |

### Disabled Cron Routes
7 cron API routes still exist in code but are removed from `vercel.json` (moved to Hetzner):
`submit-batch-ocr`, `process-batches`, `sync-page-counts`, `sync-gallery-images`, `enrich-books`, `post-import-pipeline`, `archive-ocr`

### Root tmp Scripts (128)
All `_tmp-*` files at project root. Per convention, these should not be committed.
