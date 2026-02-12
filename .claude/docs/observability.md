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

The `cost_tracking` collection is deprecated — some legacy routes still write to it but reads should use `gemini_usage`.

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
| `audit_log` | Admin destructive actions (resets) | `book_id` |
| `analytics_pageviews` | Web traffic (path, referrer, country) | — |
| `analytics_events` | Deduplication index | `event + book_id + ip + timestamp` |
| `loading_metrics` | Frontend performance (p50, p95) | — |
| `likes` | User engagement (book/page/image) | — |
| `highlights` | User-selected passages | `book_id + page_id` |
| `annotations` | Community notes with threading | — |
| `social_posts` | Tweet scheduling and metrics | — |
| `split_adjustments` | ML split detection feedback | — |
| `cost_tracking` | **DEPRECATED** — use `gemini_usage` | — |

---

## Known Gaps

1. **audit_log is minimal** — only covers OCR/translation resets. Imports, deletes, edition publishing, manual page edits are not logged.
2. **cost_tracking still written** — legacy routes (`stitch-translations`, `modernize`, `process`, `batch-ocr`, `batch-translate`) still write to the deprecated collection.
3. **No page edit tracking** — no `manually_edited` or `manually_edited_at` fields on pages. Manual OCR/translation corrections are invisible.
4. **No moderation audit** — annotations auto-approved, no tracking of admin approval/rejection.
