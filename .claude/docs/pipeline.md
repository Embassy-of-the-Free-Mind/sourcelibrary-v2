# Processing Pipeline

Single source of truth for the full processing pipeline — from import to complete.

## End-to-End Overview

```
IMPORT → ARCHIVE → OCR → TRANSLATE → ENRICH (summary+index) → CHAPTERS → IMAGES → COMPLETE
```

Every step is independent and idempotent. Books can enter at any stage and be re-processed safely. The auto pipeline (cron) drives books through all stages; each step can also be triggered manually.

| Step | Method | Cost/book | Duration | Automated? |
|------|--------|-----------|----------|------------|
| Import | 13 import APIs | Free | Seconds | Manual |
| Archive | Hetzner script + cron check | Free (bandwidth) | Minutes-hours | Yes |
| OCR | Gemini Batch API | ~$0.10-0.50 | Hours | Yes |
| Metadata enrich | Gemini realtime (text analysis) | ~$0.005 | Seconds | Yes |
| Translate | Gemini Batch API | ~$0.10-0.50 | Hours | Yes |
| Enrich | Gemini realtime (summary + index) | ~$0.05-0.15 | Seconds | Yes |
| Chapters | Gemini realtime | ~$0.02 | Seconds | Yes |
| Images | Lambda workers | ~$0.10-0.25 | Minutes-hours | Yes |

---

## Auto Pipeline State Machine

The cron at `/api/cron/post-import-pipeline` (every 10 min) orchestrates the pipeline. Each book has a `pipeline_auto` object tracking its state.

### States

```
queued → archiving → archive_complete → ocr_submitted → ocr_complete
  → metadata_enriched → translate_submitted → translate_complete → enriching → enriched
  → chapters → chapters_complete → images_submitted → images_complete → complete
```

Any state can transition to `failed` on persistent errors (after 3 retries).

| Status | What's happening | Who drives it |
|--------|-----------------|---------------|
| `queued` | Book enrolled, waiting to start | Cron Phase 0 (auto-enroll) or admin |
| `archiving` | Pages being archived to Vercel Blob | Hetzner script (external) |
| `archive_complete` | All pages archived or no archivable sources | Cron Phase 1 |
| `ocr_submitted` | Gemini Batch API job submitted for OCR | Cron Phase 2 |
| `ocr_complete` | OCR batch job finished, results saved | Cron Phase 3 + process-batches cron |
| `metadata_enriched` | AI metadata enrichment complete (language, categories, description) | Cron Phase 3.5 |
| `translate_submitted` | Gemini Batch API job submitted for translation | Cron Phase 4 |
| `translate_complete` | Translation batch job finished | Cron Phase 5 + process-batches cron |
| `enriching` | Summary + index generation in progress | Cron Phase 6 |
| `enriched` | Summary + index complete | Cron Phase 6 |
| `chapters` | Chapter extraction in progress | Cron Phase 7 |
| `chapters_complete` | Chapters extracted (or skipped for short books) | Cron Phase 7 |
| `images_submitted` | Image extraction job queued to Lambda | Cron Phase 8 |
| `images_complete` | All pages scanned for illustrations | Cron Phase 8 |
| `complete` | Fully processed | Cron Phase 9 |
| `failed` | Persistent error after 3 retries | Any phase |

### Failure Handling

- Each phase retries up to 3 times before marking `failed`
- Chapter extraction is **non-critical**: on persistent failure, the book skips to `chapters_complete` (won't block the rest of the pipeline)
- Failed books can be re-enrolled: `POST /api/admin/enroll-pipeline { reEnrollFailed: true }`

### Backpressure

- OCR/translation: no explicit backpressure (Gemini Batch API handles queuing)
- Image extraction: max 5 concurrent jobs — cron skips submission if 5+ active jobs exist
- Per-run limits: OCR 20, translate 10, enrich 5, chapters 5, images 3, finalize 10

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

## Prompt Selection

### OCR Prompts

`getOcrPrompt(language, options?)` in `src/lib/prompts.ts`

The default OCR prompt is fetched from the `prompts` collection (type: `ocr`, `is_default: true`). The `{language_instruction}` placeholder is filled based on whether a language is provided.

**DB prompt families:**

| Name | Current Version | Use Case |
|------|----------------|----------|
| Standard OCR | v5 | Most books (all languages not listed below) |
| Latin OCR (Neo-Latin) | v3 | Latin texts — abbreviation expansion, classical conventions |
| German OCR (Fraktur) | v3 | German Fraktur/Kurrent texts |

**Caller is responsible for specifying the prompt name.** The default (no name) uses Standard OCR. Language-specific routing (choosing Latin or German prompt by language field) happens at the call site, not in `getOcrPrompt()`.

All prompts produce:
- `<page-type>...</page-type>` — classification (text, illustration, table_of_contents, etc.)
- `<columns>N</columns>` — number of text columns
- `<column-break/>` — inline marker between columns
- `<detected-images>...</detected-images>` — bounding boxes for illustrations

### Translation Prompts

`getTranslationPrompt(sourceLanguage, targetLanguage?, options?)` in `src/lib/prompts.ts`

**English short-circuit:** If `sourceLanguage === 'english'`, returns `ENGLISH_MODERNIZATION_PROMPT` (Early Modern English → Modern English). No DB lookup.

Otherwise, fetches from `prompts` collection (type: `translation`, `is_default: true`) and substitutes `{sourceLanguage}` and `{targetLanguage}`.

**DB translation prompt families:**

| Name | Use Case |
|------|----------|
| Standard Translation | General translation to English |
| Latin Translation | Neo-Latin conventions |
| German Translation | Early Modern German |

### Prompt Versioning

`PROMPT_VERSION` constant in `src/lib/types/prompts/defaults.ts` (currently `v4.2026-02`). Stored on every page record for traceability.

Prompts in the `prompts` collection are **immutable** — updates create new versions (auto-incrementing), old versions are never modified. The `is_default` flag marks the active version.

---

## Job Systems

Two parallel systems for processing pages:

### Realtime (Lambda/SQS)

- **3 workers:** OCR, Translation, Image Extraction
- Each processes **one page** per Lambda invocation
- Translation uses **FIFO queue** (sequential per job) for context continuity
- OCR and image extraction use **standard queues** (parallel)
- Workers call `checkJobCompletion()` to transition jobs
- **Cost:** Full Gemini API price
- **Latency:** Seconds per page
- **Best for:** Translation (needs previous page context), image extraction

### Batch (Gemini Batch API)

- Submit JSONL with all page requests → Gemini processes asynchronously
- Results collected by `process-batches` cron (every 2 hours)
- **Cost:** 50% discount on Gemini API price
- **Latency:** Up to 24 hours (usually faster)
- **Best for:** OCR, large books
- Parent-child architecture for 500+ page books

### When Each Is Used

| Step | Auto Pipeline | Manual |
|------|--------------|--------|
| OCR | Batch API (via `batch-ocr-async`) | Either (routes exist for both) |
| Translation | Batch API (via `batch-translate-async`) | Either |
| Image Extraction | Lambda/SQS (via `queue-books`) | Lambda/SQS |
| Summary/Index | Realtime HTTP (via `/api/books/{id}/index`) | Same |
| Chapters | Realtime inline (shared function) | POST `/api/books/{id}/extract-chapters` |

---

## Cron Architecture

Nine crons, all defined in `vercel.json`:

| Cron | Schedule | Purpose | Pipeline Role |
|------|----------|---------|---------------|
| `post-import-pipeline` | Every 10 min | Main orchestrator — advances books through all phases | Core |
| `process-batches` | Every 2 hours | Collects Gemini Batch API results, saves to pages | OCR/translate completion |
| `sync-page-counts` | Every 6 hours | Refreshes `pages_count`, `pages_ocr`, `pages_translated` caches on books | Data integrity |
| `archive-ocr` | Every 4 hours | Archives OCR text to backup storage | Data safety |
| `submit-batch-ocr` | Daily 3 AM UTC | Campaign-driven batch OCR submission | Batch processing |
| `submit-ocr` | Every 10 min | Processes OCR submission queue | Batch processing |
| `sync-gallery-images` | Every 6 hours | Syncs gallery image metadata | Gallery |
| `social-post` | Every hour | Posts queued tweets | Social media |
| `social-reset` | Daily midnight UTC | Resets daily tweet counter | Social media |

### Interaction Pattern

The `post-import-pipeline` cron **submits** OCR/translation batch jobs but doesn't collect results. The `process-batches` cron **collects** results from Gemini. The pipeline cron then detects completion (by checking `batch_jobs` status) and advances the book to the next phase.

```
post-import-pipeline: submit batch → check batch_jobs → advance
process-batches:      poll Gemini → save page results → update batch_jobs
```

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

### OCR (Batch API — 50% cheaper)
```bash
curl -X POST https://sourcelibrary.org/api/books/BOOK_ID/batch-ocr-async \
  -H "Content-Type: application/json" \
  -d '{"limit": 500}'
```

### OCR (Realtime Lambda)
```bash
curl -X POST https://sourcelibrary.org/api/jobs/queue-books \
  -H "Content-Type: application/json" \
  -d '{"bookIds":["BOOK_ID"], "action":"ocr"}'
```

### Translation (Batch API)
```bash
curl -X POST https://sourcelibrary.org/api/books/BOOK_ID/batch-translate-async \
  -H "Content-Type: application/json"
```

### Translation (Realtime Lambda)
```bash
curl -X POST https://sourcelibrary.org/api/jobs/queue-books \
  -H "Content-Type: application/json" \
  -d '{"bookIds":["BOOK_ID"], "action":"translation"}'
```

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

---

## Cost Estimates

Based on `gemini-3-flash-preview` pricing ($0.50/1M input, $3.00/1M output):

| Step | Input tokens/page | Output tokens/page | Cost/page | 300-page book |
|------|-------------------|-------------------|-----------|---------------|
| OCR | ~1,500 (image) | ~500 | $0.0023 | $0.68 |
| OCR (batch) | ~1,500 | ~500 | $0.0011 | $0.34 |
| Translation | ~800 | ~600 | $0.0022 | $0.66 |
| Translation (batch) | ~800 | ~600 | $0.0011 | $0.33 |
| Summary + Index | ~50k (all text) | ~5k | $0.040 | $0.04 |
| Chapter extraction | ~10k (headings) | ~2k | $0.011 | $0.01 |
| Image extraction | ~1,500/page | ~300 | $0.0016 | $0.49 |

**Typical full pipeline cost for a 300-page book (batch API):** ~$1.20

**Budget planning:** At ~$0.004/page average across all steps, 1,000 pages costs roughly $4.

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
| Prompt versions | `prompts` | name, type, version, is_default, text |

### Reconstructing Page History

To find everything that happened to a specific page:

```javascript
// 1. What AI processed this page?
db.gemini_usage.find({ page_ids: pageId }).sort({ timestamp: 1 })

// 2. What jobs included this page?
db.jobs.find({ 'config.page_ids': pageId }).sort({ created_at: 1 })

// 3. Were any backups made?
db.page_snapshots.find({ page_id: pageId }).sort({ created_at: -1 })

// 4. What's on the page now?
const page = db.pages.findOne({ id: pageId })
// page.ocr.model, page.ocr.source, page.ocr.prompt_version
// page.translation.model, page.translation.source
```

### Finding What Prompt Was Used

1. Check `page.ocr.prompt_version` (e.g., `v4.2026-02`) — this is the semantic version tag
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

`GET /api/books/{id}/history` assembles a chronological timeline from 5 data sources:
1. Book document (import, summary, index, editions)
2. `gemini_usage` (all AI calls, grouped by type+hour)
3. `jobs` (processing jobs with progress)
4. `pages` aggregate (archive counts, detected images)
5. `audit_log` (admin actions)

Deduplication: when a `gemini_usage` record has a `job_id` matching the `jobs` collection, it folds into the job event with cost data rather than appearing separately.

### Known Gaps

1. **No `prompt_version` on pre-Feb-2026 pages** — all 132k OCR pages used the same prompt, but the field wasn't set. Fills in on re-OCR.
2. **Batch API pages have `batch_job_id`** — set by `process-batches` cron on OCR and translation saves. Realtime Lambda pages link via `gemini_usage.job_id` instead.
3. **Chapter extraction** — logged as `type: 'extract_chapters'` in `gemini_usage`. Shows in history timeline.
4. **No moderation audit** — annotations auto-approved, no tracking of admin approval/rejection.
