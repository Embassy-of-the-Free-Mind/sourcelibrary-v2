# Audit Trail & Worker Fixes — 2026-02-08

## What was done

### 1. Complete Audit Trail (committed & deployed)
- Extended `src/lib/gemini-logger.ts` with `job_id`, `duration_ms`, `error_category` fields
- Created `src/lib/errors.ts` — `classifyError()` utility for structured error categorization
- All 3 Lambda workers now log every AI call to `gemini_usage` (success + failure)
- Removed redundant `cost_tracking` writes from batch-ocr and batch-translate routes

### 2. Processing Dashboard (committed & deployed)
- `GET /api/admin/processing-dashboard` — progress, costs, errors, velocity
- Initially used stale book-level fields; rewritten to compute from pages collection via `$lookup`
- Validated: 2,517 books, 369 with OCR, 130 with translation, 132,542 pages OCR'd

### 3. Worker Completion Bug Fix (committed & deployed to Vercel, NOT yet to Lambda)
- **Bug:** When the last page in a job failed, the worker `return`ed early before the completion check, leaving jobs stuck in `processing` forever
- **Fix:** Extracted `checkJobCompletion()` function that always runs after both success and failure paths
- New status `completed_with_errors` replaces `partial`
- Fixed 3 stuck jobs in production DB (all now `completed_with_errors`)
- Retry endpoint and job card UI updated for new status

## What's pending

### Lambda Deploy (blocked on AWS credentials)
AWS CLI is installed (`brew install awscli`). Zip packages are built and ready:
```bash
aws configure   # enter credentials
aws lambda update-function-code --function-name sourcelibrary-ocr-processor --zip-file fileb://dist/packages/ocr-processor.zip
aws lambda update-function-code --function-name sourcelibrary-translation-processor --zip-file fileb://dist/packages/translation-processor.zip
aws lambda update-function-code --function-name sourcelibrary-image-extraction-processor --zip-file fileb://dist/packages/image-extraction-processor.zip
```

If code changes are made before deploying, rebuild first:
```bash
bash scripts/aws-lambda/build-lambda.sh && bash scripts/aws-lambda/package-lambda.sh
```

### OCR Campaign — Next Steps

**Scale:** 2,000 books / 779,224 pages need OCR.

| Provider | Books | Pages needed |
|----------|-------|-------------|
| Internet Archive | 919 | 383,190 |
| EFM | 965 | 358,038 |
| MDZ | 35 | 14,989 |
| Gallica | 54 | 14,625 |
| IIIF | 20 | 6,129 |
| Other | 7 | 2,253 |

**Note:** 300 books (282 EFM + 18 other) have zero pages — imported but never fetched images.

### Prompt Generations (detected from OCR output)

Three generations of OCR prompts were used. No `prompt_version` stored on pages, but detectable from output markers:

| Generation | Marker in output | Pages | Model | Quality |
|------------|-----------------|-------|-------|---------|
| **Gen 3** (Dec 27+) | `<lang>` XML tags | 91,159 | gemini-2.5-flash (85k), gemini-3-flash (6k) | Best — XML tags, vocab, image detection |
| **Gen 1/2** (Dec 17-21) | `[[language:]]` brackets | ~3,758 | Mixed older | Older format, less structured |
| **No markers** | Neither | ~37,625 | Mixed | May be Gen 3 where model skipped tag, or blank pages |

**Decision needed:** ~3,758 Gen 1/2 pages are candidates for redo with Gen 3 prompt + gemini-3-flash-preview. The ~37k no-marker pages need spot-checking.

### Language Gap

2,452 of 2,517 books have **no `original_language` set** (only MDZ books have it). This matters because:
- Gen 3 prompt uses `{language}` template variable — gets replaced with the book's language
- If no language set, it becomes empty string in the prompt
- Gen 1 prompt auto-detected language (`[[language: detected]]`) — this worked better for unknown languages

**Options before scaling:**
1. Modify the Gen 3 prompt to auto-detect language (remove `{language}` dependency)
2. Batch-classify book languages from titles/authors with AI
3. Default to "Latin" for the collection (most common, but not always correct)

**Recommendation:** Option 1 — update prompt to detect language. This eliminates the blocker for 2,452 books.

### Model Choice

User wants **gemini-3-flash-preview exclusively** for the campaign. Current OCR breakdown by model:
- gemini-2.5-flash: 89k pages
- gemini-3-flash-preview: 40k pages
- Older (gemini, gemini-2.0-flash, mistral): ~2.5k pages

### Translation Scaling

- 369 books have OCR, only 130 have translation
- **Gemini Batch API** (`/api/books/[id]/batch-translate-async`) is 50% cheaper, recommended for bulk
- Cron at `/api/cron/process-batches` is throttled (5 jobs / 2 hours) — needs tuning or bypass
- FIFO queue worker provides context from previous page; Batch API does not

## Prompt History (prompts collection)

All prompts stored in `prompts` collection. OCR prompts chronologically:

1. **"Standard OCR"** (Dec 17) — Gen 1. Auto-detects language. `[[bracket]]` notation. 2,412 chars.
2. **"new OCR"** (Dec 17) — Gen 1 variant. Shorter, 929 chars.
3. **"Latin OCR (Neo-Latin)"** (Dec 21) — Gen 2. Language-specific. `[[bracket]]` notation. 3,139 chars.
4. **"German OCR (Fraktur)"** (Dec 21) — Gen 2. German-specific. 3,256 chars.
5. **"Standard OCR"** (Dec 27) — Gen 3. `<xml>` tags, `{language}` template var, image detection. 2,076 chars. This is the current `DEFAULT_PROMPTS.ocr`.
6. **"Latin OCR (Neo-Latin)"** (Dec 27) — Gen 3 Latin variant. 4,142 chars.
7. **"German OCR (Fraktur)"** (Dec 27) — Gen 3 German variant. 3,980 chars.
8. **"Music pages"** (Jan 2) x2 — Specialized for music notation pages.

`STREAMLINED_OCR_PROMPT` in `src/lib/types/prompts/defaults.ts` is dead code — never imported or used.

## Key findings

- **No prompt_version tracking on existing pages** — `ocr.prompt_version` is `undefined` everywhere. New workers will write `PROMPT_VERSION` going forward.
- **OCR breakdown by source:** batch_api (116k pages, 297 books), ai/realtime (7.4k pages, 60 books), old routes (9k pages, 64 books), manual (8 pages)
- Book-level fields `pages_ocr` and `translation_percent` are stale — always compute from pages collection
- `cost_tracking` collection is deprecated; `gemini_usage` is the single source of truth

## Deploy notes
- Vercel project is `sourcelibrary-v2` (not `sourcelibrary`)
- `.vercel/project.json` was fixed to point to correct project
- `vercel.json` has no `functions` block — all routes use `export const maxDuration` instead
- Temp analysis script at `scripts/check-ocr-needs.js` (can delete)

## Commits (all on main, pushed)
1. `312c19b` — Complete audit trail: workers log to gemini_usage, classify errors
2. `6173696` — Add processing dashboard endpoint
3. `d65f8e2` — Fix dashboard: compute progress from pages collection
4. `6ce481a` — Fix workers: always run completion check, add completed_with_errors status
