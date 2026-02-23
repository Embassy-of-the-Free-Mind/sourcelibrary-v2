# Gallery Image & Thumbnail Fixes

**Date:** 2026-02-23
**PR:** https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/pull/64

## Problems Fixed

### 1. Gallery images disappearing on page load
**Symptom:** Gallery grid appeared briefly on SSR, then vanished while client-side data refetched, then reappeared.
**Root cause:** `GalleryClient.tsx` had `{!loading && data && ...}` gate on the grid. The `useEffect` set `loading = true` immediately, hiding the SSR content.
**Fix:** Grid stays visible during loading with opacity overlay. Loading spinner only shows when there's truly no data.

### 2. Gallery images falling through to placeholder icons
**Symptom:** Images that should render showed the placeholder icon (ImageIcon) instead.
**Root causes:**
- `/api/crop-image` was wrapped in `withAuth`, returning 401 for anonymous gallery visitors
- `GalleryCard` had a boolean `useCropFallback` state — only 2 states for 3 possible URLs. When the crop API failed, it jumped to placeholder instead of trying the raw IIIF URL.

**Fixes:**
- Removed `withAuth` from crop-image route (it's a read-only image transformation, public endpoint)
- Replaced boolean with staged `fallbackStage` counter walking through `[blob, crop, iiifThumbnail]` chain before showing placeholder

### 3. `archived_photo` missing from gallery sync pipelines
**Symptom:** 22,272 of 23,938 gallery_images stored external IIIF URLs (slow, sometimes 404) instead of fast Vercel Blob URLs — even though 76% of those pages had `archived_photo` set.
**Root cause:** The `archived_photo` field was missing from MongoDB `$project` stages AND from the `$ifNull` fallback chain in 4 separate locations.

**Fixed in:**
| File | What changed |
|------|-------------|
| `src/app/api/cron/sync-gallery-images/route.ts` | Added `archived_photo: 1` to projection + fallback chain |
| `src/app/api/admin/sync-gallery-images/route.ts` | Same |
| `scripts/workers/sync-worker.mjs` | Same (Hetzner worker) |
| `src/workers/image-extraction-processor-logic.ts` | Added `archived_photo` to `upsertGalleryImages` image URL chain |

### 4. Batch thumbnail generator for Hetzner
**File:** `scripts/workers/generate-thumbnails.mjs`
**Purpose:** Generate pre-cropped gallery images + 300px thumbnails for the 20,064 gallery images currently missing them. Uploads to Vercel Blob, updates both `pages.detected_images` and `gallery_images` collections.

**Usage:**
```bash
set -a; source .env.production.local; set +a; node scripts/workers/generate-thumbnails.mjs
node scripts/workers/generate-thumbnails.mjs --dry-run
node scripts/workers/generate-thumbnails.mjs --limit=500 --concurrency=10
node scripts/workers/generate-thumbnails.mjs --archived-only   # Only fast Blob sources
node scripts/workers/generate-thumbnails.mjs --book-id=BOOK_ID
```

**Config:** Default limit 5000, concurrency 8. Requires `MONGODB_URI` and `BLOB_READ_WRITE_TOKEN`.

## Data Quality Snapshot (2026-02-23)

| Metric | Count | % |
|--------|-------|---|
| Total gallery_images | 23,938 | 100% |
| Missing pre-generated thumbnails | 20,064 | 84% |
| Using external IIIF URLs | 22,272 | 93% |
| Have `archived_photo` available | ~17,000 | ~76% of IIIF |
| Bbox values needing normalization | 0 | 0% |

## Files Modified

- `src/components/gallery/GalleryClient.tsx` — loading state + fallback chain
- `src/app/api/crop-image/route.ts` — removed auth, public endpoint
- `src/app/api/cron/sync-gallery-images/route.ts` — archived_photo in projection + fallback
- `src/app/api/admin/sync-gallery-images/route.ts` — same
- `scripts/workers/sync-worker.mjs` — same (Hetzner)
- `src/workers/image-extraction-processor-logic.ts` — archived_photo in upsert
- `scripts/workers/generate-thumbnails.mjs` — NEW batch thumbnail generator

## Next Steps

1. **Run `generate-thumbnails.mjs` on Hetzner** — process the 20k backlog. Start with `--archived-only --limit=500` to test, then full run.
2. **Trigger gallery sync** after thumbnails are generated — `POST /api/admin/sync-gallery-images` or wait for next cron cycle.
3. **Monitor** — after sync, gallery_images should have `thumbnail_url` and `extracted_url` populated, and `image_url` should point to Blob URLs instead of IIIF.
