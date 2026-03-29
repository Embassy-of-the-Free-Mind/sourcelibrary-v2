# Split Quality Audit — 2026-03-29

## What happened

Derek noticed `aspectRatio: 0.00` on BPH split pages and asked to investigate split quality. This turned into a broader audit of the entire page splitting infrastructure.

## Key findings

- **402,826 pages** with crops across **1,305 books** (mostly BPH)
- **98% of split detections** (386K/395K) had `aspectRatio: 0` due to Gemini detection path hardcoding it — **fixed**
- **Upload processing path** had **zero overlap** — the 1% overlap in batch-split/auto-split-ml routes was never used for most splits — **fixed** (now 1%)
- **812 BPH books** with aspect ratio >1.2 have unsplit spreads (two-page images with no crop). These would produce garbled OCR if processed.
- **Pipeline had no guard** against sending unsplit spreads to OCR — **fixed**
- Mayank's `skipSplitDetection: true` (026cdaa0) meant S3-imported BPH books skip detection entirely

## What was shipped (all on main, deployed to Hetzner)

1. **`ff752b55`** — aspectRatio fix (Gemini path computes from buffer). Upload path gets 1% overlap (was 0%).
2. **`436c370e`** — Split detection paused globally (`if (false && !skipSplitDetection)` in processing.ts)
3. **`b4ddc5ca`** — BPH books excluded from OCR (Phase 2) and translation (Phase 4) in pipeline orchestrator. Added unsplit spread guard in `submitOcrDirectly`.

## What needs doing next (tracked in #523)

### Immediate
- The BPH exclusion and split pause are blunt instruments. Once splitting is working well, remove them.

### Investigation (started, needs refinement)
- `scripts/experiments/split-quality-investigation.mjs` — compares OCR of split halves vs full spread
- Results in `scripts/output/split-quality-results.json` (4 pages analyzed)
- **Problem:** OCR variability between Gemini runs dominates the signal. Latin ligatures and abbreviations render differently each time. Need a better methodology to isolate actual gutter text loss from OCR variance.
- Derek wants to explore 1-2% extra overlap but wants evidence first

### Better investigation approach
- Instead of comparing two separate OCR runs, look at the **crop boundary directly**: does the last column of text pixels get cut off?
- Or: OCR the same crop at 0%, 1%, 2%, 3% overlap and diff those outputs (same image, varying crop = controlled experiment)
- Classify pages by margin width first (WIDE/MEDIUM/TIGHT/CURVED) to know how big the long tail is

### Infrastructure gaps
- Coordinate scale inconsistency: some crops use 0-100, others 0-1000
- Non-text images (spine shots) getting split
- Pipeline should check for unsplit spreads at the page level, not just book level

## Key files
- `src/lib/page-split/split-processing.ts` — detection + overlap (aspectRatio fix here)
- `src/lib/uploads/processing.ts` — split pause here (`if (false && ...`)
- `scripts/workers/pipeline-orchestrator.mjs` — BPH exclusion + unsplit guard
- `src/app/api/pages/batch-split/route.ts` — batch split with overlap
- `src/app/api/books/[id]/auto-split-ml/route.ts` — ML auto-split with overlap

## Derek's thinking
- Most books split fine with a simple 50% cut — generous margins
- The overlap question only matters for tight-binding edge cases
- We don't know how common tight bindings are yet
- Don't optimize until we know the actual problem size
- "Purpose driven" — measure before building
