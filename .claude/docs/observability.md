# Observability & Audit Trail

## Book History Timeline

Every book page shows a "Book History" section (`BookHistory` component) that displays a provenance timeline assembled from multiple data sources.

**API:** `GET /api/books/[id]/history`
**Component:** `src/components/book/BookHistory.tsx`
**Client:** `books.history(bookId)` in `src/lib/api-client/books.ts`

### Data Sources (5 parallel queries)

| Source | Collection | Events generated |
|--------|-----------|-----------------|
| Book document | `books` | imported, summary, index, edition_published |
| AI usage | `gemini_usage` | ocr, translation, summary, index, image_extraction |
| Processing jobs | `jobs` | ocr, translation (with progress: completed/total/failed) |
| Page stats | `pages` | archived (aggregate count + dates) |
| Admin log | `audit_log` | admin_action (OCR resets, etc.) |

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
| `audit_log` | Admin/system actions (imports, deletes, edits, resets, editions, DOIs) | `book_id` |
| `analytics_pageviews` | Web traffic (path, referrer, country) | `timestamp`, `path + timestamp` |
| `analytics_events` | Deduplication index + search query logging | `event + book_id + ip + timestamp` |
| `loading_metrics` | Frontend performance (p50, p95) | — |
| `likes` | User engagement (book/page/image) | `target_type + target_id + visitor_id` (unique), `target_type + target_id`, `visitor_id + target_type` |
| `highlights` | User-selected passages | `book_id + page_id` |
| `annotations` | Community notes with threading | `book_id + page_id` |
| `social_posts` | Tweet scheduling and metrics | — |
| `split_adjustments` | ML split detection feedback | — |
| `cost_tracking` | **DEPRECATED** — no active writers/readers, use `gemini_usage` | — |

---

## Audit Logger

`src/lib/audit-logger.ts` — `logAuditEvent()`. Non-blocking, typed actions. Writes to `audit_log` collection.

**Logged actions:** `book_imported`, `book_deleted`, `book_deleted_permanent`, `book_restored`, `book_reimported`, `book_metadata_updated`, `edition_published`, `doi_minted`, `page_edited`, `reset_book_ocr`

All audit events automatically appear in the Book History timeline.

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
