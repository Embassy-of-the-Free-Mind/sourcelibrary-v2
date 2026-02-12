# Batch Processing (Gemini Batch API)

## Overview

The Gemini Batch API provides 50% cost savings over realtime processing. Jobs complete within 24 hours (usually faster) with built-in retries and no rate limiting. Used for OCR and translation of large books.

## Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/books/[id]/batch-ocr-async` | POST | Submit OCR batch job |
| `/api/books/[id]/batch-ocr-async` | GET | Check status, collect results |
| `/api/books/[id]/batch-translate-async` | POST | Submit translation batch job |
| `/api/books/[id]/batch-translate-async` | GET | Check status, collect results |
| `/api/cron/process-batches` | GET | Reconciliation cron (every 2 hours) |

## Batch API Client

`src/lib/gemini-batch.ts` — key functions:
- `createBatchJobInline()` — small batches (inline requests)
- `createBatchJobFromFile()` — large batches (uploaded JSONL file)
- `uploadBatchFile()` — upload JSONL for >20MB batches
- `getBatchJobStatus()` — poll job state
- `getBatchJobResults()` — download results
- `cancelBatchJob()` — cancel in-progress job
- `listBatchJobs()` — list all jobs

## Gemini Batch Job States

```
JOB_STATE_PENDING    → Queued
JOB_STATE_RUNNING    → Processing
JOB_STATE_SUCCEEDED  → Results ready
JOB_STATE_FAILED     → Error
JOB_STATE_CANCELLED  → User cancelled
JOB_STATE_EXPIRED    → Exceeded 7-day expiry
```

## Workflow

### Submit
```
POST /api/books/{id}/batch-ocr-async
{ limit?: 10, model?: 'gemini-3-flash-preview', force?: false }
```
- Finds pages without OCR (or all if `force: true`)
- Builds JSONL with image URLs + OCR prompts
- Submits to Gemini Batch API
- Returns `jobName` for polling

### Check & Collect
```
GET /api/books/{id}/batch-ocr-async?jobName=batches/xxx
```
- Polls Gemini for job status
- When `JOB_STATE_SUCCEEDED`: downloads results, saves to pages
- Updates `batch_jobs` record

### Cron Reconciliation
`/api/cron/process-batches` runs every 2 hours:
1. Queries `batch_jobs` with status `pending` or `processing`
2. Checks each job's Gemini status
3. On success: downloads results, saves to pages, updates batch_jobs
4. Handles parent-child job progress aggregation
5. Logs to `gemini_usage`

## Parent-Child Architecture

For large books (500+ pages), jobs split into child batches:
- **Parent job:** tracks overall progress, aggregates child statuses
- **Child jobs:** individual batch submissions (100-300 pages each)
- `updateParentJobProgress()` aggregates child statuses
- Parent transitions to `completed` when all children done

## Database Schema

**`batch_jobs` collection:**
```
id, type ('ocr' | 'translation'), status, book_id, book_title,
total_pages, child_job_ids[], parent_job_id,
progress: { completed, failed, pending, total },
job_name (Gemini operations/xyz), page_ids[], page_count,
model, language, prompt_version, force,
completed_pages, failed_pages, results_collected,
created_at, updated_at, completed_at
```

## Cron Schedule (vercel.json)

```json
{ "path": "/api/cron/process-batches", "schedule": "0 */2 * * *" }
```

## Batch vs Realtime

| | Realtime (Lambda) | Batch (Gemini API) |
|---|---|---|
| Cost | Full price | 50% discount |
| Latency | Seconds per page | Up to 24 hours |
| Context | Previous page translation | No cross-page context |
| Rate limits | Subject to API limits | None |
| Best for | Translation (needs context) | OCR, large books |
