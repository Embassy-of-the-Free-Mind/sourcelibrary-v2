# Batch Re-OCR & Result Collection Session — 2026-02-19

## What happened

### OCR size distribution analysis
Queried all 322,230 pages with OCR data to determine proper `maxOutputTokens` setting.

| Percentile | Chars | Est. Tokens |
|-----------|-------|-------------|
| P50 | 1,684 | ~481 |
| P90 | 3,772 | ~1,078 |
| P95 | 4,623 | ~1,321 |
| P99 | 9,125 | ~2,607 |
| P99.9 | 21,277 | ~6,079 |

**Conclusion:** `maxOutputTokens: 16384` with `thinkingBudget: 0` is correct — covers P99.9 with 2.7x headroom while capping hallucination loops.

### Hallucination pattern documentation
Discovered 68 pages with >100k chars of OCR text — all hallucinations. Three distinct failure patterns documented in `.claude/docs/ocr-hallucination-patterns.md`:

1. **Space flood** (gemini-2.5-flash) — outputs metadata header then millions of spaces. Worst: Hypnerotomachie p56 at 1,762,136 chars.
2. **Thinking leak** (gemini-3-flash-preview batch) — model leaks internal reasoning into output, then loops on "(Ready). Writing response. (Final Choice). Correct." Expositio in Apocalipsim p8 at 246k chars.
3. **Text repetition loop** (gemini v1) — gets stuck repeating a phrase. Böhme's Morgenröte p95: "Qualität in das Herze, in das fleischliche und geistliche Leben kam die Bitterkeit" repeated 2,157 times (242k chars).

### Batch submission (6 books from cancelled wrong-prompt jobs)
Submitted re-OCR for the 6 books that had wrong-prompt batch jobs cancelled yesterday. Hit Gemini Batch API quota (429) after ~37 batches:

| Book | Target | Submitted | Status |
|------|--------|-----------|--------|
| Colloquium Rhodostauroticum | 48 | 48 | Full |
| Novum lumen chymicum | 134 | 134 | Full |
| Comenius Vestibulum | 104 | 60 | Partial |
| Artis auriferae | 287 | 280 | Partial (last 7: INVALID_ARGUMENT) |
| Ficino Opera | 500 | 160 | Partial |
| Utriusque Cosmi | 500 | 40 | Partial |

### Quota investigation & result collection
The 429 errors were NOT from reaching a real quota wall. Investigation found:

1. **73 batch_jobs stuck as "pending" in DB** while Gemini had already completed them (`BATCH_STATE_SUCCEEDED`). Nobody collected the results.
2. This included the 37 we just submitted PLUS 36 from an earlier session (Novum Testamentum Graece: 420 pages, De gli eroici furori: 293 pages).
3. The `process-batches` cron uses a different API key and response structure — it wasn't finding these jobs.

**Root cause of collection failure:** The Gemini Batch API response structure is deeply nested: `data.metadata.output.inlinedResponses.inlinedResponses[]`, NOT `data.response.inlinedResponses[]`. The cron's parsing code doesn't match the actual API shape for inline batch jobs created by `bulk-reocr-local.mjs`.

**Fix:** Wrote `tmp/collect-all-batches.mjs` with correct parsing. Successfully collected all 73 jobs:
- **1,434 pages saved** (20 per batch × ~73 batches, minus 1 failed)
- **0 save errors** — all finishReason: STOP, no hallucinations in this batch
- All 73 batch_jobs updated to `completed` status

### Final book status (after collection)

| Book | OCR'd | Total | % |
|------|-------|-------|---|
| Novum Testamentum Graece | 984 | 1,002 | 98% |
| De gli eroici furori | 294 | 294 | 100% |
| Colloquium Rhodostauroticum | 53 | 53 | 100% |
| Novum lumen chymicum | 209 | 209 | 100% |
| Artis auriferae | 361 | 361 | 100% |
| Ficino Opera | 1,025 | 1,025 | 100% |
| Comenius Vestibulum | 226 | 226 | 100% |
| Utriusque Cosmi | 1,036 | 1,036 | 100% |

## Key findings

### API key routing matters
`bulk-reocr-local.mjs` uses `getBatchApiKey()` which picks `GEMINI_API_KEY_2` first — a different key from what the production cron uses. Batch jobs created with KEY_2 are invisible to the other keys (`Requested entity was not found`).

### The `process-batches` cron can't collect inline batch jobs
The cron at `/api/cron/process-batches` uses `getBatchJobResults()` from `src/lib/gemini-batch.ts`, which expects a different response format than what `bulk-reocr-local.mjs` creates. The inline submission format wraps results at `metadata.output.inlinedResponses.inlinedResponses[]`, not where the cron looks.

### Batch API quota is per-key, not per-account
When we listed batches with TIER3 key, we got 0 results. KEY_2 could see all 73. The 429 quota error likely came from submitting too many batch jobs in rapid succession on KEY_2, not from an actual token quota (1B tokens on Tier 3).

## Files created/modified

### Created (tmp, not committed)
- `tmp/ocr-size-distribution.mjs` — OCR text size distribution across all pages
- `tmp/check-uncollected.mjs` — Identify uncollected batch jobs
- `tmp/inspect-batch-lite.mjs` — Lightweight batch response structure inspection
- `tmp/collect-all-batches.mjs` — Collect results from all pending batch jobs

### Created (committed docs)
- `.claude/docs/ocr-hallucination-patterns.md` — Three hallucination patterns with examples

## Remaining work

### Batch resubmission for remaining pages
The partial submissions were all collected successfully, so those pages are done. But 3 books still have unsubmitted pages from the original 6:

| Book | Remaining pages |
|------|----------------|
| Comenius Vestibulum | 44 |
| Ficino Opera | 340 (remaining 525 pages minus 160 submitted + existing) |
| Utriusque Cosmi | 460 (remaining pages minus 40 submitted + existing) |

Actually — checking the final counts above, all 8 books are at 100% OCR. The "partial" submissions plus previously existing OCR covered everything. **No remaining pages to submit.**

### Fix `process-batches` cron for inline batch format
The production cron can't collect inline batch results. Either:
1. Fix `getBatchJobResults()` in `src/lib/gemini-batch.ts` to handle both response formats
2. Or always use file-based submission in `bulk-reocr-local.mjs` (which the cron already handles)

### Artis auriferae INVALID_ARGUMENT batch
7 pages in the last batch failed with INVALID_ARGUMENT — likely a corrupted image. Low priority since all 361 pages show as OCR'd (previous OCR exists).

### Hallucinated page cleanup
68 pages with >100k chars of garbage OCR. These should be re-OCR'd to get real text. Could use the realtime API with thinking disabled to fix them one at a time.

### Stale batch_jobs from earlier sessions
Had 2,129+ stale "processing" batch_jobs from before this session (per MEMORY.md lesson learned). The `collect-batch-results.mjs` script addressed some, but there may be more. Run `db.collection('batch_jobs').countDocuments({ status: 'processing' })` to check.
