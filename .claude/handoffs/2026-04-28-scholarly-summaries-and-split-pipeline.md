# Scholarly Summaries & Split Pipeline Fix — 2026-04-28

## What was done

### 1. Scholarly summaries (PR #1397, merged)
- Rewrote book brief/abstract/detailed generation prompts from marketing-copy tone to scholarly-catalog tone
- Both `src/app/api/books/[id]/index/route.ts` and `stream/route.ts` updated
- Banned openers: "Step into", "Discover", "Explore", "Unlock", etc.
- 1,362 books started with "Step into..." — backfill script at `scripts/tmp-backfill-scholarly-briefs.mjs` (29 done, paused)

### 2. Split pipeline audit & fix
- **AR gate bug found:** `split-book.mjs` and `ar-gate-remaining.mjs` check only page 1 (always portrait cover). 830 BPH books wrongly marked as single pages.
- **100% false negative rate** confirmed across 65 sampled books
- **75% of affected books** have OCR that only reads one side of spreads

### 3. Gutter detection (new approach)
- Programmatic gutter detection: darkest/most-uniform column in center 10% of image
- Tested across Hebrew manuscript, German Fraktur, Latin Roman type — all clean
- `scripts/tmp-split-book-v2.mjs` — new split script with per-page AR check, R2 upload, retry logic

### 4. Test book: Asis Rimonim (fec0b295)
- Split: 79 spreads → 156 individual pages
- Images uploaded to R2, pages created in DB
- Queued for OCR (pipeline_status: needs_ocr)
- RTL ordering correct (right=recto for Hebrew)

### 5. Archived-spread filter (PR #1401, merged)
- Book page grid and reader nav now filter out `page_type: 'archived-spread'` and negative page_numbers

### 6. Full-res image viewer (PR #1404, merged)
- Fullscreen viewer now loads native-res archived image (4000-5000px+)
- Magnifier uses native resolution for sharper zoom

### 7. Stonehenge fix
- Removed bad crop data from 12 pages that were already single pages but had crop coordinates applied

## In progress

### Full split audit V4 (running in background)
- PID 73744, log at `/tmp/split-audit-v4-full.log`, report at `/tmp/split-audit-v4-full.json`
- V4 algorithm: Otsu binarization + vertical text-density projection + valley detection
- Checks 10 sample pages per book across all 830 books
- V1 results (completed): 685 clean, 140 warnings, 5 single, 0 errors
- V4 140-book warning subset: all looked good visually (see `/tmp/split-audit-v4.html`)

### Gutter detection evolution
- V1: darkest column near center — failed on printed books (text darker than gutter)
- V2: lowest variance column — failed on manuscripts (gutter darker than background)
- V3: widest low-variance band — better but inconsistent on some scan types
- V4: vertical projection profile (text pixel count per column) — robust across all tested scan styles
- All versions use 3% overlap on each side of the cut

### Backfill scholarly briefs (paused)
- 29/2353 done, script at `scripts/tmp-backfill-scholarly-briefs.mjs`
- Uses gemini-3.1-flash-lite-preview, existing index data as context

## GitHub issues
- #1406: Re-split 830 BPH books missed by AR gate (full plan with phases)

## Worktree
- Branch: `worktree-scholarly-summaries`
- 3 PRs merged (#1397, #1401, #1404)
- tmp scripts not committed (by convention)

## PRs shipped
- #1397: Scholarly summary prompts (merged)
- #1401: Filter archived-spread pages — JS only (merged, superseded by #1441)
- #1404: Full-res images in fullscreen viewer (merged)
- #1441: Filter archived spreads in MongoDB query, not JS — fixes limit(110) consuming all archived pages (merged)
- #1465: Image dimensions + download link in page reader (merged)

## Lessons learned (the hard way)
- **tenantId**: split pages must copy book's `tenantId`, not hardcode "default". BPH tenant is `bce03f71-c18d-4460-b8ad-224c817f9aa0`.
- **_id must match id**: normal pages have `_id === id`. ObjectId, not random hex.
- **Thumbnails**: must generate real 150px thumbs, not copy display_photo. Page grid is unusable without them.
- **Cover**: split script must update book thumbnail to a split page, not leave old spread.
- **Revalidation**: `/bph/book/...` tenant paths need separate revalidation via `/api/admin/revalidate` with explicit paths. The `revalidate-book` endpoint only revalidates non-tenant paths.
- **Query limit + sort**: `limit(110).sort({page_number:1})` with archived pages (negative numbers) fills the limit before any visible pages. Must filter in query, not JS.
- **display_photo quality**: 1200px/q80 resize is too lossy for manuscripts. For split pages, use the full-res crop as display_photo.

## Current state
- **2 books split**: Kabbalah (156p) + German (298p). Both have thumbnails, covers, correct tenantId.
- **V4 gutter detection**: Otsu binarization + vertical projection profile. Works well on clean books, needs Gemini fallback for hard cases.
- **V4 audit complete**: 364 clean, 461 warnings, 5 single. Visual review pages generated.
- **Split script** (`scripts/tmp-split-book-v2.mjs`): updated with V4 detection, 3% overlap, proper page schema (tenantId, thumbnails, dimensions, _id=id).

## Next steps
1. Run the 2 remaining pilot books (Latin, French) with updated script — verify on site
2. Batch the 364 clean books after pilot verification
3. Improve detection for 461 warning books (Gemini fallback)
4. Resume scholarly brief backfill (29/2353 done)
5. Queue split books for OCR/translation
