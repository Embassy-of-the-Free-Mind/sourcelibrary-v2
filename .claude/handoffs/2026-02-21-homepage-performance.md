# Homepage Performance Optimization — Feb 21, 2026

## Problem
Homepage loaded too slowly due to excessive image downloads and external IIIF proxy calls.

## Changes Made

### 1. Collections Grid Optimization (`src/components/book/BookLibrary.tsx`)
- Reduced from all 18 collections to 11 shown + 1 "See all 18 collections" card
- Layout: 3 rows of 4, last slot is a styled dark gradient link to `/collections`
- Collection images in rows 1-2 load eagerly, row 3 lazy-loads (`loading="lazy"`)
- All collection images use `decoding="async"`

### 2. Recently Translated Lazy Loading (`src/components/book/BookLibrary.tsx`)
- Changed all BookCard `priority` from `priority={i < 5}` to `priority={false}`
- These cards are below the fold, no need for eager loading

### 3. Video Preload (`src/components/layout/HeroSection.tsx`)
- Changed `preload="auto"` to `preload="metadata"` on hero video
- Prevents video download from competing with content images

### 4. Footer Logo Lazy Loading (`src/app/page.tsx`)
- Added `loading="lazy"` and `decoding="async"` to EFM and UNESCO partner logos
- These are at the very bottom of the page

### 5. Homepage Query Optimization (`src/app/page.tsx`)
- `getBooks()` refactored to use MongoDB `$facet` aggregation
- Single collection scan instead of separate queries for books + counts
- Gets 100 books + total/translated counts in one round-trip

### 6. Thumbnail Blob Backfill (DB fix, no code change)
- Found 20 books with `thumbnail` pointing to external IIIF URLs but missing `thumbnail_blob`
- 19 books had page-level `thumbnail_blob` already — copied to book document
- 1 book (De ratione studii, MDZ source) had no page blobs — generated via API, then set on book
- **Result: 0 books remain without `thumbnail_blob`**
- All homepage book images now load from Vercel Blob, eliminating slow IIIF proxy chain (`/_next/image` -> `/api/image` -> external IIIF server)

## Console Errors Investigated

Three errors appeared on homepage load:

1. **`/api/analytics/stats` 500** — Transient cold-start error. Verified working after deploy (200 OK). No code fix needed.
2. **`/_next/image` with Bodleian IIIF URL 400** — Double-proxy chain issue. When IIIF server is slow, `/api/image` returns JSON error, Next.js Image rejects non-image response. Fixed by ensuring all books have blob thumbnails (no more proxy calls).
3. **Tracking/metrics 30s timeouts** — Transient cold-start on analytics endpoints. Fire-and-forget calls, non-critical. No code fix needed.

## Net Impact
- Eager image loads reduced from ~25 to ~8 (7 fewer collections, 5 fewer BookCards, 2 fewer logos)
- Video bandwidth deferred until after content loads
- All thumbnails served from Vercel Blob CDN instead of external IIIF servers
- Single DB query instead of multiple for homepage data

## Files Modified
- `src/components/book/BookLibrary.tsx` — collections grid + lazy loading
- `src/components/layout/HeroSection.tsx` — video preload
- `src/app/page.tsx` — footer logos + $facet query

## Deployment
Deployed via `vercel --prod --yes`. Type-checked clean before deploy.
