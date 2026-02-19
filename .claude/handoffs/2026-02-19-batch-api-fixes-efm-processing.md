# 2026-02-19: Batch API Fixes & EFM Processing

## What was done

### 1. Gemini Batch API fixes (3 root causes)

**a) API key visibility:** Batch jobs are ONLY visible to the key that created them. 704 stuck jobs were created with `GEMINI_API_KEY_TIER3` but `collect-batch-results.mjs` only used `GEMINI_API_KEY`. Fixed the collection script with multi-key support (tries all 3 keys).

**b) Stats field name mismatch:** Gemini API changed `succeededCount` → `successfulRequestCount`. Fixed in `src/lib/gemini-batch.ts` (2 locations) with fallback pattern accepting both names.

**c) `<lang>` → `<language>` tag rename:** Prompt v5.2026-02 renamed the tag. `bulk-reocr-local.mjs` still had the old `<lang>`. Fixed. `realtime-reocr-efm.mjs` was already correct.

### 2. Batch result collection

- 481 of ~706 batch jobs collected (10,111 pages saved) as of session end
- 499 jobs still `JOB_STATE_PENDING` on Gemini (not yet completed on their end)
- Collection process (PID 26196) may still be running at concurrency 15
- Process-batches cron will continue collecting remaining jobs every 2h

### 3. EFM translation pipeline

- ~978 EFM books queued for Lambda FIFO translation
- Canon Medicinae actively processing (718/2363 pages)
- Most EFM pages being translated have OLD OCR (gemini-2.5-flash, Jan 2026) — no `<language>` tag, no multi-column, no page-type. Translations work fine on old OCR text, but quality is lower than v5 prompt OCR.

### 4. Re-OCR progress

- 1,829/2,000 EFM pages re-OCR'd via `realtime-reocr-efm.mjs` (159 errors, 12 skipped)
- ~8,730 pages remaining from the initial re-OCR candidates
- EFM total: 378,025 pages, ~39,145 OCR'd (10%), ~29,817 translated (8%)

### 5. Documentation updates

- `MEMORY.md`: Updated prompt version to v5, added batch API key visibility and stats field lessons
- `.claude/docs/page-lifecycle.md`: Updated prompt version, tag rename note, Standard OCR → v6
- `.claude/docs/batch-processing.md`: Added key visibility warning, result collection section

## Files modified

| File | Change |
|------|--------|
| `src/lib/gemini-batch.ts` | Stats field fallback (2 locations) |
| `scripts/collect-batch-results.mjs` | Multi-key support, hallucination guard |
| `scripts/bulk-reocr-local.mjs` | `<lang>` → `<language>`, prompt v4 → v5 |
| `.claude/docs/page-lifecycle.md` | Prompt version and tag rename docs |
| `.claude/docs/batch-processing.md` | Key visibility and collection docs |
| `MEMORY.md` | Updated with batch API lessons |

## Deployed

`vercel --prod` deployed successfully with the `gemini-batch.ts` stats fix.

## Known issues

- **Old OCR translations:** Most EFM translations are based on old OCR. These will be higher quality after re-OCR + retranslation. Low priority — the translations are usable.
- **704 batch jobs with `<lang>` tag:** OCR content is correct, just uses old tag name in output. No impact on rendering or translation.
- **Translation workers slow:** Lambda FIFO queue processes sequentially per job. Canon Medicinae (2,363 pages) is blocking the queue.
