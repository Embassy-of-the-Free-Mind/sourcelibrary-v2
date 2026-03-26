---
name: Image extraction pipeline
description: How image extraction works end-to-end — candidate filtering, Lambda architecture, gallery sync, and backfill for pre-pipeline books
type: feedback
---

## Image Extraction Pipeline

Image extraction runs **through the pipeline**, not separately. The Lambda is the worker, not the orchestrator.

### Architecture

```
Pipeline orchestrator (Hetzner, every 5min) or post-import-pipeline cron (Vercel)
  → finds books at `chapters_complete` status
  → filters pages to IMAGE CANDIDATES ONLY (see below)
  → creates job in `jobs` collection
  → enqueues candidate page IDs to SQS (page-image-extraction-queue)
  → sets book status: `images_submitted`

SQS → image-extraction Lambda (concurrency=10)
  → calls Gemini Flash vision API (extractWithGemini)
  → sends result to write-results SQS queue

Write-results SQS → Writer Lambda
  → writes `detected_images` array to pages collection
  → upserts `gallery_images` collection
  → calls checkJobCompletion() → marks job completed when all pages done

Next orchestrator cycle:
  → sees job.status === 'completed'
  → sets book status: `images_complete` → `complete`
  → triggers thumbnail upgrade (upgradeThumbnailFromGallery)
```

### CRITICAL: Candidate Page Filtering

**NEVER send all pages for image extraction.** Only send pages matching these criteria:

1. `page_type` in `['illustration', 'diagram', 'map', 'frontispiece', 'mixed']`
2. OCR v8+: `significance="high"` in OCR text
3. Pre-v8: `<detected-images>` or `<image-desc>` tags in OCR text

**Why:** Sending all pages wastes Gemini API calls on text-only pages. The Lambda will error on pages with no visual content. In a 2026-03-27 backfill, sending 5,262 unfiltered pages vs 2,214 candidates = 58% waste.

**How to apply:** When writing backfill scripts for image extraction, always use:
```javascript
const IMAGE_TYPES = ['illustration', 'diagram', 'map', 'frontispiece', 'mixed'];
const candidates = await db.collection('pages').find({
  book_id: bookId,
  $or: [
    { page_type: { $in: IMAGE_TYPES } },
    { 'ocr.data': { $regex: '<image-desc>|<detected-images>|significance="high"', $options: 'i' } },
  ]
}).toArray();
```

### Pre-Pipeline Books Need Manual Backfill

Books translated before the pipeline existed never reach `chapters_complete`, so the orchestrator never queues them. As of 2026-03-27: **2,700 books** >50% translated are missing image extraction. Must be backfilled via script (create job + enqueue to SQS directly).

### Cost

Realtime Gemini Flash vision, NOT Batch API. ~$0.001-0.002 per candidate page. Independent pages don't benefit from batch context continuity.

### Gallery Sync

`detected_images` on pages ≠ `gallery_images` collection. The Writer Lambda upserts gallery_images when processing results. For books processed via backfill, gallery entries appear as the Writer Lambda processes each page. The `sync-gallery-images` cron is a separate reconciliation step.

### Key Files

- Orchestrator: `scripts/workers/pipeline-orchestrator.mjs` (Phase 8, lines ~2256-2377)
- Vercel cron: `src/app/api/cron/post-import-pipeline/route.ts` (lines ~825-935)
- Lambda worker: `src/workers/image-extraction-processor.ts`
- Core logic: `src/workers/image-extraction-processor-logic.ts`
- Extraction lib: `src/lib/image-extraction.ts`
- Queue utils: `src/lib/queue-utils.ts`
- Job completion: `src/lib/job-completion.ts`
