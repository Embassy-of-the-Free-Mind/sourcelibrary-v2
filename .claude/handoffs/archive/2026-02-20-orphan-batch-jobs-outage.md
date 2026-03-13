# Postmortem: Orphan Batch Jobs Pipeline Outage

**Date:** 2026-02-20
**Duration:** ~14.8 hours (2026-02-19 17:10 UTC – 2026-02-20 08:00 UTC)
**Severity:** Medium — new OCR submissions blocked, downstream processing unaffected
**Status:** Resolved, root cause fixed and deployed

---

## Summary

553 orphan `batch_jobs` records with no corresponding Gemini API jobs accumulated over ~15 hours, triggering the pipeline's backpressure mechanism and blocking all new OCR submissions. The orphans were created by a "create-before-success" bug in the multi-batch OCR submission path — parent tracking records were written to MongoDB before child batch jobs were successfully submitted to Gemini. When Gemini quota was exhausted mid-submission, parents were left as orphans counting as "pending" jobs.

---

## Timeline

| Time (UTC) | Event |
|------------|-------|
| Feb 19 ~17:00 | Bulk OCR submission begins via `submit-batch-ocr.mjs`. First orphans created (7 jobs, 1,958 pages) |
| Feb 19 18:00 | 9 more orphans (2,169 pages) — quota starting to hit intermittently |
| Feb 19 21:00 | 8 orphans (2,268 pages) |
| Feb 20 00:00 | 16 orphans (1,619 pages) — pipeline cron starts hitting quota too |
| Feb 20 01:00 | **426 orphans** (138,177 pages) — massive escalation as pipeline cron repeatedly tries and fails |
| Feb 20 02:00 | 87 orphans (28,343 pages) — quota fully exhausted, submissions stop |
| Feb 20 ~08:00 | Outage discovered, investigation begins |
| Feb 20 ~08:15 | Root cause identified: create-before-success in multi-batch path |
| Feb 20 ~08:30 | Pipeline paused via emergency stop (`system_config.processing_control.paused = true`) |
| Feb 20 ~08:35 | 553 orphan batch_jobs marked as `failed`, 496 books reset from `ocr_submitted` → `archive_complete` |
| Feb 20 ~09:00 | Root cause fix deployed to Vercel (restructured to submit-then-record pattern) |

---

## Impact

### What broke
- **553 orphan batch_jobs** representing 174,534 phantom pages stuck in `pending` status
- **Backpressure permanently triggered:** 514 pending jobs >> 50-job limit, preventing all new OCR submissions
- **496 books stuck** at `ocr_submitted` with no actual Gemini job processing them
- **143 stuck jobs** (>6h in pending/processing state)

### What kept working
- **Downstream processing continued:** 200 books reached `complete` status during the outage
- **657 OCR batch jobs** were collected and saved (results from pre-outage submissions)
- **Translation pipeline:** unaffected
- **Site availability:** API responded (though slowly — 500 status, 90s response on health check at peak)

### What didn't happen
- No data loss — orphan records are tracking records only, no page content was affected
- No incorrect OCR results — pages either got processed or didn't
- No user-visible impact — the site remained accessible

---

## Root Cause

The `batch-ocr-async` route's multi-batch path (for books with 500+ pages) had this flow:

```
1. Create parent batch_jobs record in MongoDB (status: 'processing')
2. For each child batch:
   a. Create child batch_jobs record in MongoDB
   b. Submit child to Gemini Batch API
   c. If submission fails → continue to next child (parent already exists)
3. Update parent with child references
```

**The bug:** Step 1 creates the parent record BEFORE any children are submitted to Gemini. If Gemini returns a quota error at step 2b, the parent record already exists with `child_job_ids: []` and no `job_name`. This orphan:
- Counts as a "pending" job in backpressure checks
- Will never complete (no Gemini job to poll)
- Blocks future submissions by inflating the active job count

This is the same "create-before-success" anti-pattern documented from the Feb 18 incident with `bulk-reocr-local.mjs` (126 orphans). The pattern was fixed in that script but the same bug existed in the main API route.

### Amplification factor

The pipeline cron runs every 10 minutes. Each run:
1. Checks backpressure → sees orphans but they're below the threshold initially
2. Tries to submit OCR for next books → hits quota → creates MORE orphans
3. Repeat every 10 minutes

This created a feedback loop: orphans → cron tries harder → more orphans → backpressure triggers → complete blockage. The Feb 20 01:00 UTC spike (426 orphans in one hour = ~7 orphans per cron run) shows this amplification clearly.

---

## Fix

### Immediate (cleanup)
1. Paused pipeline cron via emergency stop
2. Marked 553 orphan `batch_jobs` as `failed` with error message "orphan - never submitted to Gemini"
3. Reset 496 books from `ocr_submitted` back to `archive_complete`
4. Verified backpressure dropped from 514 to 1 pending job

### Root cause (code change)
Restructured the multi-batch path in `src/app/api/books/[id]/batch-ocr-async/route.ts` to a two-phase submit-then-record pattern:

```
Phase 1: Submit ALL children to Gemini (no DB writes)
  - If any child fails → error propagates, no orphan records created

Phase 2: All children submitted → create DB records
  - Create child batch_jobs records (with valid job_names)
  - Create parent record last (references all children)
```

This ensures no MongoDB records exist unless Gemini has accepted the corresponding batch jobs.

**Deployed:** 2026-02-20 ~09:00 UTC via `vercel --prod`

---

## Lessons Learned

### What went well
- Downstream pipeline (translation, enrichment, completion) was unaffected — architectural isolation worked
- Emergency stop mechanism (`system_config.processing_control`) existed and worked immediately
- Root cause was identified quickly from the orphan pattern (no `job_name`, empty `child_job_ids`)

### What went wrong
- **Same bug, different location:** The create-before-success anti-pattern was fixed in `bulk-reocr-local.mjs` on Feb 18 but the identical pattern in the main API route wasn't caught
- **No orphan detection:** No monitoring or alerting for batch_jobs with no `job_name` or empty `child_job_ids`
- **Cron amplified the problem:** The pipeline cron kept retrying and creating more orphans instead of backing off on quota errors
- **Quota errors not propagated cleanly:** The multi-batch path caught quota errors per-child but didn't abort the parent creation

### Action items

| Priority | Item | Status |
|----------|------|--------|
| P0 | Fix create-before-success in batch-ocr-async | Done |
| P1 | Resume pipeline (unpause emergency stop) | Pending — waiting for user |
| P2 | Add orphan detection: flag batch_jobs with no `job_name` after 1 hour | Not started |
| P2 | Add quota-aware backoff to pipeline cron (skip OCR submission on recent quota errors) | Not started |
| P3 | Audit other batch submission paths for same pattern | Not started |

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Orphan batch_jobs created | 553 |
| Phantom pages in orphan jobs | 174,534 |
| Books stuck at ocr_submitted | 496 |
| Hours pipeline blocked | 14.8 |
| Books completed during outage | 200 |
| OCR batch jobs collected during outage | 657 |
| Data loss | 0 |
