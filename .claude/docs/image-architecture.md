# Image Architecture

> R2-Only Policy: every image displayed on the site MUST be served from `images.sourcelibrary.org` (Cloudflare R2). No external hotlinking in production.

## R2 Storage Layout

```
images.sourcelibrary.org/
├── pages/{book_id}/{0001}.jpg            # 1200px page display images
├── pages/{book_id}/{0001}-thumb.jpg      # 150px page thumbnails
├── pages/{book_id}/{0001}-full.jpg       # Full-res original (OCR, zoom, download)
├── archived/{book_id}/{page}.jpg         # Legacy archived pages (rewritten to /pages/ at read time)
├── gallery/{book_id}/{page}-{idx}.jpg    # 1200px extracted illustrations
├── gallery/{book_id}/{page}-{idx}-thumb.jpg  # 150px illustration thumbnails
├── gallery/{book_id}/{page}-{idx}-full.jpg   # Full-res illustration
├── artwork/{slug}-full.jpg               # Full-res artwork originals
├── artwork/{slug}.jpg                    # 1200px display variant (some artworks)
├── artwork/{slug}-thumb.jpg              # 150px artwork thumbnail
├── covers/{book_id}.jpg                  # Book cover images
└── thumbnails/{book_id}/{page}.jpg       # Legacy path (rewritten to /pages/ at read time)
```

Path helpers: `src/lib/storage.ts` — `pagePaths()`, `galleryPaths()`, `coverPath()`, `r2Url()`.

## Progressive Loading Chain

### Book Pages
```
thumb (150px, instant) → display (1200px, ~200ms) → full (original, on-demand for OCR/download)
```

### Artworks
```
thumbnail_blob (150px, instant) → thumbnail (1200px+, ~1s) → archived_full_url (original, background for magnifier)
```

The `ArtworkHero` component loads all three progressively:
1. Shows `thumbnail_blob` immediately
2. Background-loads `thumbnail` (display size), swaps on ready
3. Background-loads hi-res (`archived_full_url` or derived R2 URL), swaps for magnifier

### Gallery Images
```
thumbnail_url (150px) → extracted_url (1200px) → image_url (full page context)
```

## Field Reference

### `books` Collection — Standard Books

| Field | Size | Source | Notes |
|-------|------|--------|-------|
| `thumbnail` | ~1200px | R2 or IIIF | Cover/display image. For books: first page. |
| `thumbnail_blob` | ~150px | R2 | Tiny cover for grids/search. |

### `books` Collection — Artworks (`resource_type` exists)

| Field | Size | Source | Notes |
|-------|------|--------|-------|
| `thumbnail` | Full-res | R2 `artwork/{slug}-full.jpg` | **Confusing name** — this is the full-res original for artworks |
| `thumbnail_blob` | 150px | R2 `artwork/{slug}-thumb.jpg` | Tiny thumbnail |
| `archived_full_url` | Full-res | R2 `artwork/{slug}-full.jpg` | Explicit full-res pointer (not all artworks have this set) |
| `commons_full_url` | Full-res | Wikimedia | Source URL (kept for provenance, NOT for display) |
| `commons_url` | — | Wikimedia | Link to Commons page (provenance only) |
| `commons_width` / `commons_height` | — | — | Original pixel dimensions |
| `full_width` / `full_height` | — | — | R2 archived dimensions |

**Deriving R2 URL from slug:** If `archived_full_url` is empty but `thumbnail` points to R2:
```
https://images.sourcelibrary.org/artwork/{slug-without-art-prefix}-full.jpg
```

### `pages` Collection

| Field | Notes |
|-------|-------|
| `photo` | Display-size page image (R2 `/pages/...`) |
| `photo_original` | IIIF source URL (provenance, not displayed) |
| `archived_photo` | R2 full-res `/pages/{book_id}/{0001}-full.jpg` |
| `enhanced_photo` | R2 full-res enhanced (contrast/dewarped) |
| `cropped_photo` | R2 cropped page (from spread splits) |

### `gallery_images` Collection

| Field | Size | Notes |
|-------|------|-------|
| `image_url` | Full page | Best available page image for context |
| `thumbnail_url` | 150px | Gallery grid thumbnail |
| `extracted_url` | 1200px | Cropped/extracted illustration |

**All three MUST point to `images.sourcelibrary.org`.** Run `scripts/lint-external-images.mjs` to check.

## Image Sources and Archival

| Source | Import Path | R2 Archival |
|--------|-------------|-------------|
| Internet Archive | `scripts/import/direct-ia-import.mjs` | Archived during import |
| Gallica (BnF) | `scripts/import/direct-iiif-import.mjs` | Archived during import |
| HathiTrust | IIIF import | Archived during import |
| Wikimedia Commons | `scripts/import-commons-artworks.mjs` | `scripts/archive-artwork-originals-fast.mjs` |
| Met Museum API | `scripts/import-met-artworks.mjs` | Must archive before linking |
| Art Institute Chicago | `scripts/import-aic-artworks.mjs` | Must archive before linking |
| Cleveland Museum | `scripts/import-cleveland-artworks.mjs` | Must archive before linking |
| Image Extraction | Pipeline (Lambda/Hetzner) | Generated directly on R2 |

### Museum Import Flow
1. Fetch metadata + image from museum API
2. Download full-res original
3. Generate three variants: full, display (1200px), thumb (150px)
4. Upload all to R2 `artwork/{slug}-{variant}.jpg`
5. Store R2 URLs in book document
6. **Never store museum API URLs in display fields**

## URL Rewriting (src/lib/utils.ts)

`getBookThumbnailUrl(book, size)` handles variant selection:
- Rewrites legacy `/thumbnails/` and `/archived/` paths to `/pages/`
- Converts between `-thumb.jpg`, `.jpg`, `-full.jpg` based on requested size
- For artworks: `-thumb.jpg` for grids, `-full.jpg` for display
- Rewrites Wikimedia direct URLs to `thumb.php` CDN endpoints

## Lint & CI

`scripts/lint-external-images.mjs` — exits 1 if any gallery_images or artwork thumbnails point outside R2. Run in CI or periodically:

```bash
set -a; source .env.production.local; set +a; node scripts/lint-external-images.mjs
```

## Field Rename (Issue #1588) — In Progress

Current naming is confusing (`thumbnail` means different things for books vs artworks). New canonical fields:

| New Field | Meaning | R2 Suffix |
|-----------|---------|-----------|
| `image_display` | Primary display (1200px) | `.jpg` |
| `image_thumb` | Small preview (150px) | `-thumb.jpg` |
| `image_full` | Highest resolution (artworks only) | `-full.jpg` |
| `image_source_url` | Where we got it (provenance) | n/a |

### Migration Status
- [x] Types define new fields (old marked `@deprecated`)
- [x] `getBookThumbnailUrl()` prefers new fields, falls back to old
- [x] All writers dual-write both field sets
- [x] All DB projections include new fields
- [x] Backfill script: `scripts/migration/backfill-image-fields.mjs`
- [ ] Run backfill on production
- [ ] Verify all pages render correctly with new fields
- [ ] Drop legacy fields (separate PR after soak period)
