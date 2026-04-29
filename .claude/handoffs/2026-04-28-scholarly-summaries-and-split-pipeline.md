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

## Next steps
1. Check audit results when complete
2. Build Phase 3 visual spot-check HTML page
3. Start batch splitting (Phase 4) after sign-off
4. Resume scholarly brief backfill
