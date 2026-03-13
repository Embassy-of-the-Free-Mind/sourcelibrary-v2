# Gemini Batch API Quota Waste — Root Cause Analysis & Fixes

**Date:** 2026-02-24
**Trigger:** All 3 Gemini API keys (primary, KEY_2, TIER3) quota-exhausted simultaneously
**Commit:** `30e4529` — "Fix 5 major quota waste vectors in pipeline orchestrator"

## Symptoms

- All 3 API keys returned 429 RESOURCE_EXHAUSTED for batch job creation
- ~1,581 batch jobs submitted in 48h, 91% were exactly 20 pages each (1,445/1,581)
- 55,773 total pages submitted across those jobs
- Books being OCR'd multiple times despite Gemini completing the work

## Root Cause

The pipeline treated "pages without OCR in MongoDB" as definitively needing OCR. But pages can temporarily lack OCR because:

1. **Gemini batch job is still running** — results not yet available
2. **Results haven't been collected yet** — batch collector runs every 10 min, orchestrator every 5 min
3. **Collector used wrong API key** — results invisible (historical, fixed Feb 19)

All three scenarios triggered resubmission of work already done or in progress.

## Five Quota Waste Vectors Found

### 1. OCR Loop Resubmission (CRITICAL)
**Location:** `pipeline-orchestrator.mjs` Phase 3 (line ~757), `post-import-pipeline/route.ts` (line ~625)

When batch OCR completes but some pages still lack `ocr.data` in MongoDB, the book rolls back to `archive_complete`, triggering complete resubmission. But pages may lack OCR simply because the **collector hasn't saved results yet** — Gemini finished, but results sit in `batch_jobs` with status `completed` (not `saved`).

Up to 3 loops per book = 4x total submissions for the same pages.

**Fix:** Before rolling back, check `batch_jobs` for uncollected results (status `pending`/`processing`/`completed`). If any exist, wait instead of resubmitting.

### 2. Staleness Rollback Creates Duplicates (MAJOR)
**Location:** `pipeline-orchestrator.mjs` Phase 8.5 (line ~1208), `post-import-pipeline/route.ts` (line ~299)

Books stuck in `ocr_submitted`/`translate_submitted` for >48h get rolled back to previous state. The original Gemini batch job is NOT cancelled — may still be running or awaiting collection. Rollback triggers new submission = duplicate work.

**Fix:** Before rolling back, check if the book has active/uncollected `batch_jobs`. If so, extend the staleness window instead of rolling back.

### 3. No Duplicate Submission Guard (MAJOR)
**Location:** `submitOcrDirectly()` in `pipeline-orchestrator.mjs` (line ~336)

Nothing prevented submitting a new batch when one already existed for the same book. This amplified problems 1 and 2.

**Fix:** Added guard at top of `submitOcrDirectly()` — checks for existing active batch_jobs and returns `skippedDuplicate: true` if any exist.

### 4. Translation Loop Resubmission (MEDIUM)
**Location:** `pipeline-orchestrator.mjs` Phase 5 (line ~971), `post-import-pipeline/route.ts` (line ~835)

Same pattern as OCR loop but for translation.

**Fix:** Same uncollected-results guard.

### 5. Finalize Reset with retry_count: 0 (MEDIUM)
**Location:** `pipeline-orchestrator.mjs` Phase 9 (line ~1286), `post-import-pipeline/route.ts` (line ~181)

Books reaching finalize with 0 OCR pages got `retry_count` reset to 0 and sent back to `archive_complete`. This reset the circuit breaker, allowing 3 MORE OCR submission cycles. A single book could get up to 7 full OCR submissions.

**Fix:** Changed to `needs_attention` status — requires manual investigation instead of infinite retry loops.

## Additional Optimization (Same Session)

**Batch size:** Changed from 20 pages/batch (inline) to 150 pages/batch (file-based) for books >20 pages. This is a 7.5x improvement in job count per quota unit.

**Commit:** `84aba2a` — "Optimize Gemini batch quota: file-based submission for >20 pages"

Both `pipeline-orchestrator.mjs` and `bulk-reocr-local.mjs` updated.

## Files Modified

- `scripts/workers/pipeline-orchestrator.mjs` — All 5 fixes + file-based batch submission
- `src/app/api/cron/post-import-pipeline/route.ts` — Fixes 2-5 (Vercel cron mirror)
- `scripts/batch/bulk-reocr-local.mjs` — File-based batch submission

## Deployed

- Hetzner: `git pull` at `/root/sourcelibrary`
- Vercel: `vercel --prod`

## Validation Plan

When Gemini quota resets (~24h after exhaustion):

1. Monitor `batch_jobs` creation rate — should see far fewer jobs for same page count
2. Check for "Waiting for collector" log lines in orchestrator output — proves Fix 1 is working
3. Check for "Skipping (active batch exists)" log lines — proves Fix 3 is working
4. Monitor `cron_runs` for `skip` decisions in staleness phase — proves Fix 5 is working
5. Compare daily quota usage before/after: should see 3-10x reduction

### Key Metrics to Track

```javascript
// Jobs per day (should drop dramatically)
db.batch_jobs.countDocuments({ created_at: { $gte: new Date('2026-02-25') }, type: 'ocr' })

// Pages per job (should be ~150 instead of ~20 for file-based)
db.batch_jobs.aggregate([
  { $match: { created_at: { $gte: new Date('2026-02-25') } } },
  { $group: { _id: null, avgPages: { $avg: '$page_count' }, totalJobs: { $sum: 1 } } }
])

// Duplicate submissions (should be 0)
db.batch_jobs.aggregate([
  { $match: { created_at: { $gte: new Date('2026-02-25') }, type: 'ocr' } },
  { $group: { _id: '$book_id', count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
  { $count: 'books_with_duplicates' }
])
```

## Historical Context

This is the latest in a series of batch pipeline incidents:
- **Feb 18:** 2,129 stale "processing" batch_jobs (collection script didn't update status)
- **Feb 19:** 704 invisible batch jobs (wrong API key visibility)
- **Feb 19:** MongoDB connection storm from cron + manual submission
- **Feb 20:** 553 orphan batch_jobs blocked pipeline for 14.8h
- **Feb 24:** All 3 keys quota-exhausted from duplicate submissions (this incident)

The common thread: the pipeline's assumptions about batch job lifecycle don't account for the asynchronous nature of the Gemini Batch API. Results take hours to appear, and the collector runs on a separate schedule from the orchestrator. Without guards, the orchestrator resubmits work faster than the collector can save it.
