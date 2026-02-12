# Page Processing Lifecycle

## Pipeline Overview

```
IMPORT → SPLIT DETECTION → ARCHIVE → OCR → TRANSLATION → SUMMARY → INDEX → IMAGE EXTRACTION
```

Each step is independent — a book can be at any stage. Not all steps are required.

## 1. Import

Routes: `/api/import/ia`, `/api/import/gallica`, `/api/import/mdz`, `/api/import/wellcome`, `/api/import/e-rara`

Creates book + page records. Pages get `photo` (original IIIF URL) and `photo_original` (preserved forever). Triggers split detection check asynchronously.

See: `.claude/docs/import-apis.md`

## 2. Split Detection

Detects two-page spreads in digitized books.

**Detection methods** (configurable via `SPLIT_DETECTION_METHOD_ON_UPLOAD`):
- `heuristic` — pixel analysis (free, fast)
- `ml` — trained model
- `gemini` — Gemini Vision (most accurate, costs API credits)
- `cascade` (default) — heuristic → ML → Gemini if low confidence

**Algorithm** (`src/lib/page-split/splitDetection.ts`):
1. Aspect ratio check: < 0.9 = single, > 1.3 = spread
2. Column statistics: per-column darkness analysis
3. Gutter detection: weighted scoring (P10 30%, dark run 35%, transitions 20%, consistency 15%)
4. Returns confidence (high/medium/low) and split position (0-1000 scale)

**Routes:**
- `GET /api/books/[id]/check-needs-split` — sample 2 pages, decide if book needs splitting
- `POST /api/pages/[id]/detect-split` — Gemini vision for one page
- `POST /api/books/[id]/auto-split-ml` — ML-based splitting for whole book

**Results:** `page.split_detection`, `page.crop` (coordinates 0-1000), `page.cropped_photo`

**Book-level:** `book.needs_splitting`, `book.split_check` (checked_at, confidence, reasoning)

## 3. Archive Images

Downloads images from external sources (IA, Gallica, MDZ) and re-hosts on Vercel Blob.

Route: `POST /api/books/[id]/archive-images`

- Downloads from original URLs
- Compresses with sharp (JPEG optimization)
- Uploads to Vercel Blob with content hash
- Sets `page.archived_photo` (Blob URL), `page.archive_metadata` (source_url, archived_at, bytes, checksum)
- Never overwrites `page.photo_original`

See: `.claude/docs/image-archiving.md`

## 4. OCR

Extracts text from page images using Gemini vision models.

**Routes:**
| Route | Type | Limit |
|-------|------|-------|
| `POST /api/books/[id]/batch-ocr` | Synchronous | 25 pages |
| `POST /api/books/[id]/batch-ocr-async` | Gemini Batch API | Unlimited |
| `POST /api/books/[id]/batch-ocr-multi` | Multi-batch | Large books |
| `POST /api/pages/[id]/ask` | Single page | 1 page |

**Model:** `gemini-3-flash-preview` (default). Language-specific prompts for Latin, German, Hebrew, Arabic, etc.

**Image fallback chain:** `cropped_photo` → `archived_photo` → `photo` → `photo_original`

**Result:** `page.ocr.data` (text), `page.ocr.model`, `page.ocr.language`, `page.ocr.source` (ai/batch_api/manual)

## 5. Translation

Translates OCR text to English. Requires pages to have `ocr.data` first.

**Routes:**
| Route | Type | Limit |
|-------|------|-------|
| `POST /api/books/[id]/batch-translate` | Synchronous | 50 pages |
| `POST /api/books/[id]/batch-translate-async` | Gemini Batch API | Unlimited |
| `POST /api/pages/[id]/modernize` | Single page | 1 page |

**Context:** Realtime (Lambda FIFO) includes previous page's translation for continuity. Batch API does not.

**Result:** `page.translation.data` (text), `page.translation.model`, `page.translation.language`, `page.translation.source`

## 6. Summary

Book-level reading summary generated from all page translations.

Route: `POST /api/books/[id]/summary` (or via job system)

Uses `gemini-3-flash-preview`. Result: `book.reading_summary` (overview, themes, quotes, generated_at, model).

## 7. Index

Book-level index extracting people, concepts, places, key terms.

Route: `POST /api/books/[id]/index`

Result: `book.index` (concepts, people, places, key terms, sectionSummaries, bookSummary, generatedAt).

## 8. Image Extraction

Detects illustrations, emblems, diagrams in page images.

Route: via `batch-ocr-multi` with `action: 'image_extraction'`, or Lambda worker.

**Result:** `page.detected_images[]` — each with type, description, subject[], bounding box, quality score, museum description. Gallery: `https://sourcelibrary.org/gallery?book=BOOK_ID`

## Page Type

Full definition: `src/lib/types/page.ts`

Key processing fields:
```
ocr: { data, language, model, source, updated_at, prompt_name }
translation: { data, language, model, source, updated_at }
summary: { data, model, updated_at }
detected_images: [{ description, subject[], type, bbox, quality }]
split_detection: { isTwoPageSpread, confidence, splitPosition }
crop: { xStart, xEnd, yStart, yEnd }   // 0-1000 scale
```

Key image fields:
```
photo          — current display URL
photo_original — original external URL (never overwritten)
archived_photo — Vercel Blob URL
cropped_photo  — result of split detection
thumbnail_blob — pre-generated 150px JPEG
```

## Page Snapshots

`src/lib/snapshots.ts` — auto-created when re-processing pages with manual edits:
```
id, page_id, book_id, snapshot_type (pre_ocr|pre_translate|manual_backup),
ocr_data, translation_data, summary_data,
created_at, triggered_by_job_id, restored_at, restored_by
```

## Stale Book-Level Fields

**Never trust:** `book.pages_ocr`, `book.translation_percent` — workers don't update these reliably. Always compute from pages collection:
```javascript
const pagesWithOcr = await db.collection('pages')
  .countDocuments({ book_id, 'ocr.data': { $exists: true, $ne: '' } });
```
