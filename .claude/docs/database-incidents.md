# Database Incident Log — March 2026

23 incidents in one month. Patterns emerge: Atlas connection saturation, missing indexes, orphan state from cancelled jobs, and pipeline workers overwhelming the database.

## Critical Incidents (site outage or multi-day impact)

### Atlas Performance Crisis — Full Site Degradation (Mar 30)
**Symptom:** Browse page 326 seconds. BPH, collection, category pages all timed out. Site effectively down.
**Root Cause:** Toxic index (`idx_translate_worker_pages`) stored full OCR+translation text as index keys on 9.6M pages. 24 concurrent translation jobs caused 16 index updates per page write. WiredTiger dirty cache saturated past 80%, collapsing all queries.
**Fix:** Dropped toxic index, created 4 missing compound indexes on books, reduced translation concurrency, replaced `$facet` with parallel queries.
**Rule:** Never index large text fields. Never use `$facet` for paginated queries.

### Batch OCR Near-Zero for 5 Days (Mar 25-30)
**Symptom:** 2,525 batch jobs killed before completion. OCR throughput near zero.
**Root Cause:** `STALE_HOURS=6` in batch-collector was too aggressive — Gemini batch jobs take 8-9 hours. Every job was killed as "stale" before results arrived.
**Fix:** Stale timeout increased to 24h. API keys rotated.
**Rule:** Stale timeout must be at least 12h for batch API jobs.

### Dashboard Saturated Atlas — 11 Parallel countDocuments (Mar ~20)
**Symptom:** All Vercel routes returned 504. Complete Atlas saturation.
**Root Cause:** Dashboard API fired 11 parallel `countDocuments` on books simultaneously.
**Fix:** Pre-computed snapshots in `system_config`. Never compute counts inline.
**Rule:** Never run `countDocuments` or aggregations inline in Vercel routes. Use snapshots.

## High Severity (pipeline stall or data loss)

### Translation Stalled 12h — Orphan Jobs (Mar 28)
40 books stuck in `translate_submitted` with no job. Adaptive limits cancelled jobs but didn't roll back pipeline status. Translation throughput was zero for 12+ hours.
**Rule:** Job cancellation must always roll back `pipeline_auto.status`.

### 900+ Books Failed — Cloudflare Blocking Hetzner (Mar 28)
Hetzner called Vercel routes; Cloudflare returned JS challenges (403). All enrichment calls failed.
**Rule:** No Hetzner worker should call Vercel routes. All logic runs inline.

### 22K Books Blocked Behind Split Detection Gate (Mar 25-30)
Split limit was 10 books/cycle. At 22K queued, this would take 75 days to clear.
**Rule:** Monitor queue depths. Limits must scale with backlog.

### Portrait Books Rejected — Wrong Projection (Mar 25-30)
`split_checked` field not included in Phase 2 query projection. Guard couldn't determine status of portrait books, blocking OCR for thousands of books.
**Rule:** Query projections must include all fields referenced in downstream logic.

### Silent Health Check Regression (Mar 30)
`git stash pop` on Hetzner silently reverted a health-check fix. Pipeline ran in "degraded" mode for 7 hours, halving throughput.
**Rule:** Never leave uncommitted patches on Hetzner. Check `git diff` before and after every deploy.

### 7-Hour Translation Stall — Crons Commented Out (Mar 30)
Pipeline paused via `processing_control` AND cron commenting. Auto-resume code lives inside the worker — but the cron that starts the worker was disabled.
**Rule:** Never comment out crons to pause. Use `processing_control` only.

### 885 Missing Pages — Upload Failures (Mar 27)
BPH migration marked books complete despite upload failures. Pages silently missing from MongoDB.
**Rule:** Verify DB counts against source counts before marking a book complete.

## Medium Severity (slow queries, data quality)

### `$lookup` Timeout on Pages (Mar 26)
Archive worker joined pages→books with `$lookup` on 9.6M docs. Replaced with two-step query.

### `countDocuments` Timeout (Mar 26)
`countDocuments({})` does a full scan. Use `estimatedDocumentCount()` for totals.

### N+1 Queries — 1000+ findOne Per Run (Mar 27)
BPH migration script did individual `findOne` per book. Fixed with bulk pre-fetch.

### 16MB Document Limit (Mar 27)
2 books exceeded MongoDB's 16MB limit for materialized chapter text. Currently excluded.

### Double Translation — Batch Parser Mismatch (Mar 28)
Gemini returned relative page numbers (1-5), parser expected absolute (491-495). Every batch was silently discarded and re-translated individually, doubling cost.

### 69 Books with Garbled OCR (Mar 30)
Books OCR'd before split detection was operational. Two-page spreads merged into one page of garbled text.

### 123 Stuck Parent Batch Jobs (Mar 30)
Cascading from stale timeout + split detection issues. Orphaned state in MongoDB.

### 4,800 Jobs Dispatched Without Health Check (Mar ~20)
Orchestrator didn't probe Atlas before dispatching. Cluster saturated for hours.

### Timeline Aggregation Hanging (Mar ~20)
No `maxTimeMS`, no supporting index. Hung for 30+ seconds under load.

## Structural Issues (ongoing)

### id vs _id Mismatch — 1,186 Books
Historical import bug. `id` and `_id` diverge by one hex digit. App standardized on `id` for all lookups. Never "fix" pages to match `_id`.

### Collection Size → Warehouse Migration
9.6M pages in one collection. Warehousing moved 7M to `pages_warehouse`, cutting live to ~2.5M.

---

## Recurring Patterns

1. **Missing indexes cause cascading failure.** A single slow query under load can saturate WiredTiger cache, collapsing all queries site-wide.

2. **Job cancellation without status rollback creates orphans.** Every system that cancels a job must roll back the book's `pipeline_auto.status`. This has caused 3 separate multi-hour stalls.

3. **`countDocuments` and `$facet` are dangerous at scale.** Both force full collection processing. Use `estimatedDocumentCount()` for totals, parallel queries instead of `$facet`.

4. **Hetzner patches drift from git.** `git stash pop` silently reverts fixes. Always commit before deploying to Hetzner.

5. **Pipeline backpressure must be proactive, not reactive.** Dispatching work without checking DB health causes outages. The health probe must test representative user-facing queries, not just fast indexed lookups.

6. **Query projections are a silent failure mode.** Missing fields in projections cause downstream logic to silently make wrong decisions.

## What Supabase Now Handles

As of 2026-03-31, the analytics queries that caused incidents #19 and #21 now run against Supabase materialized views. The 11-parallel-countDocuments pattern and slow timeline aggregations are no longer hitting Atlas. The browse probe (#16) now uses `visible: true` with a compound index instead of `hidden: { $ne: true }`.
