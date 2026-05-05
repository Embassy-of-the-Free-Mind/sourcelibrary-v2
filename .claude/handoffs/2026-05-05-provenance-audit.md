# Data Provenance Audit — 2026-05-05

End-to-end audit and strengthening of the AI text content provenance trail in Source Library. Picked up from PR #1605 (book-history Supabase migration) which had explicitly listed two follow-ups; expanded into a full audit when those follow-ups were checked.

## Why this matters

Every OCR page, translation, summary, index, and chapter on the site is AI-generated content derived from a primary source. If we can't reconstruct exactly which prompt + which model + which run produced any given output, we lose: license enforcement (the Trithemian imprimatur), reversibility (page_revisions), scholarly citation (the prompt-version link), cost attribution (gemini_usage), and the trust model that lets us call this a research-grade library. Once a write happens without provenance, that gap is permanent — there is no oracle that can fill it in retroactively.

## What was audited

A subagent surveyed every `logGeminiCall` site, every page-write site (`ocr.data` / `translation.data`), every book-level AI write (`summary` / `reading_summary` / `index` / `chapters`), every contributor / Lambda / Hetzner worker, and every admin route that reads `gemini_usage`. The audit table is in the message thread of the working session; key gaps below.

## Gaps closed

### 1. `triggered_by` and friends never populated on `gemini_usage` (PR #1605 follow-up)
- ~30 `logGeminiCall` invocations had no `triggered_by`, several had no `book_id`, and the index/summary route had no prompt_version on its log records.
- Added `getTriggerSource(request)` helper in `src/lib/cron-auth.ts`. Returns `'cron'` for Vercel-managed cron or external cron with `CRON_SECRET` bearer; `'manual'` otherwise. Lambda/Hetzner workers continue to use the `TRIGGER_SOURCE` env var.
- Swept every active route. Cron-only admin routes (`bulk-reocr`, `bulk-ocr-new`) hardcode `'cron'`. lib/ helpers take an optional `triggered_by` parameter.
- Threaded `bookId` and trigger through `processBatch` / `processAllBatches` / `generateBookSummary` in `/api/books/[id]/index` (and tenant variant). Added `INDEX_PROMPT_VERSION = 'inline-2026-05'` constant for the inline prompts.

### 2. `prompt_id` and `prompt_hash` were never written to pages
- Batch routes called `getOcrPrompt() / getTranslationPrompt()` and got back a full `PromptLookupResult` with `reference: { id, name, version, content_hash }` — but only stored `prompt_version` (often as a static `PROMPT_VERSION` constant, not the actual prompt's version). Three of the four fields were silently dropped.
- Capture full prompt reference at submission. Store all four on `batch_jobs`. Result-collector propagates to page.
- Added the three new fields to `src/lib/types/batch-job.ts`.
- Lambda OCR worker now passes `promptName` through SQS (was already passing `promptId`/`promptHash`). Realtime `/api/process` writes flat `prompt_id`/`prompt_hash`/`prompt_name` alongside its existing nested `prompt: reference`.
- Mirrored in Hetzner `batch-collector.mjs`.

### 3. Book-level summary/index had no revision history
- `/api/books/[id]/index` POST `$unset`s `index` + `summary` with no recovery path. GET regenerated and overwrote with no snapshot. Hetzner `enrich-worker.mjs` did the same in Phase 6 (summary) and Phase 7 (chapters).
- New module `src/lib/book-revisions.ts` (and Node mirror at `scripts/workers/lib/book-revisions.mjs`). Same discipline as `page_revisions`: snapshot prior value before any overwrite. Reads provenance metadata off the existing field's shape.
- Wired into both index routes (GET write + POST cache-clear) and the enrich-worker (Phase 6 + Phase 7).

### 4. Contributor flow had no `gemini_usage` rows at all
- `/api/contribute/process` ran Gemini calls on contributor API keys, accumulated tokens into `contributions` collection, but never logged a single `gemini_usage` row. Contributor work was invisible to cost analytics.
- Translation also called `DEFAULT_PROMPTS.translation` (the constant) instead of `getTranslationPrompt(sourceLanguage)` — same bug PR #506/#507 fixed for the Lambda worker, but missed here.
- Both helpers now return the full prompt reference + duration. Page write records all four prompt fields. Per-page `logGeminiCall` with `triggered_by: 'manual'` and the contributor's `book_title`.

### 5. Admin dashboards read empty MongoDB collection
- 7 admin routes still read MongoDB `gemini_usage`, which has been a near-empty stub since Supabase became primary on 2026-04-10. They've silently shown wrong/stale data for ~3 weeks.
- Migrated 6 routes (the 7th, `/api/process`, was correctly identified as a writer not a reader): `admin/health`, `admin/realtime`, `api/usage`, `admin/processing-dashboard`, `admin/processing-overview`, `admin/dashboard`.
- Pattern matches `book-history.ts`: Supabase primary via `supabaseAdmin`, MongoDB as fallback when service key is unset (e.g. build time). API response shapes unchanged.

### 6. Hetzner translate-worker bypassed `saveRevisionBeforeOverwrite` on placeholder writes
- Four sites overwrote `translation.data` with `'[Blank page]'` or `'[This page could not be translated due to ...]'` markers without snapshotting first. A retry that hit a Gemini policy block could silently destroy a valid prior translation.
- Each site now calls `saveRevisionBeforeOverwrite` first.

## False positives from PR #1605 follow-up list

- **Archive workers**: PR #1605 listed `archive-ocr/eap/uva/erara/gallica/artwork/bulk` as having "no provenance logging" for 5K-10K pages/day. Verified — they don't run AI, only image archival to R2. They write `archive_metadata.{archived_at, source_url, original_url, full_res, bytes}` per page, which is the correct provenance for image archival. No `gemini_usage` rows expected. (The `archive-uva.mjs` file referenced doesn't exist; it may have been merged into `archive-bulk.mjs`.)

## Files touched

```
src/lib/cron-auth.ts                                     +helper getTriggerSource
src/lib/book-revisions.ts                                NEW
src/lib/types/batch-job.ts                               +prompt_id/hash/name
src/lib/types/sqs.ts                                     +promptName on OcrWriteResult.data

# 30+ route/worker files for the triggered_by + prompt sweep
# 6 admin route files for the Supabase migration

scripts/workers/lib/book-revisions.mjs                   NEW (Node mirror)
scripts/workers/enrich-worker.mjs                        +revisions, +source: 'ai'
scripts/workers/translate-worker.mjs                     +4 saveRevisionBeforeOverwrite calls
scripts/workers/batch-collector.mjs                      +prompt_id/hash/name on page write

.claude/docs/data-provenance.md                          rewritten
```

## Verification

`npx tsc --noEmit` is clean after every checkpoint. `node -c` parses every modified `.mjs`. The doc has a §9 audit-verification snippet for sampling recent pages and confirming all four prompt fields + a `gemini_usage` row exist.

## Commits on this branch

```
1295429b Provenance audit: close revision gaps in Hetzner workers
e00f1fcf Provenance audit: migrate 7 admin gemini_usage readers to Supabase
a91c24ea Provenance audit: book-level revision history + contributor logging
d4203f9f Provenance audit: write prompt_id + prompt_hash on every batch page write
4dca62e7 Provenance audit: wire triggered_by + prompt_version to every Gemini log site
```

Branch: `worktree-provenance-audit`. Worktree: `.claude/worktrees/provenance-audit`.

## Follow-ups (not blocking; out of scope for this PR)

- Backfill `prompt_id` / `prompt_hash` on existing pages by joining `page.ocr.prompt_version` against `db.prompts`. Most v10/v8 pages should be straight matches; older versions (v5.2026-02 etc.) already have a content-hash backfill from PR #506/#507 era. Worth a one-shot script.
- Backfill `triggered_by` on existing `gemini_usage` rows. Possible heuristics: `endpoint.includes('worker/')` → 'worker', `endpoint.startsWith('/api/cron/') || endpoint.includes('bulk-reocr')` → 'cron', else 'manual'. Stamp once, never overwrite.
- Manual UI page edits don't audit-log the editor's identity beyond the `edited_by` field on the page. If we want a true audit log of who edited what, propagate session identity into the PATCH routes and write to `audit_log` with `actor`.
- Index/summary inline prompts could move to the `prompts` collection so they get the same `prompt_id` / `prompt_hash` discipline as OCR/translation. Low priority — `INDEX_PROMPT_VERSION` is enough until those prompts churn.
