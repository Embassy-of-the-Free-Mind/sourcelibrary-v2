# Worker Architecture

## Overview

Three AWS Lambda workers process pages via SQS queues. Each invocation handles ONE page. Workers are independent of the Next.js app — they share MongoDB and the `gemini_usage` logging system.

## Workers

| Worker | Handler | Logic | Queue | Concurrency |
|--------|---------|-------|-------|-------------|
| OCR | `src/workers/ocr-processor.ts` | `ocr-processor-logic.ts` | Standard (parallel) | Reserved: 10 |
| Translation | `src/workers/translation-processor.ts` | `translation-processor-logic.ts` | FIFO (sequential per job) | N/A |
| Image Extraction | `src/workers/image-extraction-processor.ts` | `image-extraction-processor-logic.ts` | Standard (parallel) | Reserved: 10 |

Translation uses a FIFO queue so pages process in order — the worker fetches the previous page's translation for context continuity.

## SQS Configuration

Queue URLs from environment variables:
- `SQS_PAGE_OCR_QUEUE_URL`
- `SQS_PAGE_TRANSLATION_QUEUE_URL`
- `SQS_PAGE_IMAGE_EXTRACTION_QUEUE_URL`

Region: `eu-central-1` (configurable via `AWS_REGION`)

Message type (`PageProcessingMessage` in `src/lib/types/sqs.ts`):
```typescript
{ bookId: string; pageId: string; jobId: string; customPrompt?: string }
```

SQS client: `src/lib/sqs-client.ts` — `sendMessage()`, `sendMessageBatch()`, convenience wrappers like `sendPageOcrMessage()`.

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
1. Check if job is `cancelled` → skip if so
2. Fetch page, get image URL (fallback chain: `cropped_photo` → `archived_photo` → `photo` → `photo_original`)
3. Call Gemini for OCR/translation/extraction
4. On success: save result to page, log to `gemini_usage`
5. On failure: log error, mark page failed
6. **Always** call `checkJobCompletion()` — never skip on error

### 4. Completion Check
`checkJobCompletion()` counts completed pages and transitions the job:
- If `completed + failed >= total`: set status to `completed` or `completed_with_errors`
- Sets `job.completed_at`, unsets `book.job`

### 5. Retry / Cancel
- **Retry:** `POST /api/jobs/[id]/retry` — re-enqueues `job.failed_page_ids`, resets to `pending`
- **Cancel:** `POST /api/jobs/[id]/cancel` — sets `cancelled`, workers detect and skip (in-flight pages may still complete)

## Error Handling

**Classification:** `classifyError()` in `src/lib/errors.ts` → `rate_limit`, `safety_filter`, `network`, `invalid_input`, `unknown`

**RECITATION fallback (OCR only):** On safety filter error with "RECITATION", retries with fallback model chain: `gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-1.5-flash`

**Logging:** All AI calls logged to `gemini_usage` via `logGeminiCall()` (non-blocking — failures don't crash workers).

## Build & Deploy

```bash
# Build (esbuild → Node 24 bundles)
scripts/aws-lambda/build-lambda.sh

# Package (add node_modules, zip)
scripts/aws-lambda/package-lambda.sh

# Deploy (one per worker)
aws lambda update-function-code \
  --function-name sourcelibrary-ocr-processor \
  --zip-file fileb://dist/packages/ocr-processor.zip
```

Output zips: `dist/packages/{ocr,translation,image-extraction}-processor.zip`

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
