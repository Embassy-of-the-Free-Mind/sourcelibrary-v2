# Pipeline Overhaul — March 17, 2026

## What We Did

### 1. Fixed Vercel Pipeline Cron (3 commits merged to main)
- **Bounded completion loops** to 50 books/cycle — Phase 3 (OCR), Phase 5 (translation), image completion all had unbounded `.toArray()` doing 4-6 DB queries per book. With 13K+ jobs, consumed entire 270s time budget.
- **Smooth adaptive limits** — degraded state now reduces by 50% (was: slam to minimums). Recovery ramps 20% after 1 healthy cycle (was: 30% after 2). Only cancels pending jobs on critical.
- **Deferred FT verification** from Phase 0 enrollment to Phase 3.7 — 50 sequential Gemini calls during enrollment consumed 270s.
- Result: cron went from **280s → 3-14s**.

### 2. Cleaned Up Job Backlog
- Cancelled 15,766 pending 0-progress OCR jobs (no Gemini work done)
- Cleared 15,796 book job locks
- Purged 333K SQS message backlog
- Re-enrolled 1,686 recoverable failed books (1,309 quota failures + 372 image download failures + 5 enrich timeouts)

### 3. Fixed Hetzner Batch OCR
- **Root cause:** File upload used hardcoded `getGeminiApiKey(0)` — no rotation on 429. And `createBatchJobFromFile` used Key 0 to reference a file uploaded with Key 1 (files are key-scoped → 404).
- **Fix:** Key rotation on file upload + pass successful key index to batch job creation.
- **Config:** Changed to one batch job per book (`OCR_FILE_BATCH_SIZE = 9999`), always try file-based first, no inline fallback (was creating 700+ small jobs that exceeded 100 concurrent job limit).

### 4. Split Hetzner Pipeline Into Independent Crons
The main orchestrator held a single `flock` across ALL phases, so Phase 4 (inline translation, runs for hours) blocked everything else. Added independent crons:

| Phase | Cron | Lock |
|---|---|---|
| Phase 0: Enrollment | */10 min | `sl-enroll.lock` |
| Phase 1: Archive check | */10 min | `sl-archive-check.lock` |
| Phase 2: OCR submit (batch) | */10 min | `sl-ocr-submit.lock` |
| Phase 3: OCR completion | */10 min | `sl-ocr-complete.lock` |
| Phase 5: Translation completion | */10 min | `sl-translate-complete.lock` |
| Main orchestrator (all phases) | */5 min | `sl-pipeline.lock` |
| Batch collector | */10 min | `sl-collector.lock` |

### 5. Updated Documentation
- Pipeline docs (`.claude/docs/pipeline.md`) — adaptive limits, R2 storage, measured costs, corrected fields
- Image archiving docs — Vercel Blob → Cloudflare R2
- Memory files updated

## Architecture Discovered

**Two pipeline orchestrators were running simultaneously:**
- Vercel `post-import-pipeline` cron (removed from vercel.json in PR #211 for cost savings)
- Hetzner `pipeline-orchestrator.mjs` (2,000 lines, standalone reimplementation)

Vercel cron route exists but is never called. All pipeline work runs on Hetzner. The Vercel code changes (adaptive limits, bounded loops) affected a cron that wasn't running.

**Hetzner orchestrator differences:**
- OCR: Gemini Batch API (50% off) — downloads images locally, builds JSONL
- Translation: Direct Gemini calls inline (no Lambda/SQS)
- No adaptive limits awareness
- No timeout (runs for hours)

## Cost Analysis

**Actual measured per-page costs** (from 4.1M gemini_usage records):

| Phase | $/page | Model |
|---|---|---|
| OCR | $0.0022 | gemini-3-flash-preview |
| Translation | $0.0035 | gemini-3-flash-preview |
| Image extraction | $0.0009 | gemini-3-flash-preview |
| Metadata enrichment | ~$0.007/book | gemini-3-flash-preview |

**Implied Gemini 3 Flash Preview rates:** ~$0.59/1M input, ~$2.87/1M output.

**Remaining work:** 5.5M pages OCR, 6M pages translation = ~$35K at current rates.

**Cost levers identified:**
- Batch API: 50% off OCR → saves ~$6K
- Flash Lite (`gemini-3.1-flash-lite-preview`): 50% off everything → saves ~$17.5K
- Batch + Flash Lite: 75% off → total pipeline cost ~$8K instead of $35K
- Batch translation (issue #217): 5 pages per call → saves ~$2.5K + 5x throughput

## Flash Lite Quality Assessment

Tested `gemini-3.1-flash-lite-preview` against `gemini-3-flash-preview` on Copernicus *De revolutionibus*:

| Feature | Flash | Flash Lite |
|---|---|---|
| Long-s normalization | Yes | Yes (with full prompt) |
| Language tag | `Latin` | `la` (ISO code) |
| Page type detection | Yes | Yes |
| Markdown headings | Yes | No (plain text) |
| Line break preservation | Yes | No (runs together) |
| Bounding boxes | Consistent 0-1 | **Inconsistent** (mixed pixel/normalized) |
| Batch API | Yes | Yes |

**Verdict:** Flash Lite viable for OCR text (with post-processing for `la` → `Latin`). NOT viable for image extraction (bbox format unreliable). Untested for translation.

## Batch API Failure History

| Issue | Root Cause | Impact |
|---|---|---|
| Translation scrambling (Feb 18) | Results returned in arbitrary order, code used array index fallback | 17K pages wrong translations |
| Orphan jobs (Feb 19-20) | Created DB records before Gemini submission succeeded | 553 orphans blocked pipeline 14.8h |
| Quota exhaustion cycles | Cron retried every 10 min creating more orphans | Recurring stalls |
| File upload key mismatch (today) | Upload with Key 1, create job with Key 0 (files key-scoped) | Batch OCR broken for weeks |
| 700 inline jobs (today) | Exceeded 100 concurrent job limit | Jobs stuck PENDING |

**Best practices learned:**
- Fewer larger jobs >> many small jobs
- One job per book via file upload (not 25 inline batches)
- Always use same API key for upload + job creation
- Max 100 concurrent batch jobs
- Preview models (`gemini-3-flash-preview`) have worse batch reliability than stable models
- File upload has separate quota from batch job creation

## Open Issues
- #217: Batch translation (5 pages per Gemini call)
- Batch API file upload quota resets daily — need to monitor
- Flash Lite for OCR decision pending (issue not yet created)
- Hetzner orchestrator patches are local edits, not in git

## Key Files Modified
- `src/lib/adaptive-limits.ts` — proportional reduction, per-queue SQS grading
- `src/app/api/cron/post-import-pipeline/route.ts` — bounded loops, deferred FT verify
- `.claude/docs/pipeline.md` — full update
- `.claude/docs/image-archiving.md` — R2 migration
- Hetzner `scripts/workers/pipeline-orchestrator.mjs` — batch key rotation, file size, inline-only flag (local patches)
