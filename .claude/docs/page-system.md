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

### Images — resolved through ONE function (issue #1727)

A page has ~8 image fields accumulated over time. **Do not re-implement the
precedence in consumers** — every image URL goes through the canonical resolver
`getPageImageUrl(page, size)` in `src/lib/page-image-url.ts` (pipeline scripts use
the JS twin `scripts/lib/page-image-url.mjs`). The legacy helpers
(`getPageDisplayUrl`, `getPageThumbUrl`, `utils.getPageImageUrl`,
`page.ts:pageImageUrl`) are now thin wrappers over it. This section is the single
declared source of truth — when in doubt, the resolver wins.

Two orthogonal axes:

**1. Size (universal):** `size ∈ thumb (~150px) | display (~1200px) | original
(full-res; OCR/download) | hires (~4000px; zoom)`. Tiers, cheapest → fallback:
pre-sized R2 variant (`display_photo` / `-thumb.jpg`, free egress) → IIIF-native
resize (`/full/{w},/`) → `/api/image` proxy → raw original (`original`/`hires`
only). **Never `/_next/image`** (metered). `display`/`thumb` are always
browser-safe (never `.jp2`/`.tif`) and size-bounded.

**2. Source identity (`getPageSource`, split-aware):** which file *is* this page.
Precedence:
1. `cropped_photo` — **old-era split**: the materialized cropped half
2. `split_from_spread` + `photo` — **new-era split**: `photo` is the `sp…` half
3. archiving failed (`failed:` prefix) → `null` (source URLs proven dead)
4. `enhanced_photo` — contrast/brightness-enhanced copy; preferred when present
   (a cover-selection pref, ~0% populated; placed *after* split handling so it
   can't reintroduce the spread)
5. `archived_photo` → `photo_original` → `photo`

**Split pages are the only non-trivial source case (~10%).** For split pages the
half lives in `cropped_photo` (old-era) or the `sp…` `photo` (new-era); the
`archived_photo`/`photo` for old-era split is the **full spread** — resolving to
it shows/OCRs the wrong image. The resolver handles this; consumers must not
hand-roll it.

**Crop-coords pages (~0.04%):** `crop.{xStart,xEnd}` set, no materialized
`cropped_photo`, not split → the resolver proxy-crops the source (a pre-sized
variant would be the *uncropped* image). Verified rare-but-real; preserved.

| Field | Role | Set by |
|---|---|---|
| `photo` | primary source URL (often the canonical `pages/…` path or external) | pipeline / import |
| `archived_photo` | R2 copy of the source (full image; the spread for old-era split) | archiving |
| `photo_original` | original source URL before processing | import |
| `cropped_photo` | the cropped half (old-era split only) | legacy split |
| `display_photo` | 1200px display variant on R2 | provenance/backfill |
| `image_thumb` | 150px thumbnail on R2 (canonical; supersedes `thumbnail_blob`) | provenance/backfill |
| `thumbnail_blob` | legacy 150px thumbnail | legacy import |
| `thumbnail` | s3-hosted 150px thumbnail (fallback) | pipeline |
| `enhanced_photo` | contrast-enhanced copy (rare) | enhancement |
| `compressed_photo` | legacy, unused | — |

**When modifying page images**: `$unset` fields you're not using, and prefer
writing the canonical `display_photo` / `image_thumb` (not `thumbnail_blob`).

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

The reader resolves images through the canonical `getPageImageUrl(page, size)`
(`src/lib/page-image-url.ts`) — `'display'` for the page image, `'hires'` for
zoom/magnifier, `'thumb'` for the grid. There is no longer a separate priority
chain per surface: size and source-identity are the only axes (see *Images —
resolved through ONE function* above). The `utils.ts` `getPageDisplayUrl` /
`getPageThumbUrl` are back-compat wrappers that call `getPageImageUrl(page,
'display'|'thumb')`.

## Common Pitfalls

1. **Setting `photo` doesn't change what's displayed** if legacy fields exist. Always `$unset` them.
2. **Hex ID book URLs cause redirect loops.** Always use slugs.
3. **CDN caches R2 images for 1 year.** Use new paths (e.g., `sp` prefix) instead of overwriting.
4. **`page_number` is sequential position, not the printed page number.** The printed number is in `<page-num>` tags.
5. **`pages_count` on book is a cache.** Update it after adding/removing pages.
6. **`id !== _id` on ~1,186 old books.** Always match on `id`, never `_id`.
7. **`ocr.data` contains raw XML tags.** They're stripped by NotesRenderer for display. Don't strip them in the DB.
8. **The translation pipeline expects single-page text.** Two-page OCR should be split before translation.
