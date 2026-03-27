# Processing Pipeline

Single source of truth for the full processing pipeline — from import to complete. Last updated: March 16, 2026.

> **See also:** `pipeline-architecture.md` for Hetzner infrastructure, emergency controls, and operational details.

## End-to-End Overview

```
IMPORT → ARCHIVE → OCR → METADATA → FT VERIFY → TRANSLATE → ENRICH (summary+index) → CHAPTERS → IMAGES → COMPLETE
```

Every step is independent and idempotent. Books can enter at any stage and be re-processed safely. Two crons orchestrate the auto pipeline; each step can also be triggered manually.

| Step | Method | Cost/book | Duration | Automated? |
|------|--------|-----------|----------|------------|
| Import | 13 import APIs | Free | Seconds | Manual |
| Archive | Hetzner script + cron check | Free (bandwidth) | Minutes-hours | Yes |
| OCR | Lambda workers (SQS) or Gemini Batch API | ~$0.10-0.50 | Minutes-hours | Yes |
| Metadata enrich | Gemini realtime (text analysis) | ~$0.005 | Seconds | Yes |
| FT verify | Gemini realtime (LLM knowledge check) | ~$0.007 | Seconds | Yes |
| Translate | Lambda workers (SQS FIFO) | ~$0.10-0.50 | Minutes-hours | Yes |
| Enrich | Gemini realtime (summary + index) | ~$0.05-0.15 | Seconds | Yes |
| Chapters | Gemini realtime | ~$0.02 | Seconds | Yes |
| Transliteration | Gemini realtime (non-Latin books) | ~$0.02-0.10 | Minutes | Yes |
| Images | Lambda workers (SQS) | ~$0.10-0.25 | Minutes-hours | Yes |

---

## Auto Pipeline State Machine

The pipeline is orchestrated from **Hetzner** (`scripts/workers/pipeline-orchestrator.mjs`, every 2 min). Translation runs on a separate Hetzner worker (`translate-worker.mjs`, every 2 min). Batch OCR results are collected by `batch-collector.mjs` (every 10 min). See `pipeline-architecture.md` for the full cron schedule and infrastructure map.

**Legacy:** The Vercel crons (`post-import-pipeline`, `enrich-books`) still exist in `_archived/` and can be re-enabled. The Hetzner orchestrator consolidated both into a single script with all phases.

Each book has a `pipeline_auto` object tracking its state.

### States

```
queued → archiving → archive_complete → ocr_submitted → ocr_complete
  → metadata_enriched → ft_verifying → ft_verified → translate_submitted → translate_complete
  → enriching → enriched → chapters → chapters_complete → images_submitted → images_complete → complete
```

Any state can transition to `failed` on persistent errors (after 3 retries). Special states: `empty_shell` (0-page failed imports), `needs_attention` (requires manual intervention), `paused` (manually halted).

| Status | What's happening | Who drives it |
|--------|-----------------|---------------|
| `queued` | Book enrolled, waiting to start | Pipeline cron Phase 0 (auto-enroll) or admin |
| `archiving` | Pages being archived to Cloudflare R2 | Hetzner script (external) |
| `archive_complete` | All pages archived or no archivable sources | Pipeline cron Phase 1 |
| `ocr_submitted` | Lambda OCR jobs enqueued (or Batch API submitted) | Pipeline cron Phase 2 |
| `ocr_complete` | OCR finished, results saved | Pipeline cron Phase 3 + process-batches cron |
| `metadata_enriched` | AI metadata enrichment complete (language, categories, description, source_work_dates) | Pipeline cron Phase 3.5 |
| `ft_verifying` | First-translation verification in progress (LLM knowledge check) | Pipeline cron Phase 3.7 |
| `ft_verified` | First-translation verification complete (or skipped for English books) | Pipeline cron Phase 3.7 |
| `translate_submitted` | Lambda translation jobs enqueued | Pipeline cron Phase 4 |
| `translate_complete` | Translation finished | Pipeline cron Phase 5 |
| `enriching` | Summary + index generation in progress | enrich-books cron Phase 1 |
| `enriched` | Summary + index complete | enrich-books cron Phase 1 |
| `chapters` | Chapter extraction in progress | enrich-books cron Phase 2 |
| `chapters_complete` | Chapters extracted (or skipped for short books) | enrich-books cron Phase 2 |
| `images_submitted` | Image extraction job queued to Lambda | Pipeline cron (priority pass) |
| `images_complete` | All pages scanned for illustrations | Pipeline cron (priority pass) |
| `complete` | Fully processed | Pipeline cron (priority pass) |
| `failed` | Persistent error after 3 retries | Any phase |
| `empty_shell` | Failed import with 0 pages | Manual triage |
| `needs_attention` | Requires manual intervention (e.g. translation loop) | Manual triage |

### Failure Handling

- Each phase retries up to 3 times before marking `failed`
- Enrichment and chapter extraction are **non-critical**: on persistent failure, the book skips ahead (won't block the rest of the pipeline)
- Failed books can be re-enrolled: `POST /api/admin/enroll-pipeline { reEnrollFailed: true }`
- Staleness detector rolls back books stuck in `*_submitted`/`ft_verifying`/`enriching`/`chapters` states after 48h

### Backpressure Limits

Most submission limits are now **adaptive** — managed by `src/lib/adaptive-limits.ts` and stored in `system_config._id: 'adaptive_limits'`. The system probes DB health every cron cycle and adjusts limits automatically.

**Adaptive limits** (dynamic, stored in MongoDB):

| Resource | Min | Default | Max | Key |
|----------|-----|---------|-----|-----|
| OCR books per run | 2 | 10 | 20 | `ocr_submit` |
| OCR Lambda concurrency | 3 | 10 | 20 | `ocr_lambda_max` |
| Translation books per run | 2 | 20 | 50 | `translate_submit` |
| Translation Lambda concurrency | 3 | 15 | 30 | `translate_lambda_max` |
| Global active jobs | 5 | 20 | 40 | `global_active_max` |
| Image extraction per run | 3 | 10 | 20 | `image_submit` |
| Image max active | 5 | 25 | 50 | `image_max` |
| SQS OCR depth threshold | 100 | 300 | 500 | `sqs_ocr_depth` |
| SQS translation depth threshold | 200 | 500 | 1000 | `sqs_translate_depth` |
| Pages enqueued per run | 200 | 2000 | 5000 | `pages_per_run` |

**Adaptive behavior:**
- **Healthy** (1+ consecutive): ramp all limits up by 20%
- **Degraded** (any signal): reduce all limits by 50%
- **Critical** (any signal): slam to minimums, cancel pending jobs
- Health signals: DB query latency, active job count, cron duration, SQS queue depth (per-queue)
- Admin override: `PATCH /api/admin/adaptive-limits` with `locked: true` to freeze

**Static limits** (hardcoded constants in cron files):

| Resource | Limit | Constant |
|----------|-------|----------|
| Gemini Batch OCR jobs | 200 active | `MAX_ACTIVE_BATCH_OCR` |
| Metadata enrichment per run | 20 | `METADATA_ENRICH_LIMIT` |
| FT verification per run | 10 | `FT_VERIFY_LIMIT` |
| Enrichment per run | 30 | `ENRICH_LIMIT` (enrich-books cron) |
| Chapter extraction per run | 20 | `CHAPTER_LIMIT` (enrich-books cron) |
| Transliteration books per run | 10 | `TRANSLIT_LIMIT` (enrich-books cron) |
| Transliteration pages per run | 200 | `TRANSLIT_PAGES_PER_RUN` (enrich-books cron) |
| Transliteration concurrency | 10 | `TRANSLIT_CONCURRENCY` (enrich-books cron) |
| Finalization per run | 50 | `FINALIZE_LIMIT` |
| Auto-enroll per run | 50 | `ENROLL_LIMIT` |
| Lambda OCR fallback per run | 10 | `LAMBDA_FALLBACK_LIMIT` |
| Completion check per cycle | 50 | `.limit(50)` on Phase 3/5/image loops |

### Pause Controls

**Emergency stop:** `system_config` collection, `_id: 'processing_control'`.
- `paused: true` — halts ALL pipeline work
- `paused_phases: string[]` — selective pauses per phase

| Phase flag | What it blocks |
|-----------|----------------|
| `'ocr'` | OCR submission (Phase 2) AND OCR completion detection (Phase 3) |
| `'translation'` | Translation submission (Phase 4) AND translation completion (Phase 5) |
| `'images'` | Image extraction submission AND finalization (books can't reach `complete`) |
| `'enrichment'` | Summary + index generation (enrich-books cron Phase 1) |
| `'chapters'` | Chapter extraction (enrich-books cron Phase 2) |
| `'transliteration'` | Transliteration/romanization of non-Latin scripts (enrich-books cron Phase 3) |

**Both submission AND completion are guarded.** This prevents in-flight work from cascading through paused phases — a hard-learned lesson from the Mar 2 bypass incident.

```bash
# Pause OCR and images
curl -X POST https://sourcelibrary.org/api/admin/emergency-stop \
  -H "Content-Type: application/json" \
  -d '{"paused_phases": ["ocr", "images"]}'

# Resume all
curl -X POST https://sourcelibrary.org/api/admin/emergency-stop?resume=true
```

### Pipeline Auto Fields

Stored on `book.pipeline_auto`:

```typescript
{
  status: PipelineAutoStatus;
  source: 'import' | 'admin' | 'cron';
  queued_at: Date;
  started_at?: Date;
  completed_at?: Date;
  error?: string;
  retry_count?: number;
  ocr_job_name?: string;        // Gemini Batch API job name
  ocr_job_id?: string;          // Lambda jobs collection ID
  translate_job_name?: string;   // Gemini Batch API job name
  translate_job_id?: string;     // Lambda jobs collection ID
  ocr_batch_id?: string;        // batch_jobs collection ID
  translate_batch_id?: string;   // batch_jobs collection ID
  image_extraction_job_id?: string; // jobs collection ID
  ocr_loop_count?: number;      // How many times OCR has looped for remaining pages
  translate_loop_count?: number; // How many times translation has looped
  last_updated?: Date;
  last_stale_check?: Date;      // When stale translation check last ran
}
```

---

## Pipeline Cron Execution Order

The `post-import-pipeline` cron (1,615 lines, `maxDuration = 300`) runs phases in a **non-sequential** order. Late-stage phases run FIRST as a "priority pass" so they don't get starved by heavy early-stage work.

### Priority Pass (runs first)

| Order | Phase | Transition | Notes |
|-------|-------|-----------|-------|
| 1 | Finalize | `images_complete` → `complete` | Validates OCR coverage (>10%), syncs to GitHub. Blocked by `imagesPaused`. |
| 2 | Image submission | `chapters_complete` → `images_submitted` | Creates Lambda jobs. Blocked by `imagesPaused`. |
| 3 | Image completion | `images_submitted` → `images_complete` | Checks jobs collection. |
| 4 | Staleness detection | Roll back stuck books | 48h timeout on `*_submitted`, `ft_verifying`, `enriching`, `chapters`. Checks for active jobs before rolling back. |
| 5 | Zombie job detection | Force-complete stuck jobs | Jobs in `processing` for >2h (Lambda max runtime is 15 min). |

**Staleness rollback map:**
- `ocr_submitted` → `archive_complete`
- `ft_verifying` → `metadata_enriched`
- `translate_submitted` → `ft_verified`
- `images_submitted` → `chapters_complete`
- `enriching` → `translate_complete`
- `chapters` → `enriched`

### Main Pass (standard pipeline order)

| Order | Phase | Transition | Notes |
|-------|-------|-----------|-------|
| 6 | Phase 0: Auto-enroll | new → `queued` | Books imported within 7 days without `pipeline_auto`. FT verification deferred to Phase 3.7. |
| 7 | Phase 1: Archive check | `queued` → `archiving` → `archive_complete` | DB checks only; Hetzner copies images to Cloudflare R2. 24h timeout — advances anyway since OCR works on original IIIF URLs. |
| 8 | Phase 2: Submit OCR | `archive_complete` → `ocr_submitted` | Lambda workers (Batch API available but not default). See "OCR Routing" below. |
| 9 | Phase 3: OCR completion | `ocr_submitted` → `ocr_complete` | Checks both Lambda jobs and batch_jobs. Loops if un-OCR'd pages remain (up to MAX_RETRIES). Blocked by `ocrPaused`. |
| 10 | Phase 3.5: Metadata enrichment | `ocr_complete` → `metadata_enriched` | Calls `enrichBookMetadata()`. Detects language, categories, year, description, display_title, source_work_dates. Non-blocking: failures skip ahead. |
| 10.5 | Phase 3.7: FT verification | `metadata_enriched` → `ft_verifying` → `ft_verified` | Calls `verifyFirstTranslation()` for non-English books. English/already-verified books skip straight to `ft_verified`. Non-blocking: failures skip ahead after 3 retries. |
| 11 | Phase 4: Submit translation | `ft_verified` → `translate_submitted` | Lambda FIFO queue only. See "Translation Routing" below. |
| 12 | Phase 5: Translation completion | `translate_submitted` → `translate_complete` | Checks Lambda jobs. Loop limit: `max(6, ceil(pages_count/200))`. Blocked by `translatePaused`. |

### Safety Mechanisms

- **Early flush:** Writes partial `cron_runs` record at 240s (before Vercel's 300s kill) so observability isn't lost
- **Pipeline snapshots:** Writes funnel counts to `pipeline_snapshots` collection at end of run
- **MongoDB reconnect:** Catches connection errors, attempts `forceReconnect()`, returns 200 with partial results
- **Time budget:** 270s working window; each phase checks `hasTimeBudget()` before starting

---

## Enrich-Books Cron

**Route:** `/api/cron/enrich-books` (~410 lines, `maxDuration = 300`)

Split out from the pipeline cron so enrichment doesn't starve translation of time budget. Runs every 10 min. Three phases: enrichment → chapters → transliteration.

### Phase 1: Enrichment (`translate_complete`/`enriching` → `enriched`)

- Queries books with status `translate_complete` OR `enriching` OR `enrichment_stale: true`
- Sorts by `hidden: 1` (visible books first)
- Marks all books as `enriching` upfront
- Processes ALL books **concurrently** with `Promise.allSettled()` and 120s per-book timeout
- Calls `GET /api/books/{id}/index` for summary + index generation
- Runs `scoreBookQuality()` after enrichment (non-blocking)
- On persistent failure (>=3 retries): skips to `enriched` (non-critical)

### Phase 2: Chapter Extraction (`enriched` → `chapters_complete`)

- Processes **sequentially** (not concurrent)
- Skips books with <10 pages
- Calls `extractChaptersForBook()` directly (not via HTTP)
- On persistent failure: skips to `chapters_complete` (non-critical)

### Phase 3: Transliteration (non-Latin books)

Romanizes OCR text for non-Latin scripts (Greek, Hebrew, Arabic, etc.). **Not tied to pipeline state** — runs on any book with OCR'd pages missing transliteration, regardless of pipeline stage. Non-critical: failures don't block anything.

- **Languages:** Greek, Hebrew, Arabic, Persian, Ottoman Turkish, Syriac, Chinese, Japanese, Korean, Sanskrit, Armenian, Georgian, Ethiopic, Coptic, Tibetan, Russian, Church Slavonic
- **Discovery:** `$lookup` aggregation finds books with non-Latin `language` field that have pages with `ocr.data` but no `transliteration.data`
- **Skips page types:** blank, illustration, map, frontispiece, diagram
- **Processing:** Concurrent chunks of 10 Gemini calls per batch
- **Model:** `gemini-3-flash-preview`
- **Limits:** 10 books/run, 200 pages/run total
- **Storage:** `page.transliteration.data` (romanized text), `.model`, `.updated_at`, `.source_ocr_hash` (cache invalidation), `.script` (source script name)
- **Logging:** Each call logged to `gemini_usage` with `type: 'transliterate'`
- **Pause:** `paused_phases: ['transliteration']`
- **Manual trigger:** `POST /api/pages/{pageId}/transliterate`
- **Batch script:** `scripts/batch/batch-transliterate.mjs` (uses cheaper `gemini-3.1-flash-lite-preview`)

---

## OCR Routing

### Production Path: Gemini Batch API on Hetzner (current default)

The Hetzner `pipeline-orchestrator.mjs` Phase 2 submits OCR directly to Gemini Batch API:
- Downloads page images locally, builds JSONL with OCR prompts + base64 images
- File-based batch for >20 pages (~150 pages/job via Gemini File API), inline batch for <=20 pages
- Model routing: `gemini-3-flash-preview` for BPH, `gemini-3.1-flash-lite-preview` for others
- 50% cost discount via Batch API, latency up to 24 hours
- API key rotation: tries `KEY_2` → `TIER3` → `KEY` on quota exhaustion
- Results collected by `batch-collector.mjs` (Hetzner cron, every 10 min)
- Backpressure: max 500 active batch jobs (`MAX_ACTIVE_BATCH_OCR`)

### Preview Path: Lambda Workers (first 25 pages)

Phase 1.5 sends the first 25 pages to Lambda via SQS for fast preview OCR (minutes, not hours):
- OCR worker processes ONE page per Lambda invocation via SQS standard queue
- Concurrency: 10 reserved Lambda instances
- Results written to write-results SQS queue → Writer Lambda → MongoDB
- Triggers preview translation after completion

### Legacy Vercel Cron Path (archived)

The old Vercel-based `post-import-pipeline` cron also had OCR routing with Lambda fallback. This code exists in `_archived/` but is not active. It can be re-enabled by adding crons back to `vercel.json` (see `pipeline-architecture.md` "How to Switch Back to Vercel").

---

## Translation Routing

**CRITICAL: NEVER use Gemini Batch API for translation.** Batch API lacks cross-page context continuity — each page must see the previous page's translation for coherent output.

### Production Path: Hetzner Inline Worker

`scripts/workers/translate-worker.mjs` runs on Hetzner cron every 2 minutes:
- Picks up books in `translate_submitted` status
- Translates pages sequentially per book (context continuity via previous page lookup)
- Calls Gemini API directly — no SQS, no Lambda
- Model routing: `gemini-3-flash-preview` for BPH, `gemini-3.1-flash-lite-preview` for all others
- Concurrency: 20 books simultaneously, 8,000 page cap per run, 40 in-flight book cap
- API key rotation on rate limits (up to 11 keys)

### Fallback Path: Lambda + SQS FIFO

Lambda translation processor still works for:
- Preview translation (first 25 pages via `preview-translate.ts`)
- Manual job submission via `/api/jobs/queue-books`

These paths use SQS FIFO queue with `MessageGroupId` = job ID for sequential processing.

### English Modernization

English books (pre-1700) get **modernized** instead of translated — Early Modern English → Modern English. Output stored in `translation.data` (same field). Detection: `sourceLanguage.toLowerCase() === 'english'` in `getTranslationPrompt()`.

---

## Image Extraction

### How It Works

The image extraction worker scans page images using Gemini vision to detect illustrations, emblems, diagrams, and other visual elements. Each Lambda invocation processes ONE page.

**Model:** `gemini-3-flash-preview` (DEFAULT_MODEL). Earlier books (pre-Feb 2026) were processed with `gemini-2.5-flash`.

**Extraction backends** in `src/lib/image-extraction.ts`:
1. **`extractWithGemini()`** (primary, production) — Gemini vision API, temperature 0.1, returns rich metadata
2. **`extractWithMistral()`** (alternative) — Pixtral 12B model, simpler metadata
3. **`extractWithGroundingDino()`** (object detection) — Replicate API, pixel-level bounding boxes with NMS deduplication

### What Gets Extracted

For each detected image:
- Type: emblem, woodcut, engraving, portrait, frontispiece, musical_score, diagram, symbol, decorative, map
- Bounding box (0-1 normalized coordinates)
- Gallery quality score (0.0-1.0 with detailed rubric)
- Museum description (2-3 sentence label)
- Rich metadata: subjects, figures, symbols, style, technique

### Gallery Pipeline

After extraction, `buildGalleryDocs()` creates denormalized gallery documents for images meeting quality threshold:
- Must have bounding box
- `detection_source` must be `vision_model`, `manual`, or `ocr_tag`
- `gallery_quality` >= 0.5

Gallery documents stored in `gallery_images` collection, browsable at `https://sourcelibrary.org/gallery`.

### Write Queue Architecture

Image extraction workers do NOT write to MongoDB directly. Results go to a write-results SQS queue → Writer Lambda (50 max concurrency) → MongoDB. This prevents connection storms during large batch jobs.

### Current State (Mar 2026)

- ~1,500+ books have gallery images
- ~73,000+ total gallery images extracted (growing as pipeline processes new imports)
- Gallery sync cron (`sync-gallery-images`, every 6h) keeps gallery metadata fresh

### No Dedicated Handoff Documentation

Image extraction was implemented incrementally across multiple sessions. Key references:
- Worker architecture: `.claude/docs/worker-architecture.md`
- Gallery thumbnail fixes: `.claude/handoffs/2026-02-23-gallery-thumbnail-fixes.md`
- Audit trail & worker fixes: `.claude/handoffs/2026-02-08-audit-trail-worker-fixes.md`

---

## Post-Processing Side Effects

Several automated features run as side effects during the main pipeline, writing additional data that enriches the book but doesn't gate pipeline progress. All are non-blocking — failures are silently caught.

### Quality Scoring

**Module:** `src/lib/quality-scoring.ts` → `scoreBookQuality(db, bookId)`
**Trigger:** enrich-books cron Phase 1 (after summary + index generation)
**Manual:** `POST /api/books/{id}/quality-score`

Rates each book on a 0–100 scale combining AI assessment and mechanical bonuses.

**AI dimensions** (0–25 each, via Gemini):
- Historical significance
- Visual appeal
- Accessibility
- Scholarly value

**Mechanical adjustments:**
- Completeness bonus (+0–8): based on OCR/translation coverage
- Incomplete penalty (−5 to 0): for very low OCR coverage
- Engagement bonus (+0–5): based on `read_count`
- Gallery bonus (+0–5): based on number of gallery images
- Edition/DOI bonus (+0–2): if a scholarly edition or DOI exists

**Database writes:** `book.quality_score` (number), `book.quality_assessment` (full breakdown with AI reasoning)

### Entity/Encyclopedia Sync

**Module:** `src/app/api/books/[id]/index/route.ts` → `syncBookEntities()`
**Trigger:** Non-blocking, runs at the end of index generation (`GET /api/books/{id}/index`)

Syncs people, places, and concepts from a book's index to the cross-book `entities` collection, enabling the encyclopedia at `/encyclopedia`.

- Resolves variant names to canonical forms via `entity_aliases` collection (e.g., "St. Augustine" → "Saint Augustine")
- Upserts entities with `$addToSet` for books and aliases
- Updates aggregate counts: `book_count`, `total_mentions`
- Entity types: `person`, `place`, `concept`

**Database writes:** `entities` collection (upserts per entity)

### GitHub Text Sync

**Module:** `src/lib/git-sync.ts` → `syncBookToGitHub(bookId)`
**Trigger:** Pipeline cron Phase 9 (finalization), after book marked `complete`
**Manual:** `POST /api/books/{id}/sync-git`
**Target repo:** `JDerekLomas/source-library-texts`

Creates version-controlled plaintext exports of every completed book on GitHub. Idempotent via blob SHA comparison — skips if content unchanged.

**Files per book:**
- `books/{bookId}/metadata.json` — title, author, language, year, page counts, processing info, content hashes
- `books/{bookId}/ocr.txt` — all OCR text with `--- Page N ---` separators
- `books/{bookId}/translation.txt` — all translation text with page separators

**Commit message:** `sync: {display_title} ({language}, {pages_ocr} OCR, {pages_translated} translated)`

Uses GitHub REST API for commits (no git binary required). Requires `GITHUB_TOKEN` env var.

### Translation Metadata Extraction

**Module:** `src/lib/translation-metadata.ts` → `extractTranslationMetadata(translationText)`
**Trigger:** All 4 translation save paths (Lambda worker, realtime route, batch cron, contributor route)

Parses `<summary>` and `<keywords>` XML tags from translation output (appended by the translation prompt).

**Database writes:**
- `page.translation_summary` — 1-2 sentence summary of page content
- `page.translation_keywords` — array of extracted keywords (split on comma/semicolon/dash)

**Known issue:** These fields are written but **never read** by any UI, search, or API route. The data exists on pages but is currently unused. Potential future use: page-level search faceting, automatic TOC generation, or book-level keyword clouds.

---

## Prompt Selection

### OCR Prompts

`getOcrPrompt(language, options?)` in `src/lib/prompts.ts`

**ALWAYS use Standard OCR** (latest version, currently v6) for ALL books regardless of language. Language-specific prompts (Latin OCR, German OCR) exist but are deprecated in practice.

**DB prompt families:**

| Name | Current Version | Status |
|------|----------------|--------|
| Standard OCR | v6 | Active — used for all books |
| Latin OCR (Neo-Latin) | v3 | Available but not used by auto pipeline |
| German OCR (Fraktur) | v3 | Available but not used by auto pipeline |

All prompts produce:
- `<page-type>...</page-type>` — classification (text, illustration, table_of_contents, etc.)
- `<columns>N</columns>` — number of text columns
- `<column-break/>` — inline marker between columns
- `<detected-images>...</detected-images>` — bounding boxes for illustrations
- `<language>...</language>` — detected language (renamed from `<lang>` in v5.2026-02)

### Translation Prompts

`getTranslationPrompt(sourceLanguage, targetLanguage?, options?)` in `src/lib/prompts.ts`

**English short-circuit:** If `sourceLanguage === 'english'`, returns `ENGLISH_MODERNIZATION_PROMPT`. No DB lookup.

**DB translation prompt families:**

| Name | Use Case |
|------|----------|
| Standard Translation | General translation to English |
| Latin Translation | Neo-Latin conventions |
| German Translation | Early Modern German |

### Prompt Versioning

`PROMPT_VERSION` constant in `src/lib/types/prompts/defaults.ts` (currently `v5.2026-02`). Stored on every page record for traceability.

Prompts in the `prompts` collection are **immutable** — updates create new versions (auto-incrementing), old versions are never modified. The `is_default` flag marks the active version.

---

## Job Systems

Two parallel systems for processing pages:

### Realtime (Lambda/SQS)

- **4 workers:** OCR, Translation, Image Extraction, Writer
- Each AI worker processes **one page** per Lambda invocation
- Writer Lambda receives results via write-results queue, performs all MongoDB writes (50 max concurrency)
- Translation uses **FIFO queue** (sequential per job) for context continuity
- OCR and image extraction use **standard queues** (parallel)
- Writer Lambda calls `checkJobCompletion()` to transition jobs
- **Cost:** Full Gemini API price
- **Latency:** Seconds per page
- **Best for:** Translation (REQUIRED — needs previous page context), OCR (current default), image extraction

### Batch (Gemini Batch API)

- Submit JSONL with all page requests → Gemini processes asynchronously
- Results collected by `process-batches` cron (every 2 hours)
- **Cost:** 50% discount on Gemini API price
- **Latency:** Up to 24 hours (usually faster)
- **Best for:** OCR of large books (when Lambda backlog is clear)
- Parent-child architecture for 500+ page books
- **NOT suitable for translation** (no cross-page context)

### When Each Is Used

| Step | Auto Pipeline | Manual |
|------|--------------|--------|
| OCR | Lambda (default) or Batch API | Either (`queue-books` or `batch-ocr-async`) |
| Translation | Lambda FIFO only | `queue-books` with `action: 'translation'` only |
| Image Extraction | Lambda (via pipeline cron) | `queue-books` with `action: 'image_extraction'` |
| Summary/Index | Realtime HTTP (via `/api/books/{id}/index`) | Same |
| Chapters | Realtime inline (shared function) | POST `/api/books/{id}/extract-chapters` |

---

## Cron Architecture

Nine crons, all defined in `vercel.json`:

| Cron | Schedule | Purpose | Pipeline Role |
|------|----------|---------|---------------|
| `post-import-pipeline` | Every 10 min | Main orchestrator — import → translate + images + finalization | Core |
| `enrich-books` | Every 10 min | Enrichment (summary + index) + chapter extraction | Core (split from pipeline) |
| `process-batches` | Every 2 hours | Collects Gemini Batch API results, saves to pages | OCR/translate batch completion |
| `submit-batch-ocr` | Daily 3 AM UTC | Campaign-driven batch OCR submission (15 books, 100 pages each) | Batch processing |
| `sync-page-counts` | Every 6 hours | Refreshes `pages_count`, `pages_ocr`, `pages_translated` caches on books | Data integrity |
| `sync-gallery-images` | Every 6 hours | Syncs gallery image metadata from pages to gallery_images | Gallery |
| `archive-ocr` | Every 4 hours | Archives page images to Cloudflare R2 for OCR'd pages | Data safety |
| `social-post` | Every hour | Posts queued tweets | Social media |
| `social-reset` | Daily midnight UTC | Resets daily tweet counter | Social media |

**Historical note:** `submit-ocr` cron was removed Mar 5, 2026 — it was redundant with the pipeline cron and wasted DB queries.

### Interaction Pattern

```
post-import-pipeline: submit jobs → check jobs/batch_jobs → advance books
enrich-books:         enrichment (summary+index) → chapter extraction → transliteration
process-batches:      poll Gemini → save page results → update batch_jobs
```

The pipeline cron **submits** OCR/translation jobs but doesn't collect Batch API results. The `process-batches` cron **collects** Batch API results. Lambda results flow through the Writer Lambda automatically.

---

## What "Complete" Means

A fully processed book has all of these:

### Required Fields

| Field | Source | Description |
|-------|--------|-------------|
| `pages[].ocr.data` | OCR step | Text extracted from every page |
| `pages[].translation.data` | Translation step | English translation (or modernization for English books) |
| `reading_summary` | Enrich step | Book-level reading summary |
| `index` | Enrich step | People, places, concepts, quotes, section summaries |
| `chapters` | Chapter step | Structural divisions with page links |
| `pages[].detected_images` | Image step | Illustration metadata on pages with images |

### Validation at Finalization (Phase 9)

Before marking a book `complete`, the pipeline checks:
- OCR coverage >10% (pages with `ocr.data` / total pages)
- Syncs book to GitHub via `syncBookToGitHub()` (non-blocking, see "Post-Processing Side Effects")

### Cached Fields (derived, refreshed by cron)

| Field | Source |
|-------|--------|
| `pages_count` | Count of all pages |
| `pages_ocr` | Count of pages with OCR |
| `pages_translated` | Count of pages with translation |

### Optional Fields (not required for "complete")

| Field | When Present |
|-------|-------------|
| `editions` | If a scholarly edition has been published |
| `pages[].archived_photo` | If images were archived to Cloudflare R2 (e.g. `https://images.sourcelibrary.org/archived/...`) |
| `pages[].page_type` | If OCR was done with v4+ prompt |
| `pages[].columns` | If page has 2+ text columns |
| `source_work_dates` | Compositional timeline layers (set by Phase 3.5 metadata enrichment) |
| `source_work_dates_meta` | Enrichment metadata (model, confidence, reasoning) |
| `pages[].transliteration.data` | Romanized text for non-Latin script pages (Greek, Hebrew, Arabic, etc.) |
| `quality_score` | AI + mechanical quality rating (0–100), set after enrichment |
| `quality_assessment` | Full scoring breakdown with AI reasoning |
| `pages[].translation_summary` | Per-page summary extracted from translation output (currently unused by UI) |
| `pages[].translation_keywords` | Per-page keywords extracted from translation output (currently unused by UI) |

---

## Manual Triggers

Every pipeline step can be triggered manually:

### Import
```bash
curl -X POST https://sourcelibrary.org/api/import/ia \
  -H "Content-Type: application/json" \
  -d '{"ia_identifier":"...", "title":"...", "author":"...", "year":1617, "original_language":"Latin"}'
```

### Archive Images
```bash
curl -X POST https://sourcelibrary.org/api/books/BOOK_ID/archive-images \
  -H "Content-Type: application/json" \
  -d '{"limit": 100}'
```

### OCR (Realtime Lambda — preferred)
```bash
curl -X POST https://sourcelibrary.org/api/jobs/queue-books \
  -H "Content-Type: application/json" \
  -d '{"bookIds":["BOOK_ID"], "action":"ocr"}'
```

### OCR (Batch API — 50% cheaper, slower)
```bash
curl -X POST https://sourcelibrary.org/api/books/BOOK_ID/batch-ocr-async \
  -H "Content-Type: application/json" \
  -d '{"limit": 500}'
```

### OCR (Direct SQS — bypasses API auth)
For bulk operations from scripts, bypass the Next.js API and write directly to MongoDB + SQS. See `_tmp-ocr-shwep.mjs` for an example.

### Translation (Realtime Lambda — ONLY method)
```bash
curl -X POST https://sourcelibrary.org/api/jobs/queue-books \
  -H "Content-Type: application/json" \
  -d '{"bookIds":["BOOK_ID"], "action":"translation"}'
```

**NEVER use `batch-translate-async` for translation.** Lambda FIFO queue is required for cross-page context continuity.

### Summary + Index
```bash
# Generates if stale (>24h) or missing
curl https://sourcelibrary.org/api/books/BOOK_ID/index

# Force regenerate
curl -X POST https://sourcelibrary.org/api/books/BOOK_ID/index
```

### Chapter Extraction
```bash
curl -X POST https://sourcelibrary.org/api/books/BOOK_ID/extract-chapters
```

### Image Extraction (Lambda)
```bash
curl -X POST https://sourcelibrary.org/api/jobs/queue-books \
  -H "Content-Type: application/json" \
  -d '{"bookIds":["BOOK_ID"], "action":"image_extraction"}'
```

### Enroll in Auto Pipeline
```bash
# Enroll specific books
curl -X POST https://sourcelibrary.org/api/admin/enroll-pipeline \
  -H "Content-Type: application/json" \
  -d '{"bookIds":["BOOK_ID"]}'

# Re-enroll completed books for chapters + images backfill
curl -X POST https://sourcelibrary.org/api/admin/enroll-pipeline \
  -H "Content-Type: application/json" \
  -d '{"reEnrollCompleted": true, "limit": 50, "dryRun": true}'

# Re-enroll failed books
curl -X POST https://sourcelibrary.org/api/admin/enroll-pipeline \
  -H "Content-Type: application/json" \
  -d '{"reEnrollFailed": true}'
```

### Agent Curator (`/curator`)

The curator skill is the primary entry point for adding books to the pipeline. It autonomously searches digital archives (Internet Archive, Gallica, MDZ, Wellcome, e-rara, Bodleian, Cambridge, HAB, Vatican, Google Books, Europeana, Library of Congress), evaluates scholarly relevance, and calls import API routes. Usage: "agent curator search for Paracelsus works" or `/curator alchemy`. Each imported book is automatically enrolled in the auto pipeline by the Phase 0 cron.

Skill definition: `.claude/skills/curator/SKILL.md`

---

## Cost Estimates

Based on `gemini-3-flash-preview` actual measured costs from `gemini_usage` collection (4.1M records, all-time):

| Step | Avg input tokens | Avg output tokens | Measured $/call | 300-page book |
|------|-----------------|-------------------|----------------|---------------|
| OCR | ~31,600 (image) | ~30,000 | $0.0022/page | $0.66 |
| Translation | ~2,200 | ~1,050 | $0.0035/page | $1.05 |
| Metadata enrichment | ~7,500 | ~760 | $0.007/book | $0.007 |
| FT verification | ~12,500 | ~330 | $0.007/book | $0.007 |
| Summary + Index | ~3,300 | ~2,000 | $0.008/book | $0.008 |
| Chapter extraction | ~6,400 | ~1,200 | $0.007/book | $0.007 |
| Image extraction | ~1,300 | ~80 | $0.0009/page | $0.27 |
| Transliteration | ~1,900 | ~1,200 | $0.0017/page | $0.51 (non-Latin only) |

**Typical full pipeline cost for a 300-page Latin book (Lambda):** ~$1.73
- OCR: $0.66, Translation: $1.05, Image extraction: $0.27 if visual content
- Per-book phases (metadata, FT, summary, chapters): ~$0.03

**Budget planning:** At ~$0.006/page average across OCR + translation, 1,000 pages costs roughly $6. Image extraction adds ~$0.001/page for pages with visual content.

**Implied Gemini 3 Flash Preview rates:** ~$0.59/1M input, ~$2.87/1M output (back-calculated from actual translation call data).

**Batch translation proposal (issue #217):** Sending 5 pages per Gemini call instead of 1 would reduce translation API calls by 80% and save ~12% on cost (~$2.5K at scale), with the primary benefit being 5x throughput at the same Lambda concurrency.

---

## Provenance & Audit Trail

### Where Things Are Logged

| What | Collection | Key Fields |
|------|-----------|------------|
| Every AI call | `gemini_usage` | type, model, book_id, page_ids, tokens, cost, status, job_id |
| Processing jobs | `jobs` | type, status, progress, book_id, page_ids |
| Batch API jobs | `batch_jobs` | type, status, gemini_job_name, book_id, page_ids |
| Admin actions | `audit_log` | action, book_id, timestamp, pages_affected |
| Page content backups | `page_snapshots` | page_id, snapshot_type, ocr_data, translation_data |
| Page revision history | `page_revisions` | page_id, field, content, job_id, source |
| Prompt versions | `prompts` | name, type, version, is_default, text |
| Cron execution | `cron_runs` | cron, duration_ms, status, actions, decisions, errors |
| Pipeline snapshots | `pipeline_snapshots` | timestamp, funnel counts, page totals |
| Entity sync | `entities` | name, type, books[], aliases, book_count, total_mentions |
| GitHub text sync | `source-library-texts` repo | metadata.json, ocr.txt, translation.txt per book |

### Page Revisions (CRITICAL)

`page_revisions` collection preserves EVERY version of OCR and translation — AI, batch, manual, contributor. `createRevision(pageId, field, jobId?)` in `src/lib/page-revisions.ts`. Already integrated into all 7 OCR save paths and all translation save paths.

**Any ad-hoc script that overwrites `ocr.data` or `translation.data` MUST call `createRevision()` first.**

### Reconstructing Page History

To find everything that happened to a specific page:

```javascript
// 1. What AI processed this page?
db.gemini_usage.find({ page_ids: pageId }).sort({ timestamp: 1 })

// 2. What jobs included this page?
db.jobs.find({ 'config.page_ids': pageId }).sort({ created_at: 1 })

// 3. All content revisions
db.page_revisions.find({ page_id: pageId }).sort({ created_at: -1 })

// 4. Were any backups made?
db.page_snapshots.find({ page_id: pageId }).sort({ created_at: -1 })

// 5. What's on the page now?
const page = db.pages.findOne({ id: pageId })
// page.ocr.model, page.ocr.source, page.ocr.prompt_version
// page.translation.model, page.translation.source
```

### Finding What Prompt Was Used

1. Check `page.ocr.prompt_version` (e.g., `v5.2026-02`) — this is the semantic version tag
2. Check `page.ocr.prompt_name` if set — maps to a named prompt in the `prompts` collection
3. Look up the actual text: `db.prompts.findOne({ name: promptName, is_default: true })`
4. For historical prompts: `db.prompts.find({ name: promptName }).sort({ version: -1 })` shows all versions

### Snapshot Protection

Lambda workers create snapshots before overwriting manually-edited content:
- OCR worker: calls `createSnapshotIfNeeded(pageId, 'pre_ocr', jobId)` before saving
- Translation worker: calls `createSnapshotIfNeeded(pageId, 'pre_translate', jobId)` before saving
- Only triggers if `page.ocr.source === 'manual'` or `page.translation.source === 'manual'`
- Snapshots stored in `page_snapshots` collection, restorable via `restoreSnapshot()`

### Book History Timeline

`GET /api/books/{id}/history` assembles a chronological timeline from 6 data sources:
1. Book document (import, summary, index, chapters, editions)
2. `gemini_usage` (all AI calls, grouped by type+hour)
3. `jobs` (processing jobs with progress)
4. `pages` aggregate (archive counts, detected images)
5. `audit_log` (admin actions)
6. `book_metadata_changelog` (field-level metadata diffs)

Deduplication: when a `gemini_usage` record has a `job_id` matching the `jobs` collection, it folds into the job event with cost data rather than appearing separately.

### Known Gaps

1. **No `prompt_version` on pre-Feb-2026 pages** — all 132k OCR pages used the same prompt, but the field wasn't set. Fills in on re-OCR.
2. **Batch API pages have `batch_job_id`** — set by `process-batches` cron on OCR and translation saves. Realtime Lambda pages link via `gemini_usage.job_id` instead.
3. **Lambda translation `gemini_usage` records lack `job_id`** — Writer Lambda defers logging but the job_id linkage is incomplete. Cosmetic issue; translations work fine.
4. **No moderation audit** — annotations auto-approved, no tracking of admin approval/rejection.
5. **OCR-aware image extraction** — `extractWithGemini()` accepts `ocrData` parameter and the worker passes it, but prompt augmentation is not yet implemented. Feature is a no-op.
