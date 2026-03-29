# Data Quality

Known data issues, maintenance patterns, and quality rules. For thumbnail fixes, see `.claude/docs/thumbnails.md`.

## Active Issues

- **Orphaned pages (2026-03-16):** ~58K pages with ~164 book_ids that don't match any book. Issue #215.
- **False-positive page splits (2026-03-14):** 123K sliver pages across 657 books. Issue #182 (closed, tracked under #264).
- **Gallery images missing thumbnails (2026-03-10):** 48.5% of gallery images lack thumbnail/extracted URLs. Issue #148.
- **Cover quality (2026-03-18):** Digitizer inserts, bad covers, unarchived books. Issue #251.

## Book Visibility & Counts (CRITICAL)

34,462 total books, but **only ~13,085 are visible**. 21,377 are `hidden: true` with `hidden_reason: 'unarchived'` (images not on R2). Always use visible books as the denominator for stats.

| Status field | Count | Notes |
|-------------|-------|-------|
| draft | 35,186 | Default status — NOT about visibility |
| published | ~5 | Rarely used |
| null | 464 | Legacy books |

The `status` field does NOT control visibility. The `hidden` boolean does.

Book statuses by archive:
- Hidden + not on R2: 21,377 (no OCR, no translation)
- Visible + not on R2: 13,085 (pulling from source IIIF — all pipeline work is here)
- On R2: ~0 (R2 archiving tracks at page level via `archived_photo`, not book level)

## id vs _id Distinction (CRITICAL)

App uses `book.id` (not `_id`) for all lookups. Pages' `book_id` matches `book.id`. ~1,186 old books have `id !== _id`. Always use `book.id` in queries. Issues: #215, #218.

## Page Count Caches

`pages_count`, `pages_ocr`, `pages_translated` on books are performance caches synced by the `sync-page-counts` cron (6h). Source of truth: `pages` collection. `translation_percent` is never stored — computed at read time.

## Data Provenance Rule

ALL enrichment must write `field_provenance`: source, method, confidence, date on every metadata write. No silent writes. Issue #362.

## Lessons Learned

- **Translation tag sanitization (2026-03-15):** Sanitizer fixes unclosed/malformed XML tags in translations. Backfilled.
- **Cover selection algorithm (2026-03-19):** Covers now picked by `detected_images.gallery_quality` score, not just `page_type`. 810 books backfilled.
- **Semantic alignment scoring (2026-03-23):** Embedding-based OCR↔translation quality measurement. Per-page cosine similarity, flag threshold 0.82. Issue #340.
- **Never store `/api/image?url=` as `book.thumbnail` (2026-03-10):** Crashes SSR. Store direct http(s) URLs only.
