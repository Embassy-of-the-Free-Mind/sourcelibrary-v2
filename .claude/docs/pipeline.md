# Processing Pipeline

Single source of truth for the full processing pipeline — from import to complete. Last updated: March 6, 2026.

## End-to-End Overview

```
IMPORT → ARCHIVE → OCR → METADATA → TRANSLATE → ENRICH (summary+index) → CHAPTERS → IMAGES → COMPLETE
```

Every step is independent and idempotent. Books can enter at any stage and be re-processed safely. Two crons orchestrate the auto pipeline; each step can also be triggered manually.

| Step | Method | Cost/book | Duration | Automated? |
|------|--------|-----------|----------|------------|
| Import | 13 import APIs | Free | Seconds | Manual |
| Archive | Hetzner script + cron check | Free (bandwidth) | Minutes-hours | Yes |
| OCR | Lambda workers (SQS) or Gemini Batch API | ~$0.10-0.50 | Minutes-hours | Yes |
| Metadata enrich | Gemini realtime (text analysis) | ~$0.005 | Seconds | Yes |
| Translate | Lambda workers (SQS FIFO) | ~$0.10-0.50 | Minutes-hours | Yes |
| Enrich | Gemini realtime (summary + index) | ~$0.05-0.15 | Seconds | Yes |
| Chapters | Gemini realtime | ~$0.02 | Seconds | Yes |
| Images | Lambda workers (SQS) | ~$0.10-0.25 | Minutes-hours | Yes |

---

## Auto Pipeline State Machine

Two crons orchestrate the pipeline:
- **`post-import-pipeline`** (every 10 min) — main orchestrator: import → archive → OCR → metadata → translate. Also handles image extraction, finalization, staleness detection, and zombie cleanup.
- **`enrich-books`** (every 10 min) — dedicated cron for enrichment (summary + index) and chapter extraction. Split out so enrichment doesn't starve translation of time budget.

Each book has a `pipeline_auto` object tracking its state.

### States

```
queued → archiving → archive_complete → ocr_submitted → ocr_complete
  → metadata_enriched → translate_submitted → translate_complete → enriching → enriched
  → chapters → chapters_complete → images_submitted → images_complete → complete
```

Any state can transition to `failed` on persistent errors (after 3 retries). Special states: `empty_shell` (0-page failed imports), `needs_attention` (requires manual intervention), `paused` (manually halted).

| Status | What's happening | Who drives it |
|--------|-----------------|---------------|
| `queued` | Book enrolled, waiting to start | Pipeline cron Phase 0 (auto-enroll) or admin |
| `archiving` | Pages being archived to Vercel Blob | Hetzner script (external) |
| `archive_complete` | All pages archived or no archivable sources | Pipeline cron Phase 1 |
| `ocr_submitted` | Lambda OCR jobs enqueued (or Batch API submitted) | Pipeline cron Phase 2 |
| `ocr_complete` | OCR finished, results saved | Pipeline cron Phase 3 + process-batches cron |
| `metadata_enriched` | AI metadata enrichment complete (language, categories, description, source_work_dates) | Pipeline cron Phase 3.5 |
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
- Staleness detector rolls back books stuck in `*_submitted`/`enriching`/`chapters` states after 48h

### Backpressure Limits

| Resource | Limit | Constant |
|----------|-------|----------|
| Lambda OCR jobs | 50 active | `MAX_ACTIVE_LAMBDA_OCR` |
| Lambda translation jobs | 100 active | `MAX_ACTIVE_LAMBDA_TRANSLATE` |
| Gemini Batch OCR jobs | 200 active | `MAX_ACTIVE_BATCH_OCR` |
| Image extraction jobs | 10 active | `MAX_ACTIVE_IMAGE_JOBS` |
| OCR books per run | 20 | `OCR_SUBMIT_LIMIT` |
| Translation books per run | 50 | `TRANSLATE_SUBMIT_LIMIT` |
| Metadata enrichment per run | 20 | `METADATA_ENRICH_LIMIT` |
| Enrichment per run | 30 | `ENRICH_LIMIT` (enrich-books cron) |
| Chapter extraction per run | 20 | `CHAPTER_LIMIT` (enrich-books cron) |
| Image extraction per run | 5 | `IMAGE_SUBMIT_LIMIT` |
| Finalization per run | 50 | `FINALIZE_LIMIT` |
| Auto-enroll per run | 50 | `ENROLL_LIMIT` |
| Lambda OCR fallback per run | 10 | `LAMBDA_FALLBACK_LIMIT` |

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
  translate_job_name?: string;   // Gemini Batch API job name
  ocr_batch_id?: string;        // batch_jobs collection ID
  translate_batch_id?: string;   // batch_jobs collection ID
  image_extraction_job_id?: string; // jobs collection ID
  last_updated?: Date;
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
| 4 | Staleness detection | Roll back stuck books | 48h timeout on `*_submitted`, `enriching`, `chapters`. Checks for active jobs before rolling back. |
| 5 | Zombie job detection | Force-complete stuck jobs | Jobs in `processing` for >24h. |

**Staleness rollback map:**
- `ocr_submitted` → `archive_complete`
- `translate_submitted` → `metadata_enriched`
- `images_submitted` → `chapters_complete`
- `enriching` → `translate_complete`
- `chapters` → `enriched`

### Main Pass (standard pipeline order)

| Order | Phase | Transition | Notes |
|-------|-------|-----------|-------|
| 6 | Phase 0: Auto-enroll | new → `queued` | Books imported within 7 days without `pipeline_auto`. |
| 7 | Phase 1: Archive check | `queued` → `archiving` → `archive_complete` | DB checks only; Hetzner does archiving. 24h timeout. Fixes stale thumbnails. |
| 8 | Phase 2: Submit OCR | `archive_complete` → `ocr_submitted` | Primary: Lambda workers. Fallback: Batch API. See "OCR Routing" below. |
| 9 | Phase 3: OCR completion | `ocr_submitted` → `ocr_complete` | Checks both Lambda jobs and batch_jobs. Loops if un-OCR'd pages remain (up to MAX_RETRIES). Blocked by `ocrPaused`. |
| 10 | Phase 3.5: Metadata enrichment | `ocr_complete` → `metadata_enriched` | Calls `enrichBookMetadata()`. Detects language, categories, year, description, display_title, source_work_dates. Non-blocking: failures skip ahead. |
| 11 | Phase 4: Submit translation | `metadata_enriched` → `translate_submitted` | Lambda FIFO queue only. See "Translation Routing" below. |
| 12 | Phase 5: Translation completion | `translate_submitted` → `translate_complete` | Checks Lambda jobs. Loop limit: `max(6, ceil(pages_count/200))`. Blocked by `translatePaused`. |

### Safety Mechanisms

- **Early flush:** Writes partial `cron_runs` record at 240s (before Vercel's 300s kill) so observability isn't lost
- **Pipeline snapshots:** Writes funnel counts to `pipeline_snapshots` collection at end of run
- **MongoDB reconnect:** Catches connection errors, attempts `forceReconnect()`, returns 200 with partial results
- **Time budget:** 270s working window; each phase checks `hasTimeBudget()` before starting

---

## Enrich-Books Cron

**Route:** `/api/cron/enrich-books` (230 lines, `maxDuration = 300`)

Split out from the pipeline cron so enrichment doesn't starve translation of time budget. Runs every 10 min.

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

---

## OCR Routing

The pipeline cron has two OCR backends. Currently, Lambda is the default (hardcoded `ocrQuotaExhausted = true` at line 788 forces Lambda fallback).

### Lambda Workers (current default)

- OCR worker processes ONE page per Lambda invocation via SQS standard queue (parallel)
- Concurrency: 10 reserved Lambda instances
- Results written to write-results SQS queue → Writer Lambda → MongoDB
- Backpressure: max 50 active Lambda OCR jobs (`MAX_ACTIVE_LAMBDA_OCR`)
- Lambda fallback limit: 10 books per cron run

### Gemini Batch API (available, not primary)

- Submit JSONL with all page requests → Gemini processes asynchronously
- 50% cost discount, but latency up to 24 hours
- Results collected by `process-batches` cron (every 2 hours)
- Parent-child architecture for 500+ page books
- Backpressure: max 200 active batch jobs (`MAX_ACTIVE_BATCH_OCR`)

### Consecutive Failure Fallback

If 3+ consecutive batch submissions return HTTP 500, the cron automatically switches to Lambda for the rest of that run (`CONSECUTIVE_FAILURE_THRESHOLD = 3`).

---

## Translation Routing

**CRITICAL: Translation ALWAYS uses Lambda workers (SQS FIFO queue). NEVER use Gemini Batch API for translation.** Batch API lacks cross-page context continuity which is critical for translation quality.

- Translation worker uses FIFO queue (sequential per job) — fetches previous page's translation for context
- Hardcoded `translateQuotaExhausted = true` at line 1161 forces Lambda
- Concurrency: max 100 active Lambda translation jobs (`MAX_ACTIVE_LAMBDA_TRANSLATE`)
- Current temporary filter: only translates books >=90% done (based on `pages_translated / pages_ocr`)

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

- 1,552 books have gallery images
- 73,732 total gallery images extracted
- Gallery sync cron (`sync-gallery-images`, every 6h) keeps gallery metadata fresh

### No Dedicated Handoff Documentation

Image extraction was implemented incrementally across multiple sessions. Key references:
- Worker architecture: `.claude/docs/worker-architecture.md`
- Gallery thumbnail fixes: `.claude/handoffs/2026-02-23-gallery-thumbnail-fixes.md`
- Audit trail & worker fixes: `.claude/handoffs/2026-02-08-audit-trail-worker-fixes.md`

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
| `archive-ocr` | Every 4 hours | Archives page images to Vercel Blob for OCR'd pages | Data safety |
| `social-post` | Every hour | Posts queued tweets | Social media |
| `social-reset` | Daily midnight UTC | Resets daily tweet counter | Social media |

**Historical note:** `submit-ocr` cron was removed Mar 5, 2026 — it was redundant with the pipeline cron and wasted DB queries.

### Interaction Pattern

```
post-import-pipeline: submit jobs → check jobs/batch_jobs → advance books
enrich-books:         enrichment (summary+index) → chapter extraction
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
- Syncs book to GitHub (non-blocking)

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
| `pages[].archived_photo` | If images were archived to Vercel Blob |
| `pages[].page_type` | If OCR was done with v4+ prompt |
| `pages[].columns` | If page has 2+ text columns |
| `source_work_dates` | Compositional timeline layers (set by Phase 3.5 metadata enrichment) |
| `source_work_dates_meta` | Enrichment metadata (model, confidence, reasoning) |

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

Based on `gemini-3-flash-preview` pricing ($0.50/1M input, $3.00/1M output):

| Step | Input tokens/page | Output tokens/page | Cost/page | 300-page book |
|------|-------------------|-------------------|-----------|---------------|
| OCR | ~1,500 (image) | ~500 | $0.0023 | $0.68 |
| OCR (batch) | ~1,500 | ~500 | $0.0011 | $0.34 |
| Translation | ~800 | ~600 | $0.0022 | $0.66 |
| Summary + Index | ~50k (all text) | ~5k | $0.040 | $0.04 |
| Chapter extraction | ~10k (headings) | ~2k | $0.011 | $0.01 |
| Image extraction | ~1,500/page | ~300 | $0.0016 | $0.49 |

**Typical full pipeline cost for a 300-page book (Lambda):** ~$1.90

**Budget planning:** At ~$0.006/page average across all steps, 1,000 pages costs roughly $6.

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
