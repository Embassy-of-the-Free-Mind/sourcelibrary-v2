# Pipeline Performance Tuning — 2026-04-11/12

## Changes Made

### Books Unhidden (direct DB)
- Unhid 1,493 books that were soft-deleted during earlier collection curation
- Visible books with pages: 8,982 → 10,475
- 35 remain hidden (fungi taxonomy, mushroom guide, Nietzsche, plus 32 off-topic)

### Translation Worker (PR #963, #974)
- Batch size 5 → 8 pages per API call (~60% more pages per round-trip)
- MAX_BATCH_OCR_CHARS 15K → 20K
- CHUNK_DELAY_MS 200 → 50ms (DB write throttle)
- Free-tier KEY_4 excluded from translate-worker (15 RPM too slow, causes 429s)

### Enrich Worker (PR #963)
- Parallelized book processing: BOOK_CONCURRENCY=4 (was sequential)
- Phase 6+7 book limits: 100 → 200 per run
- Phase 7 chapter extraction: gemini-3-flash → gemini-3.1-flash-lite (6x cheaper)
- Throughput: ~50 books/hr → ~67 books/hr

### Orphan Job Fix (PR #967)
- Translate-worker had infinite loop: re-linked orphan jobs for already-translated books every 2 min
- 3,083 accumulated orphan jobs cleaned up
- Fix: exclude translate_complete+ statuses from orphan resume, auto-cancel stale orphan jobs

### API Key Expansion (PR #968, #970)
- Orchestrator now scans GEMINI_API_KEY_2 through _10 (was hardcoded to 3 vars)
- 4 unique keys active on Hetzner (3 Tier 3 + 1 free tier)
- Free-tier key useful for enrichment only (15 RPM)

### Metadata Enrichment Model (PR #970)
- Switched from gemini-3-flash to flash-lite — 2x cost reduction

### Realtime Image Extraction Worker (PR #976)
- NEW: `scripts/workers/image-extract-worker.mjs` — realtime generateContent per page
- Bypasses Batch API entirely (was stalled 24h+ at 0.6% batch processing rate)
- 10 books concurrent, 5 pages/book concurrent, 25-min deadline
- Added to scheduler as Tier 3 worker
- Orchestrator batch path disabled: `IMAGE_EXTRACTION_USE_BATCH=false` on Hetzner
- Result: cleared 2,000+ books and extracted thousands of images in ~2 hours (vs 0 in 24h on batch)

### Critical Bug: job_name vs gemini_job_name Field Mismatch
- Orchestrator writes Gemini batch name as `job_name`
- Collector and zombie queries checked `gemini_job_name`
- Real running jobs appeared as zombies — accidentally cancelled 291 legitimate in-flight OCR jobs
- Fixed: synced job_name → gemini_job_name on 42,494 records
- Restored all 291 jobs
- Lesson recorded in `lesson-zombie-batch-jobs.md`

### Pipeline Cleanup (direct DB)
- 2,341 failed jobs → cancelled (stuck timeouts + PROHIBITED blocks)
- 241 zombie batch jobs → cancelled (never submitted to Gemini)
- 2,775 image extraction jobs stuck in `saved` → `completed`
- Adaptive limits reset to defaults (were heavily downscaled)

### Warehouse Promotion (direct DB)
- Promoted 1,609 books (~694K pages) from warehouse to live pipeline
- 786 books from 16 new collections: psychology, Buddhism, demonology, forbidden books, etc.
- 823 books expanding core collections: alchemy (+235), renaissance philosophy (+148), classical philosophy (+131), SHWEP (+114), medicine (+98), magic (+44), kabbalah (+33), hermetica (+20)
- All set to `enrolled` status, will flow through pipeline automatically
- Estimated: ~43 hours OCR, ~$2,100 total processing cost

## Current State (Apr 12 morning)
- OCR: ~15,700 pages/hr (batch API, draining well now). 229 books in queue + 1,609 newly promoted
- Translation: ~1,356 pages/hr (batch-8). Caught up, will resume when new OCR completes
- Enrichment: ~67 books/hr (parallel). P6 queue ~1,460
- Image extraction: DONE (realtime worker cleared entire queue in 2 hours)
- Pipeline is healthy and well-fed

## Key Lessons
- Batch API throughput is unpredictable — jobs can sit at 0.6% processed for hours
- Realtime API is massively underutilized at Tier 3 (30K RPM, using <500)
- For backlog clearing, realtime wins even at 2x cost — hours vs days
- The `job_name` vs `gemini_job_name` field mismatch is a landmine — ALWAYS check both
- Free-tier keys help enrichment but hurt translation (15 RPM causes 429 storms)
