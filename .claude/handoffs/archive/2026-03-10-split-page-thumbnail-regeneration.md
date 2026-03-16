# Split Page Thumbnail Regeneration

**Date:** 2026-03-10
**Status:** Complete

## Problem

426 books (364,972 pages) had `thumbnail_blob` generated from the original unsplit two-page spread images. These pages also had `crop` + `cropped_photo` (properly split single-page images on Vercel Blob). The display bug was already fixed in an earlier session — `BookPagesSection.tsx` and `PageThumbnail.tsx` prefer `cropped_photo` over `thumbnail_blob` for split pages. But this meant every split page was serving a full-size `cropped_photo` (~200-500KB) instead of a 150px JPEG thumbnail (~5-15KB).

## Fix

Added `--split-only` flag to `scripts/thumbnails/generate-thumbnails-fast.ts` that:

1. Queries pages with `crop` + `cropped_photo` (https) + `thumbnail_blob` (https) — i.e., split pages with existing wrong thumbnails
2. Downloads `cropped_photo` (the correct single-page image)
3. Resizes to 150px JPEG with sharp
4. Uploads to Vercel Blob at the same path (`allowOverwrite: true`)
5. Updates `page.thumbnail_blob` in MongoDB

### Implementation details

- **Cursor pagination:** The initial approach of loading all 365k docs with `.toArray()` timed out on MongoDB Atlas. Switched to `_id`-based pagination (fetch 5k chunks using `_id: { $gt: lastId }`).
- **Skipped `countDocuments`:** The regex-heavy query was too slow for a count on 916k pages. Split-only mode skips the count and just processes chunks until empty.
- **Connection timeout:** Bumped `serverSelectionTimeoutMS` from 10s to 30s for Atlas reliability.

## Results

- **364,969 regenerated**, 3 failed (0.001% failure rate)
- **27.8 pages/sec** average throughput at concurrency 20
- **3.6 hours** total runtime
- **Cost:** ~$10-15 in Vercel Blob operations (PUT at $5/1M, data transfer at $0.05/GB)

## Run command

```bash
set -a; source .env.production.local; set +a; npx tsx scripts/thumbnails/generate-thumbnails-fast.ts --split-only --concurrency=20
```

## Commits

- `40f8ffe0` — Add --split-only flag to thumbnail generator
- `c89a8b04` — Optimize: cursor pagination and skip slow countDocuments

## Related

- Display fix (earlier session): `BookPagesSection.tsx` and `PageThumbnail.tsx` prefer `cropped_photo` over `thumbnail_blob` for split pages
- Book-level thumbnail fix (earlier): `fixStaleThumbnail()` in pipeline cron handles stale unsplit `book.thumbnail` URLs
- Thumbnail docs: `.claude/docs/thumbnails.md`
