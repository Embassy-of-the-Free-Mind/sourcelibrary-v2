# Image Architecture

> R2-Only Policy: every image displayed on the site MUST be served from `images.sourcelibrary.org` (Cloudflare R2). No external hotlinking in production.

## R2 Storage Layout

```
images.sourcelibrary.org/
├── pages/{book_id}/{0001}.jpg            # 1200px page display images
├── pages/{book_id}/{0001}-thumb.jpg      # 150px page thumbnails
├── pages/{book_id}/{0001}-full.jpg       # Full-res original (OCR, zoom, download)
├── archived/{book_id}/{page}.jpg         # Legacy archived pages (77% of corpus; rewritten to /pages/ at read time — see caveat)
├── books/{book_id}/pages/{NNNN}.jpg      # Kloss/IDP/CCAG/PDF imports — single file, no variants
├── gallery/{book_id}/{page}-{idx}.jpg    # 1200px extracted illustrations
├── gallery/{book_id}/{page}-{idx}-thumb.jpg  # 150px illustration thumbnails
├── gallery/{book_id}/{page}-{idx}-full.jpg   # Full-res illustration
├── artwork/{slug}-full.jpg               # Full-res artwork originals
├── artwork/{slug}.jpg                    # 1200px display variant (some artworks)
├── artwork/{slug}-thumb.jpg              # 150px artwork thumbnail
├── covers/{book_id}.jpg                  # Book cover images
├── cropped/{book_id}/{objectId}.jpg      # Split-page crops (objectId filenames)
├── uploads/{book_id}/{objectId}.jpg      # Raw user uploads (objectId filenames)
└── thumbnails/{book_id}/{page}.jpg       # Oldest path (rewritten to /pages/ at read time)
```

Path helpers: `src/lib/storage.ts` — `pagePaths()`, `galleryPaths()`, `coverPath()`, `r2Url()`. The canonical pattern matrix, by-provider distribution, and current measured coverage live in [r2-storage.md](./r2-storage.md).

**Caveat — URL rewrites are aspirational, not validated.** `utils.ts` rewrites `archived/.../{N}.jpg` → `pages/.../{NNNN}.jpg` (or `-thumb.jpg`) at read time, assuming the target file exists. For ~20% of pages it doesn't — the archive worker wrote the legacy path but the canonical variants were never generated. Those pages render broken icons unless a component-level fallback kicks in. The gap is measured live at `/admin/r2-coverage`.

## Progressive Loading Chain

### Book Pages
```
thumb (150px, instant) → display (1200px, ~200ms) → full (original, on-demand for OCR/download)
```

### Artworks
```
thumbnail_blob / -thumb.jpg (600px, instant) → thumbnail / .jpg (~2000px, ~1s) → -full.jpg (original, magnifier)
```

R2 files per artwork: `artwork/{slug}-thumb.jpg`, `artwork/{slug}.jpg`, `artwork/{slug}-full.jpg`

The `ArtworkHero` component loads all three progressively:
1. Shows `-thumb.jpg` (600px) immediately
2. Background-loads `.jpg` (display ~2000px), swaps on ready
3. Background-loads `-full.jpg` (original), swaps for magnifier zoom

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
- [x] All writers dual-write both field sets — enforced by `buildCoverUpdate()` (see Cover-Write Contract below)
- [x] All DB projections include new fields
- [x] Backfill script: `scripts/migration/backfill-image-fields.mjs`
- [x] BPH embed APIs read canonical first (PR #1627, 2026-05-05)
- [ ] Run backfill on production
- [ ] Verify all pages render correctly with new fields
- [ ] Drop legacy fields (separate PR after soak period)

## Cover-Write Contract

There are four fields any cover writer must update **together**:
`image_display`, `image_thumb` (canonical) plus the dual-write mirrors
`thumbnail`, `thumbnail_blob`. Plus optional provenance:
`thumbnail_source`, `cover_page`, `cover_selected_at`,
`field_provenance.thumbnail`. Touching any subset (e.g. only legacy
fields) leaves the canonical reader-path stale and the rendered cover
unchanged — exactly the bug fixed in PR #1626.

**Single helper:** `buildCoverUpdate(page, opts)` in
`src/lib/cover-fields.ts` returns the full payload. Every UI/API/script
writer SHOULD route through it.

```ts
import { buildCoverUpdate } from '@/lib/cover-fields';

const update = buildCoverUpdate(page, {
  source: 'manual',
  actor: 'admin',
  method: 'cover-picker-ui',
  confidence: 1,
});
if (update) await books.update(bookId, update);
```

**PATCH allow-list:** `COVER_WRITE_FIELDS` (same module) is exposed as a
spreadable constant for PATCH allow-lists. Both
`/api/books/[id]` and `/api/[tenant]/books/[id]` import it, so adding
a new cover field threads through automatically.

**Node-side mirror:** `scripts/lib/cover-write.mjs` (TODO) — for pipeline
workers and one-shot scripts. Until that exists, scripts must produce
the same shape by hand or import a shared `.mjs` reference. Do not
re-derive the field list — keep them in lock-step.

**Read order:** `getBookThumbnailUrl(book, size)` in `src/lib/utils.ts`
prefers `image_display` (or `image_thumb`) over the legacy fields. BPH
embed API endpoints follow the same order:
`image_thumb || image_display || thumbnail_blob || thumbnail`.

### Cover Selection Algorithm

OCR-based scoring lives in `scripts/lib/cover-scoring.mjs`
(`scorePageForCover(page, { bookTitle? })`). The scorer is shared by:

- Pipeline orchestrator (Phase 3 + Phase 8.9)
- `scripts/maintenance/smart-cover-selection.mjs` (batch re-evaluation)

Score breakdown (highest first):
- `frontispiece` — +90 (with engraving keywords: +105)
- `decorated title-page` (woodcut/border/printer's mark) — +100
- `title-page with imprint` (excudebat/typis/apud/etc.) — +95
- `title-page` — +80
- `likely title-page` (no `page_type` but ≥3 OCR headings) — +70
- `illustration` — +60
- `dedication` — +15
- `text` — +5

Penalties (instant-disqualify, returns negative score):
- hidden — -200
- blank / "blank page" OCR — -100
- digitizer notice — -90
- physical book photo (binding/spine/fore-edge) — -80
- digitizer logo (Google, IA, ProQuest, e-rara, etc.) — -70
- BPH pelican bookplate (unless it IS the title page) — -65
- ex-libris / library bookplate (unless title page) — -60
- bleed-through / ghosting — -50

Plus position bonus: pages 1-5 get +5, 6-10 get +3, >15 get -3.

**Title-match bonus:** If the page OCR contains words from the book's
title, add +30. Helps when a pelican bookplate happens to be the first
page tagged `title-page`.

### Two-bug pattern that bit us 2026-05-05

1. **Renaming a field, missing an allow-list.** PR #1588 added canonical
   image fields and switched readers; PATCH allow-lists weren't updated;
   Cover Picker requests succeeded with only legacy fields persisted;
   `getBookThumbnailUrl` rendered the unchanged canonical → "spins and
   then nothing." Fixed in PR #1626; the `COVER_WRITE_FIELDS` constant
   removes the divergence vector.
2. **Synthetic URL paths that don't resolve to split images.** A naive
   one-shot picker wrote `pages/{id}/{NNNN}-thumb.jpg` URLs that served
   2 KB stubs of the original unsplit spread. The book detail page
   reads `page.cropped_photo` directly so click-through worked, but the
   BPH embed listing read the cached `thumbnail_blob` and showed the
   spread. Fix: `resolvePageCoverUrl(page)` in `cover-fields.ts` always
   uses `pageImageUrl()`, which prefers `enhanced_photo` →
   `cropped_photo` → `archived_photo` → `photo_original` → `photo`.

Full postmortem: `.claude/handoffs/2026-05-05-bph-cover-pipeline-postmortem.md`.
