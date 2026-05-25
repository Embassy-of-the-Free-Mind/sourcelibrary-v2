# Data Quality

Known data issues, maintenance patterns, and quality rules. For thumbnail fixes, see `.claude/docs/thumbnails.md`.

## Current Issues

For current data-quality issues, run `gh issue list --label data-quality --state open` — pinning specific issue numbers here goes stale fast (the four originally listed here — #215, #182, #148, #251 — are all closed as of April 2026).

Tracked under the auto-memory entry [[project-stale-bph-issues-2026-05]] (snapshot 2026-05-15): seven BPH-specific issues where PRs shipped partial fixes but issue bodies read as done — verify residual work before closing.

## id vs _id Distinction (CRITICAL)

App uses `book.id` (not `_id`) for all lookups. Pages' `book_id` matches `book.id`. ~1,186 old books have `id !== _id`. Always use `book.id` in queries. Issues: #215, #218.

## Page Count Caches

`pages_count`, `pages_ocr`, `pages_translated` on books are performance caches. Source of truth: `pages` collection. `translation_percent` is never stored — computed at read time. The old `sync-page-counts` cron has been archived; the endpoint now lives at `/api/admin/sync-page-counts` for manual reruns. Counter sync is the responsibility of any worker that writes to `pages` (see pipeline-ops.md "Critical Rules" — Hetzner workers must call counter sync helpers).

## Data Provenance Rule

ALL enrichment must write `field_provenance`: source, method, confidence, date on every metadata write. No silent writes. Issue #362.

## Lessons Learned

- **Translation tag sanitization (2026-03-15):** Sanitizer fixes unclosed/malformed XML tags in translations. Backfilled.
- **Cover selection algorithm (2026-03-19):** Covers now picked by `detected_images.gallery_quality` score, not just `page_type`. 810 books backfilled.
- **Semantic alignment scoring (2026-03-23):** Embedding-based OCR↔translation quality measurement. Per-page cosine similarity, flag threshold 0.82. Issue #340.
- **Never store `/api/image?url=` as `book.thumbnail` (2026-03-10):** Crashes SSR. Store direct http(s) URLs only.
