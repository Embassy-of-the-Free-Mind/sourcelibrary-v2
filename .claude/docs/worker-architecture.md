# Worker Architecture

## Overview

Three AWS Lambda AI workers process pages via SQS queues. Each invocation handles ONE page. A fourth **Writer Lambda** receives results via a write-results queue and performs all MongoDB writes, preventing connection storms during large batch jobs.

Workers are independent of the Next.js app — they share MongoDB (via the Writer Lambda) and the `gemini_usage` logging system.

## Workers

| Worker | Handler | Logic | Queue | Concurrency |
|--------|---------|-------|-------|-------------|
| OCR | `src/workers/ocr-processor.ts` | `ocr-processor-logic.ts` | Standard (parallel) | Reserved: 10 |
| Translation | `src/workers/translation-processor.ts` | `translation-processor-logic.ts` | FIFO (sequential per job) | N/A |
| Image Extraction | `src/workers/image-extraction-processor.ts` | `image-extraction-processor-logic.ts` | Standard (parallel) | Reserved: 10 |
| **Writer** | `src/workers/write-processor.ts` | `write-processor-logic.ts` | Standard (batched) | Reserved: 50 |

Translation uses a FIFO queue so pages process in order — the worker fetches the previous page's translation for context continuity.

## Write Queue Architecture (Issue #94)

### Problem
During large batch jobs, 600+ concurrent AI workers each opened their own MongoDB connection, causing 3,000–4,000 ops/sec and connection storms. MongoDB Atlas limits were exceeded, causing cascading failures.

### Solution
AI workers no longer write results directly to MongoDB. Instead, they send results to a **write-results SQS queue**. A dedicated **Writer Lambda** (capped at 50 reserved concurrency) consumes these messages and performs all database writes.

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐     ┌─────────┐
│  AI Workers │ ──► │  SQS Write   │ ──► │  Writer Lambda  │ ──► │ MongoDB │
│ (600+ conc) │     │ Results Queue│     │ (50 max conc)   │     │  Atlas  │
└─────────────┘     └──────────────┘     └─────────────────┘     └─────────┘
```

### What AI workers still do directly
- **Read** from MongoDB: job status checks, page data, prompts
- **Create revisions** (OCR worker — critical for rollback safety)
- **Write translation text** (Translation worker only — FIFO context chain requires previous page's translation to be in MongoDB before next page processes)

### What's deferred to the Writer Lambda
- Page result saves (OCR data, image extraction data)
- `gemini_usage` logging
- Job completion tracking (`checkJobCompletion()`)
- Gallery image upserts (image extraction)
- Job failure updates

### Translation Hybrid Approach
The Translation worker keeps one direct write: `pages.updateOne` for the translated text. This is required because the FIFO queue processes pages sequentially per job, and each page needs the previous page's translation for context continuity. All other writes (logging, completion) are deferred to the write queue.

### Write Result Message Types
Defined in `src/lib/types/sqs.ts` as a discriminated union on the `type` field:
- `OcrWriteResult` — OCR text, detected images, model info, Gemini usage
- `TranslationWriteResult` — completion tracking only (text already written)
- `ImageExtractionWriteResult` — extracted images, gallery documents, Gemini usage

### Shared Utilities
- `src/lib/retry-utils.ts` — `retryDbWrite<T>()` with exponential backoff (1s/2s/4s, 3 retries)
- `src/lib/job-completion.ts` — `checkJobCompletion()` extracted from workers, handles all 3 job types

## SQS Configuration

Queue URLs from environment variables:
- `SQS_PAGE_OCR_QUEUE_URL`
- `SQS_PAGE_TRANSLATION_QUEUE_URL`
- `SQS_PAGE_IMAGE_EXTRACTION_QUEUE_URL`
- `SQS_WRITE_RESULTS_QUEUE_URL`

Region: `eu-central-1` (configurable via `AWS_REGION`)

AI worker message type (`PageProcessingMessage` in `src/lib/types/sqs.ts`):
```typescript
{ bookId: string; pageId: string; jobId: string; customPrompt?: string }
```

Write result message type (`WriteResultMessage` in `src/lib/types/sqs.ts`):
```typescript
{ type: 'ocr' | 'translation' | 'image-extraction'; bookId: string; pageId: string; jobId: string; targetPageIds: string[]; timestamp: string; failed: boolean; error?: string; /* type-specific fields */ }
```

SQS client: `src/lib/sqs-client.ts` — `sendMessage()`, `sendMessageBatch()`, `sendWriteResult()`, convenience wrappers like `sendPageOcrMessage()`.

### Writer Lambda SQS Event Source Mapping
- **Batch size:** 10 (SQS maximum)
- **Batching window:** 5 seconds (balances latency vs. efficiency)
- **Report batch item failures:** enabled (partial batch failure support)

## Job Lifecycle

**States:** `pending` → `processing` → `completed` | `completed_with_errors` | `failed` | `cancelled`

### 1. Job Creation
- Route: `POST /api/jobs/queue-books` (or batch API routes)
- Creates job record with `status: 'pending'`, `progress: { total, completed: 0, failed: 0 }`
- Stores `config.page_ids` (target pages)
- Sets `book.job = { type: 'realtime', job_id }`

### 2. Enqueue Pages
- `enqueuePagesForJob()` in `src/lib/queue-utils.ts`
- Batches into SQS messages (max 10 per `sendMessageBatch`)
- Translation queue: adds `messageGroupId: jobId` for FIFO ordering

### 3. Worker Processing
1. Check if job is `cancelled` → skip if so (send skip result to write queue)
2. Fetch page, get image URL (fallback chain: `cropped_photo` → `archived_photo` → `photo` → `photo_original`)
3. Call Gemini for OCR/translation/extraction
4. On success: send result to write-results SQS queue (except Translation, which writes text directly then defers logging/completion)
5. On failure: send failure result to write queue
6. **Never** call `checkJobCompletion()` directly — the Writer Lambda handles it

### 4. Writer Processing
The Writer Lambda receives batches of up to 10 write result messages:
1. Parse and validate message type
2. Dispatch to type-specific handler:
   - **OCR:** Save page data (OCR text, model, detected images), log Gemini usage, check job completion
   - **Translation:** Log Gemini usage, check job completion (text already written by worker)
   - **Image Extraction:** Save page data, upsert gallery images, log Gemini usage, check job completion
3. On failure: return `itemIdentifier` in `batchItemFailures` for SQS retry

### 5. Completion Check
`checkJobCompletion()` (in `src/lib/job-completion.ts`) counts completed pages and transitions the job:
- If `completed + failed >= total`: set status to `completed` or `completed_with_errors`
- Sets `job.completed_at`, unsets `book.job`

### 6. Retry / Cancel
- **Retry:** `POST /api/jobs/[id]/retry` — re-enqueues `job.failed_page_ids`, resets to `pending`
- **Cancel:** `POST /api/jobs/[id]/cancel` — sets `cancelled`, workers detect and skip (in-flight pages may still complete)

## Error Handling

**Classification:** `classifyError()` in `src/lib/errors.ts` → `rate_limit`, `safety_filter`, `network`, `invalid_input`, `unknown`

**RECITATION fallback (OCR only):** On safety filter error with "RECITATION", retries with fallback model chain: `gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-1.5-flash`

**Logging:** All AI calls logged to `gemini_usage` via `logGeminiCall()` (non-blocking — failures don't crash workers).

## Build & Deploy

```bash
# Build (esbuild → Node 24 bundles for all 4 workers)
scripts/aws-lambda/build-lambda.sh

# Package (add node_modules, zip)
scripts/aws-lambda/package-lambda.sh

# Deploy (one per worker)
aws lambda update-function-code \
  --function-name sourcelibrary-ocr-processor \
  --zip-file fileb://dist/packages/ocr-processor.zip

aws lambda update-function-code \
  --function-name sourcelibrary-write-processor \
  --zip-file fileb://dist/packages/write-processor.zip
```

Output zips: `dist/packages/{ocr,translation,image-extraction,write}-processor.zip`

### Writer Lambda Setup (one-time)
```bash
# 1. Create write-results SQS queue
aws sqs create-queue \
  --queue-name sourcelibrary-write-results \
  --attributes '{
    "VisibilityTimeout": "180",
    "MessageRetentionPeriod": "345600",
    "ReceiveMessageWaitTimeSeconds": "20"
  }' \
  --region eu-central-1

# 2. Create Writer Lambda function
aws lambda create-function \
  --function-name sourcelibrary-write-processor \
  --runtime nodejs24.x \
  --handler write-processor.handler \
  --zip-file fileb://dist/packages/write-processor.zip \
  --role <EXISTING_LAMBDA_ROLE_ARN> \
  --timeout 30 \
  --memory-size 256 \
  --reserved-concurrent-executions 50 \
  --environment "Variables={MONGODB_URI=<URI>,SQS_WRITE_RESULTS_QUEUE_URL=<QUEUE_URL>}" \
  --region eu-central-1

# 3. Add SQS event source mapping (batch size 10, 5s window)
aws lambda create-event-source-mapping \
  --function-name sourcelibrary-write-processor \
  --event-source-arn <WRITE_RESULTS_QUEUE_ARN> \
  --batch-size 10 \
  --maximum-batching-window-in-seconds 5 \
  --function-response-types ReportBatchItemFailures \
  --region eu-central-1

# 4. Add SQS_WRITE_RESULTS_QUEUE_URL to all 3 AI worker Lambda environments
aws lambda update-function-configuration \
  --function-name sourcelibrary-ocr-processor \
  --environment "Variables={...,SQS_WRITE_RESULTS_QUEUE_URL=<QUEUE_URL>}" \
  --region eu-central-1
# (repeat for translation-processor and image-extraction-processor)
```

## Database Schema

**`jobs` collection:**
```
id, type, status, book_id, book_title,
progress: { total, completed, failed },
failed_page_ids: string[],
config: { page_ids, custom_prompt, model, language },
created_at, updated_at, started_at, completed_at
```

Indexed on: `book_id + type + status`

## Key Routes

| Route | Purpose |
|-------|---------|
| `POST /api/jobs/queue-books` | Create job, enqueue pages |
| `GET /api/jobs` | List jobs |
| `POST /api/jobs/[id]/retry` | Re-enqueue failed pages |
| `POST /api/jobs/[id]/cancel` | Cancel running job |
