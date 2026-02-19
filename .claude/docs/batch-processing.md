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

## Local Bulk Processing

For large-scale re-OCR operations that exceed Vercel's 60s timeout, use the local script:

```bash
secret-lover run -- node scripts/bulk-reocr-local.mjs --offset=0 --limit=10
```

**Script:** `scripts/bulk-reocr-local.mjs`

Key features:
- Runs locally (no Vercel timeout limits)
- Processes books sorted by `read_count` desc
- Language-specific prompt selection (Latin, German, Standard)
- Downloads images in parallel (20 concurrent)
- Uses **inline batch submission** (no file uploads)
- Detects quota exhaustion and stops early
- Records `batch_jobs` and `gemini_usage` in MongoDB
- Results collected by the `process-batches` cron automatically

Options: `--offset`, `--limit`, `--pages`, `--dry-run`, `--book-id`, `--new-only`, `--provider`

See `~/.claude/skills/daily-sourcelibrary/skill.md` for full documentation.

## Inline vs File-Based Submission

Two ways to submit batch jobs to Gemini:

| | Inline | File-based |
|---|---|---|
| Function | `createBatchJobInline()` | `createBatchJobFromFile()` |
| How | Requests embedded in POST body | JSONL uploaded to File API, referenced by name |
| Max size | ~20 pages per batch (request body limit) | Hundreds of pages (20MB JSONL limit) |
| File storage | Not used | Counts against 20GB/project quota |
| Best for | Local scripts, small-medium books | Vercel routes, large books |

The local script uses inline submission by default to avoid the file storage quota. Vercel routes use file-based submission for larger batches.

## API Key Management

Three Gemini API keys with independent batch quotas:

| Key | Env Var | Batch Priority |
|-----|---------|---------------|
| Tier 3 | `GEMINI_API_KEY_TIER3` | Realtime primary, batch fallback |
| Key 2 | `GEMINI_API_KEY_2` | **Batch primary** (separate quota pool) |
| Default | `GEMINI_API_KEY` | Last resort |

The local script's `getBatchApiKey()` prefers KEY_2 for batch operations. Vercel routes use whichever key is configured in the environment.

**IMPORTANT: Key visibility.** Batch jobs are ONLY visible to the API key that created them. When collecting results, you must use the same key that submitted the job. The `collect-batch-results.mjs` script tries all keys automatically. The cron route checks all configured keys.

## Result Collection

### Cron-based (automatic)
The `process-batches` cron runs every 2h and collects results for pending/processing `batch_jobs`.

### Local script (bulk recovery)
For collecting many results beyond the cron's 270s time budget:

```bash
secret-lover run -- node scripts/collect-batch-results.mjs --concurrency 15
```

Features:
- Multi-key support: tries `TIER3`, `_2`, and primary keys for each job
- Handles both inline and file-based responses
- Hallucination guard: rejects OCR text > 25,000 chars
- Sets `batch_jobs` status to `saved` after successful collection
- Tracks `completed_pages` and `failed_pages` per job

## Quota Limits

| Quota | Limit | Symptom | Fix |
|-------|-------|---------|-----|
| Batch job creation | ~25k requests/day per key | HTTP 429 RESOURCE_EXHAUSTED | Wait 24h or use different key |
| File storage | 20GB per project | Upload rejected | Use inline mode, or `cleanup-gemini-files.mjs` |
| Requests/minute | Varies by tier | HTTP 429 | Auto-retry with backoff |

```bash
# Free file storage across all keys
secret-lover run -- node scripts/cleanup-gemini-files.mjs
```

## Batch vs Realtime

| | Realtime (Lambda) | Batch (Gemini API) |
|---|---|---|
| Cost | Full price | 50% discount |
| Latency | Seconds per page | Up to 24 hours |
| Context | Previous page translation | No cross-page context |
| Rate limits | Subject to API limits | None |
| Best for | Translation (needs context) | OCR, large books |
