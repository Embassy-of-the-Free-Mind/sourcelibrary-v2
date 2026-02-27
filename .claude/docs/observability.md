# Observability & Audit Trail

## Book History Timeline

Every book page shows a "Book History" section (`BookHistory` component) that displays a provenance timeline assembled from multiple data sources.

**API:** `GET /api/books/[id]/history`
**Component:** `src/components/book/BookHistory.tsx`
**Client:** `books.history(bookId)` in `src/lib/api-client/books.ts`

### Data Sources (1 book lookup + 5 parallel queries)

| Source | Collection | Events generated |
|--------|-----------|-----------------|
| Book document | `books` | imported, summary, index, extract_chapters, edition_published |
| AI usage | `gemini_usage` | ocr, translation, summary, index, image_extraction, extract_chapters |
| Processing jobs | `jobs` | ocr, translation, summary, image_extraction (with progress: completed/total/failed) |
| Page stats | `pages` | archived (aggregate count + dates) |
| Admin log | `audit_log` | admin_action (OCR resets, etc.) |
| Metadata changelog | `book_metadata_changelog` | metadata_change (field-level before/after diffs) |

### Deduplication

When a `gemini_usage` record has a `job_id` matching the `jobs` collection, it's folded into the job event (with cost data) instead of shown separately. Book-level fields (summary, index) are only shown if no corresponding `gemini_usage` or job record exists.

### Coverage

- **All books:** At least the import event (from `created_at`)
- **Books processed by Lambda workers (Feb 2026+):** Full AI cost/model/page data
- **Older books:** Import + book-level timestamps only (no cost data)

---

## AI Cost & Usage Tracking

**Single source of truth:** `gemini_usage` collection via `logGeminiCall()` in `src/lib/gemini-logger.ts`

The `cost_tracking` collection is fully deprecated — zero active writers or readers remain. All cost data flows through `gemini_usage`.

### Dashboards
- **Processing dashboard:** `GET /api/admin/processing-dashboard` — progress bins, costs (7d/30d), error categories, velocity
- **Usage analytics:** `GET /api/analytics/usage?days=30` — cost breakdown by day/action
- **Frontend:** `/analytics` page — full dashboard

### Error Classification
`src/lib/errors.ts` → `classifyError(error)` categorizes into: rate_limit, timeout, safety_filter, invalid_image, network, api_error, no_data, unknown.

---

## Collections Reference

| Collection | Purpose | Indexed on |
|-----------|---------|-----------|
| `gemini_usage` | AI call logging (tokens, cost, model, status) | `book_id + timestamp` |
| `jobs` | Processing job tracking (progress, status) | `book_id + type + status` |
| `batch_jobs` | Gemini Batch API job tracking | — |
| `cron_runs` | Cron execution logging (actions, decisions, errors) | `cron + timestamp`, `timestamp`, `status + timestamp` |
| `audit_log` | Admin/system actions (imports, deletes, edits, resets, editions, DOIs) | `book_id` |
| `analytics_pageviews` | Web traffic (path, referrer, country) | `timestamp`, `path + timestamp` |
| `analytics_events` | Deduplication index + search query logging | `event + book_id + ip + timestamp` |
| `loading_metrics` | Frontend performance (p50, p95) | — |
| `likes` | User engagement (book/page/image) | `target_type + target_id + visitor_id` (unique), `target_type + target_id`, `visitor_id + target_type` |
| `highlights` | User-selected passages | `book_id + page_id` |
| `annotations` | Community notes with threading | `book_id + page_id` |
| `social_posts` | Tweet scheduling and metrics | — |
| `split_adjustments` | ML split detection feedback | — |
| `book_metadata_changelog` | Append-only metadata change history (field-level diffs) | `book_id + timestamp` |
| `cost_tracking` | **DEPRECATED** — no active writers/readers, use `gemini_usage` | — |

---

## Cron Run Logging

**Utility:** `src/lib/cron-logger.ts` — `createCronLogger(cronName)`
**Collection:** `cron_runs`

All 9 Vercel crons write structured run records via a shared builder-pattern logger. Each cron creates a logger at the start, accumulates state during execution, then calls `flush()` to write one document.

### Usage

```typescript
import { createCronLogger } from '@/lib/cron-logger';

const logger = createCronLogger('submit-ocr');

logger.action('books_submitted', 5);
logger.backpressure('ocr_batch_limit', { active: 200, max: 200 });
logger.skip('no valid images', { book_id: 'abc' });
logger.timeBudgetExhausted('Phase 4');
logger.error('Batch submit failed', { phase: 'ocr', book_id: 'abc' });

logger.setActions({ total_pages: 500, errors: 2 });
logger.addErrors(['Book X: timeout', 'Book Y: 404']);

await logger.flush(); // writes one document to cron_runs
```

### CronRunRecord Schema

| Field | Type | Description |
|-------|------|-------------|
| `cron` | CronName | One of 9 cron identifiers |
| `timestamp` | Date | When the run completed |
| `duration_ms` | number | Wall-clock time |
| `status` | `success` \| `partial` \| `failed` | Auto-detected from errors unless overridden |
| `failed` | boolean | `status === 'failed'` (backwards compat with analytics/pipeline reads) |
| `actions` | Record<string, number> | Flexible per-cron counters |
| `decisions` | CronDecision[] | **Key innovation** — captures WHY work was skipped (capped at 100) |
| `errors` | CronError[] | Structured error records |
| `error_count` | number | `errors.length` |
| `summary` | string | Human-readable auto-built from actions |

### Decision Types

| Type | Meaning | Example |
|------|---------|---------|
| `skip` | Work skipped (nothing to do) | "all books have OCR" |
| `backpressure` | Rate/capacity limit hit | "200 active batch jobs (max 200)" |
| `time_budget` | Time budget exhausted | "Exhausted at Phase 4" |
| `circuit_breaker` | Safety mechanism triggered | "3 books blocked due to repeated failures" |
| `early_return` | Config-based early exit | "Not a posting hour (14 UTC)" |
| `rollback` | State rolled back | "Stale book reset to archive_complete" |

### Instrumented Crons

| Cron | Key decisions captured |
|------|----------------------|
| `post-import-pipeline` | Emergency stop, OCR/image backpressure, staleness rollback/circuit breaker, time budget per phase |
| `process-batches` | Time budget, hallucination guard skips, response count mismatches |
| `submit-ocr` | Backpressure (active jobs), circuit breaker (blocked books), pipeline exclusions, no-image skips |
| `submit-batch-ocr` | Backpressure (active batch jobs), estimated cost |
| `social-post` | 7 early return points (config, posting hours, daily limit, empty queue, etc.) |
| `social-reset` | Daily/monthly reset counts |
| `sync-page-counts` | Books updated, stale count mismatches |
| `sync-gallery-images` | Pages synced, orphans removed |
| `archive-ocr` | Pages archived/failed, bytes transferred |

### Indexes (cron_runs)

| Name | Fields | Purpose |
|------|--------|---------|
| `cron_runs_cron_ts_idx` | `{ cron: 1, timestamp: -1 }` | Per-cron history |
| `cron_runs_ts_idx` | `{ timestamp: -1 }` | Time-range scans |
| `cron_runs_status_ts_idx` | `{ status: 1, timestamp: -1 }` | Failed run queries |

### Pipeline Analytics Integration

`GET /api/analytics/pipeline` surfaces cron decisions alongside existing velocity, stalls, and cron health data:

- `cronHealth` — per-cron summary (last run, failures, avg duration, recent errors)
- `recentDecisions` — latest 50 decisions unwound from `cron_runs` where `decisions` is non-empty
- `stalls` — funnel stages growing/shrinking over time

---

## Audit Logger

`src/lib/audit-logger.ts` — `logAuditEvent()`. Non-blocking, typed actions. Writes to `audit_log` collection.

**Logged actions:** `book_imported`, `book_deleted`, `book_deleted_permanent`, `book_restored`, `book_reimported`, `book_metadata_updated`, `book_metadata_verified`, `pipeline_status_changed`, `edition_published`, `doi_minted`, `page_edited`, `reset_book_ocr`, `images_brightness_adjusted`

All audit events automatically appear in the Book History timeline.

## Book Metadata Changelog

`src/lib/book-changelog.ts` — `logMetadataChange()`. Append-only, non-blocking. Writes to `book_metadata_changelog` collection.

Tracks every field-level change to book metadata with before/after values. Hooked into 3 write paths:

| Write path | Source value | File |
|-----------|-------------|------|
| AI metadata enrichment | `ai_enrichment` | `src/lib/metadata-enrichment.ts` |
| Catalog verification (USTC/EFM) | `catalog_verification` | `src/app/api/books/[id]/verify-metadata/route.ts` |
| Admin PATCH edits | `admin_edit` | `src/app/api/books/[id]/route.ts` |

Each entry stores: `book_id`, `source`, `model` (for AI), `changes[]` (field + previous + new_value), `note`, `timestamp`.

Query: `getBookChangelog(db, bookId, limit?)` — returns entries newest first.
Diff utility: `diffBookFields(before, after, fields)` — computes `MetadataFieldChange[]` from two objects.

Changelog events appear in the Book History timeline as `metadata_change` type.

## Search Query Logging

Search queries are logged to `analytics_events` with `event: 'search_query'` from three routes: `/api/search`, `/api/search/unified`, `/api/books/[id]/search`.

## Cached Book-Level Counts

Book documents store `pages_count`, `pages_ocr`, and `pages_translated` as a **performance cache**. These are updated inline by workers and batch routes, and refreshed every 6 hours by the `sync-page-counts` cron.

- **Source of truth:** always the `pages` collection
- **Cron:** `GET /api/cron/sync-page-counts` (every 6h) — single aggregation + bulk update
- **Manual sync:** `POST /api/admin/sync-page-counts` (with `?dry_run=true` option)
- **`translation_percent`** is never stored — always computed at read time from `pages_translated / pages_count`

## Known Gaps

1. **No moderation audit** — annotations auto-approved, no tracking of admin approval/rejection. Needs admin UI + auth first.
