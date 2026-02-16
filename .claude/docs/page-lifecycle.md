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

**Column detection:** OCR prompts include `<columns>N</columns>` metadata tag and `<column-break/>` marker between columns. Extracted by `extractColumns()` and stored as `page.columns` (number, only set for 2+). All 7 OCR save paths persist this field. See "Multi-Column Rendering" section below.

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
columns: number                         // 2+ for multi-column pages (from OCR <columns> tag)
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

## Multi-Column Rendering

Many early printed books use two-column layouts (e.g. Kircher's *Ars Magna*). The system detects and renders these with a dual approach.

### OCR Tags (Feb 2026, prompt v4.2026-02+)

Two complementary tags in OCR output:
- **`<columns>N</columns>`** — metadata classification. Easy for the model to produce. Extracted by `extractColumns()` in `src/lib/types/prompts/defaults.ts`, stored as `page.columns`.
- **`<column-break/>`** — inline marker at the physical column boundary. Left column text above, right column text below. Harder for the model to place precisely, but produces accurate layouts.

### Rendering (`NotesRenderer`)

`src/components/reader/NotesRenderer.tsx` renders multi-column pages as a CSS grid:

1. **Primary:** Split on `<column-break/>` marker. If found, each segment becomes a grid column.
2. **Fallback:** If `page.columns >= 2` but no `<column-break/>` marker exists, split at the nearest paragraph boundary around the 50% midpoint (requires 4+ paragraphs).
3. **Single column:** If neither condition met, render normally.

`TranslationEditor` passes `page.columns` to all three `NotesRenderer` instances (OCR view, translation view, modernized English view).

### Save Paths

All 7 OCR save paths extract and persist `columns`:
1. `src/workers/ocr-processor-logic.ts` — Lambda worker (success + RECITATION retry)
2. `src/app/api/cron/process-batches/route.ts` — Batch API cron
3. `src/app/api/books/[id]/batch-ocr-async/route.ts` — Batch OCR results collection
4. `src/app/api/contribute/process/route.ts` — Contributor processing
5. `src/app/api/admin/backfill-detected-images/route.ts` — Backfill route
6. `src/app/api/process/route.ts` — Single-page realtime processing

### Backfilling

Existing pages with OCR data that contains `<columns>` tags can be backfilled via the `backfill-detected-images` route, which also extracts columns. Pages processed before prompt v4.2026-02 won't have column tags in their OCR output.

## Prompt Versioning

Prompts are stored in the `prompts` MongoDB collection with **immutable versioning**:
- Each `{name, version}` pair is a unique, immutable document
- Updates create new versions (auto-incrementing version number), never modify old ones
- `is_default` flag marks which version is active for each prompt type
- DELETE is not supported — full audit trail preserved

**`PROMPT_VERSION`** constant (`src/lib/types/prompts/defaults.ts`) is a semantic tag stored on every page record. Bump it when prompts change materially. Current: `v4.2026-02`.

**DB prompt families** (with version history):
| Name | Type | Current Version | Key Features |
|------|------|----------------|--------------|
| Standard OCR | ocr | v5 | XML tags, page-type, image detection, columns |
| Latin OCR (Neo-Latin) | ocr | v3 | Latin-specific abbreviations, columns |
| German OCR (Fraktur) | ocr | v3 | Fraktur/Kurrent handling, columns |
| Standard Translation | translation | latest | General translation |
| Latin Translation | translation | latest | Neo-Latin conventions |
| German Translation | translation | latest | Early Modern German |
| Standard Summary | summary | latest | Reading summary |

**Lookup:** `getOcrPrompt()`, `getTranslationPrompt()`, `getSummaryPrompt()` in `src/lib/prompts.ts`. Falls back to hardcoded defaults if DB unavailable.

**API:** `GET /api/prompts?all_versions=true&type=ocr` to browse all versions.

## Stale Book-Level Fields

**Never trust:** `book.pages_ocr`, `book.translation_percent` — workers don't update these reliably. Always compute from pages collection:
```javascript
const pagesWithOcr = await db.collection('pages')
  .countDocuments({ book_id, 'ocr.data': { $exists: true, $ne: '' } });
```
