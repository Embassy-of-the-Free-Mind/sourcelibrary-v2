# Image Variant System

Source Library stores multiple resolution variants of every page image on R2.
Understanding which variant to use where is critical for both performance and visual quality.

## R2 Path Convention

All page images live under `images.sourcelibrary.org/pages/{bookId}/`:

| Variant | Path | Size | Quality | Use case |
|---------|------|------|---------|----------|
| **Full** | `{num}-full.jpg` | Original resolution | Lossless | OCR input, zoom, download |
| **Display** | `{num}.jpg` | 1200px wide | 85 | Browser display, cards, grids, heroes |
| **Thumb** | `{num}-thumb.jpg` | 150px wide | 60 | Tiny previews, search dropdowns |

Gallery images follow the same convention under `gallery/{bookId}/{imageId}`:
- `{id}-full.jpg` — full extracted crop
- `{id}.jpg` — 1200px display
- `{id}-thumb.jpg` — 300px thumbnail (gallery thumbs are larger than page thumbs)

Legacy paths (both have corresponding `/pages/` variants — `getBookThumbnailUrl()` rewrites automatically):
- `archived/{bookId}/{num}.jpg` — full-res originals (pre-convention)
- `thumbnails/{bookId}/{num}.jpg` — small standalone thumbnails (pre-convention, ~37% of books)

## Path Helpers

`src/lib/storage.ts` exports deterministic path builders:

```ts
pagePaths(bookId, pageNumber)   // → { full, display, thumb }
galleryPaths(bookId, imageId)   // → { full, display, thumb }
```

## Choosing the Right Variant in UI Code

Use `getBookThumbnailUrl()` from `src/lib/utils.ts`:

```ts
// Card grids, collection pages, heroes — anything >100px display size
getBookThumbnailUrl(book)               // → 1200px display variant (default)
getBookThumbnailUrl(book, 'display')    // → same, explicit

// Search dropdown previews, tiny list thumbnails — anything <100px
getBookThumbnailUrl(book, 'thumb')      // → 150px thumb variant
```

The function:
1. Takes `thumbnail_blob` or `thumbnail` from the book object
2. If it's an R2 `/pages/` URL, rewrites the suffix to the requested variant
3. For non-R2 URLs (Internet Archive, external), returns as-is

**Never use `thumbnail_blob || thumbnail` directly in UI code.** Always go through `getBookThumbnailUrl()`.

## Database Fields

Books have two thumbnail URL fields:

| Field | Typical content | Notes |
|-------|----------------|-------|
| `thumbnail` | Full-res or display R2 URL, or external hotlink | Set during archiving |
| `thumbnail_blob` | Usually the `-thumb.jpg` variant | Set during archiving |

These fields are not standardized — the same field might contain a `-full.jpg`, `.jpg`, or `-thumb.jpg` URL
depending on when and how the book was archived. That's why `getBookThumbnailUrl()` normalizes at runtime.

## Provenance Marks

~10% of display variants have subtle provenance marks baked in:
- 16x16 icon watermark in a random corner
- `sourcelibrary.org` attribution in bottom-right
- CC BY-SA 4.0 text at top edge (nearly invisible)
- EXIF metadata (Copyright, Artist, ImageDescription)

Applied by `scripts/workers/lib/display-image.mjs` during archiving.

## Generation Pipeline

Variants are created by archive workers (`scripts/workers/archive-*.mjs`):
1. Download source image (IIIF, JP2, PDF page)
2. Upload original as `-full.jpg`
3. Resize to 1200px → apply provenance marks (10% chance) → upload as `.jpg`
4. Resize to 150px → upload as `-thumb.jpg`

The shared function `uploadPageVariants()` in `scripts/workers/lib/display-image.mjs` handles all three.
