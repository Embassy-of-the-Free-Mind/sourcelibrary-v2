# Page System Reference

## Page Record Fields

### Identity
| Field | Type | Notes |
|---|---|---|
| `id` | string | App-level ID. Used in all lookups, URLs, cross-references. NOT always equal to `_id`. See lesson-id-vs-_id.md. |
| `_id` | ObjectId | MongoDB internal ID. ~1,186 old books have `id !== _id`. |
| `book_id` | string | Matches `book.id` (NOT `book._id`). |
| `page_number` | number | Sequential position in the book. 1-indexed. NOT the visible printed page number. |
| `tenant_id` | string | Always `'default'`. Legacy multi-tenant field. |

### Images — The Priority Chain

The page has 6 image-related fields accumulated over time. The frontend checks them in priority order, which means setting `photo` alone may not change what's displayed.

| Field | What it is | Set by | Frontend priority |
|---|---|---|---|
| `photo` | Primary display image (1200px) | Standard pipeline, split pipeline | Last (after all others) |
| `photo_original` | Original source URL before processing | Import pipeline | 3rd |
| `archived_photo` | Locally cached copy of source image | Archiving pipeline | 2nd |
| `cropped_photo` | Cropped version from old split detection | Legacy split pipeline | 1st |
| `thumbnail` | 150px grid thumbnail | Standard pipeline, split pipeline | 4th in thumb chain |
| `thumbnail_blob` | Vercel Blob era thumbnail | Legacy import | 2nd in thumb chain |
| `display_photo` | 1200px display JPEG with provenance marks | Provenance pipeline | Not in standard chain |
| `compressed_photo` | Compressed version | Legacy | Not used |

**The rule**: For split-from-spread pages (`split_from_spread: true`), the frontend bypasses this chain entirely and uses `photo`/`thumbnail` directly. See PR #719.

**For all other pages**, the chain is:
- Thumbnails: `thumbnail_blob` → derive from `photo` path → `thumbnail` → proxy fallback
- Display: `cropped_photo` → `archived_photo` → `photo_original` → `photo`

**When modifying page images**: always `$unset` fields you're not using, or they'll override your changes.

### R2 Storage Path Conventions

```
pages/{bookId}/{NNNN}.jpg          — 1200px display image
pages/{bookId}/{NNNN}-full.jpg     — full-resolution original
pages/{bookId}/{NNNN}-thumb.jpg    — 150px thumbnail
pages/{bookId}/sp{NNNN}.jpg        — split page (sp prefix avoids CDN cache)
pages/{bookId}/sp{NNNN}-full.jpg   — split page full-res
pages/{bookId}/sp{NNNN}-thumb.jpg  — split page thumbnail
```

NNNN is 4-digit zero-padded page number. The `sp` prefix is used for pages created by spread splitting to avoid serving CDN-cached spread images at the same path.

CDN cache: `Cache-Control: max-age=31536000` (1 year). You cannot invalidate by re-uploading — use a new path instead.

### OCR

| Field | Type | Notes |
|---|---|---|
| `ocr.data` | string | Raw OCR text with inline XML metadata tags |
| `ocr.model` | string | Gemini model used |
| `ocr.prompt_version` | string | e.g., `'spread-v1+ocr-v10'` |
| `ocr.language` | string | Detected language (extracted from OCR or set by pipeline) |
| `ocr.source` | string | `'batch_api'`, `'spread-split'`, `'realtime'` |
| `ocr.input_tokens` | number | Gemini input tokens |
| `ocr.output_tokens` | number | Gemini output tokens |
| `ocr.batch_job_id` | string | Batch job that produced this OCR |
| `ocr.updated_at` | Date | When OCR was last updated |

### OCR Metadata Tags

The OCR text contains inline XML tags that serve dual purposes:
1. **Stored as structured fields** on the page record (by batch-collector or split pipeline)
2. **Stripped from display** by `NotesRenderer.tsx` and shown in a sidebar panel

| Tag | Stored as | Displayed in |
|---|---|---|
| `<language>X</language>` | `ocr.language` | Notes panel |
| `<script>X</script>` | `script_type` | Notes panel |
| `<page-type>X</page-type>` | `page_type` | Notes panel, navigation |
| `<page-num>X</page-num>` | (display only) | Notes panel |
| `<header>X</header>` | (display only) | Notes panel |
| `<sig>X</sig>` | (display only) | Notes panel |
| `<warning>X</warning>` | (display only) | Notes panel (highlighted) |
| `<meta>X</meta>` | (display only) | Notes panel |
| `<vocab>X</vocab>` | (display only) | Notes panel as term list |
| `<margin>X</margin>` | (inline) | Rendered inline in text |
| `<unclear>X</unclear>` | (inline) | Rendered inline with styling |
| `<image-desc ...>X</image-desc>` | `detected_images[]` | Rendered inline |
| `<column-break/>` | `columns` count | Line break in text |
| `<columns>N</columns>` | `columns` | Not displayed |

**Important**: The `NotesRenderer` in `src/components/reader/NotesRenderer.tsx` handles ALL tag stripping. If you add a new tag to the OCR prompt, add extraction logic there too.

### Translation

| Field | Type | Notes |
|---|---|---|
| `translation.data` | string | Translated text (English) |
| `translation.model` | string | Gemini model used |
| `translation.source_language` | string | Source language |
| `translation.target_language` | string | Always `'English'` |
| `translation.prompt_version` | string | Translation prompt version |
| `translation.source` | string | `'batch_api'`, `'hetzner'`, `'realtime'` |

### Page Classification

| Field | Type | Notes |
|---|---|---|
| `page_type` | string | One of: `title-page`, `frontispiece`, `dedication`, `preface`, `toc`, `index`, `errata`, `colophon`, `appendix`, `blank`, `illustration`, `diagram`, `map`, `text`, `digitizer-insert` |
| `columns` | number | Number of text columns (only set if > 1) |
| `script_type` | string | `'printed'`, `'handwritten'`, `'mixed'` |
| `detected_images` | array | Illustrations detected by OCR or image extraction pipeline |

### Spread Splitting

| Field | Type | Notes |
|---|---|---|
| `split_from_spread` | boolean | `true` if created by spread splitting. Tells frontend to skip legacy image chain. |
| `split_side` | string | `'left'`, `'right'`, or `'single'` |
| `split_position` | number | 0-1000 gutter position used for cropping |
| `split_source_page` | string | ID of original spread page (only on right pages) |

### Other Fields

| Field | Type | Notes |
|---|---|---|
| `display_brightness` | number | CSS brightness override (1.0 = normal) |
| `read_count` | number | Analytics: times this page was viewed |
| `semantic_alignment` | object | OCR↔translation quality score |
| `translation_summary` | string | 1-2 sentence summary extracted from translation |
| `translation_keywords` | string[] | Key concepts extracted from translation |

## Page URLs

### Book page (grid view)
```
/book/{slug}                    — works (preferred)
/book/{hex-id}                  — BROKEN: causes redirect loop. Never use hex IDs.
```

Always use `bookUrl(book)` which returns slug-based URLs.

### Individual page (reader view)
```
/book/{slug}/page/{pageId}      — works
/book/{slug}/page/{page-number} — may work depending on route config
```

The reader loads the page by `pageId` from the API. The `pageId` is the page's `id` field (NOT `_id`).

### Image URLs
```
/api/image?url={encoded-url}&w=200&q=70     — proxy + resize
/api/image?url={url}&w=150&q=60&cx=0&cw=500 — proxy + crop (legacy split)
```

The image proxy fetches from the source URL, resizes/crops, and serves. Used for thumbnails and previews. NEVER store proxy URLs as `book.thumbnail` — it crashes SSR.

## Book-Level Page Caches

These fields on the `book` record are performance caches, synced by the `sync-page-counts` cron (6h):

| Field | Source of truth |
|---|---|
| `pages_count` | `db.pages.countDocuments({ book_id })` |
| `pages_ocr` | `db.pages.countDocuments({ book_id, 'ocr.data': { $exists: true, $ne: null } })` |
| `pages_translated` | `db.pages.countDocuments({ book_id, 'translation.data': { $exists: true, $ne: null } })` |
| `pages_blank` | `db.pages.countDocuments({ book_id, page_type: 'blank' })` |
| `translation_percent` | Computed at read time, never stored |

After any operation that changes page count or OCR status, update these fields on the book. Don't wait for the cron.

## The Reader Component

The page reader (`src/app/book/[id]/page/[pageId]`) shows:
1. **Page image** — loaded from `photo` (or fallback chain for non-split pages)
2. **OCR text** — `ocr.data` rendered through `NotesRenderer` which strips metadata tags
3. **Translation** — `translation.data` if available
4. **Notes panel** — metadata extracted from OCR tags by NotesRenderer
5. **Navigation** — prev/next by page_number, with page count from book

The reader uses `getPageImageUrl()` in `src/lib/utils.ts` for hi-res display images. This has a DIFFERENT priority chain than `getPageThumbUrl()`:

```typescript
export function getPageImageUrl(page) {
  // For hi-res: prefer archived → photo_original → photo
  // Split pages: photo directly (via split_from_spread check)
}
```

## Common Pitfalls

1. **Setting `photo` doesn't change what's displayed** if legacy fields exist. Always `$unset` them.
2. **Hex ID book URLs cause redirect loops.** Always use slugs.
3. **CDN caches R2 images for 1 year.** Use new paths (e.g., `sp` prefix) instead of overwriting.
4. **`page_number` is sequential position, not the printed page number.** The printed number is in `<page-num>` tags.
5. **`pages_count` on book is a cache.** Update it after adding/removing pages.
6. **`id !== _id` on ~1,186 old books.** Always match on `id`, never `_id`.
7. **`ocr.data` contains raw XML tags.** They're stripped by NotesRenderer for display. Don't strip them in the DB.
8. **The translation pipeline expects single-page text.** Two-page OCR should be split before translation.
