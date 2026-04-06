# Auto Split Pipeline — Handoff 2026-04-06

## PR #825: Automated spread detection → split → OCR pipeline

**Branch:** `worktree-feat-auto-split-pipeline`
**Status:** Ready for review

## What changed

### The automated flow for any new book

```
Phase 1.25: AR screen (free, sharp metadata)
  ├─ AR ≤ 1.2 → portrait → split_checked=true → normal OCR
  └─ AR > 1.2 → Gemini visual check (flash-lite, ~$0.001)
       ├─ NOT spread (foldout/map/table) → needs_splitting=false → normal OCR
       └─ IS spread → needs_splitting=true → spread-aware OCR

Phase 2: OCR submission
  ├─ needs_splitting=false → standard OCR prompt
  └─ needs_splitting=true → spread prefix prepended:
       - Gemini returns <split-position>N</split-position> (0-1000)
       - Left page OCR + <page-break/> + Right page OCR

Phase 3: OCR completion check → ocr_complete

Phase 3.1: Post-OCR spread split (NEW)
  - Finds: ocr_complete + needs_splitting=true + split_completed≠true
  - Runs split-book.mjs per book (subprocess, 5min timeout)
  - split-book.mjs: parses <split-position> from OCR, crops images at gutter,
    uploads halves to R2, deletes old pages, creates left/right page records
  - 10 books/cycle, smallest first, 3 retries before needs_attention
  - Safety: aborts if >20% pages fail (exit code 1)

Phase 3.5+: Metadata enrichment, translation, etc. (unchanged)
```

### BPH exclusion removed

BPH books (`image_source.provider === 'bph'`) were excluded from:
- Phase 2 Pass 1 (preview OCR)
- Phase 2 Pass 2 (full OCR)
- Phase 5 (translation — fresh books)
- Phase 5 (translation — partial books)

Reason for original exclusion: split quality audit (#523). Now resolved — 2,264/2,280 BPH books have split_checked=true.

## Commits

| Commit | What |
|--------|------|
| 1 | Phase 1.25 Gemini gate + BPH exclusion removal |
| 2 | Rework: remove inline center-split, keep Gemini as visual gate only |
| 3 | Phase 3.1: automated post-OCR split via split-book.mjs |
| 4 | Safety check in split-book.mjs (abort on >20% page failures) |
| 5 | Fix missing projections: needs_splitting, author, year in Phase 2 queries |

## Known issues and error modes

### Phase 1.25 errors
- **Image download timeout (15s)**: skips page, tries next sample. If ALL 5 sample pages fail, book is skipped (not marked split_checked) and retried next cycle.
- **Gemini API failure**: falls back to assuming spread (`isConfirmedSpread=true`). Safe because the spread OCR prompt handles non-spreads gracefully (returns `split_position=null`).
- **Gemini returns invalid JSON**: `isConfirmedSpread` stays false, book treated as non-spread. Slightly conservative — a real spread would get normal OCR (no split), but would eventually be caught by manual review.

### Phase 2 errors (spread OCR)
- **RECITATION filter**: Gemini blocks OCR on pages it thinks are copyrighted. The pipeline retries up to MAX_RETRIES times (Phase 3 loops back to archive_complete). If still failing, marks needs_attention.
- **File-based batch stuck at PENDING**: Known issue with Lite model inline batches. Forced to file-based for needs_splitting books (line 1310).
- **Preview pass without spread prefix**: Fixed in this PR — needs_splitting is now projected in the preview query.

### Phase 3.1 errors
- **split-book.mjs timeout (5min)**: Large books (800+ spreads = 1600+ pages) may exceed this. The orchestrator catches the timeout error, increments retry count, and retries next cycle.
- **Image download failures in split-book.mjs**: If >20% of pages fail, script aborts with exit code 1. Orchestrator increments split_retry_count. After 3 failures → needs_attention.
- **Missing <page-break/> in OCR**: split-book.mjs auto-runs Gemini OCR (realtime, flash-lite). This is a fallback for books where OCR happened before the spread prefix was applied. Adds cost but is self-correcting.
- **Page count mismatch**: split-book.mjs slices to IIIF source count. If book was already split (has 2x pages), only the original spread count is used. Rare edge case — only happens on resplit of already-split books.
- **R2 upload failures**: Individual page failures are tracked. The >20% safety check prevents catastrophic data loss.

### Legacy books (not covered by this automation)
- **16 BPH books** with `needs_resplit=true` but already past ocr_complete (at chapters_complete, translate_complete, or complete). These need manual `split-book.mjs` runs — the pipeline won't pick them up because their status isn't ocr_complete.
- **Books with needs_splitting=true from old pipeline**: Already have split_checked=true (set by old Phase 1.25). Will flow normally through Phase 2 with spread prefix and Phase 3.1 split.

## In-flight work (started this session)

- **1,001 BPH batch OCR submissions** via `submit-batch-ocr.mjs --count=1200 --max-pages=2600 --key=auto`. ~192K pages, ~$211 est. Running in background.
- **74 non-BPH incomplete books** requeued for realtime Lambda OCR. ~21K pages.
- **Batch submission script**: `/Users/dereklomas/sourcelibrary/scripts/tmp-requeue-incomplete-ocr.mjs` (tmp, don't commit)

## Files modified

- `scripts/workers/pipeline-orchestrator.mjs` — Phase 1.25 rework, Phase 3.1 new, BPH exclusion removal, projection fixes
- `scripts/split-book.mjs` — Safety check (abort on >20% page failures)

## Testing checklist

- [ ] Phase 1.25: portrait book → split_checked=true, no Gemini call
- [ ] Phase 1.25: wide foldout → Gemini says NOT spread → needs_splitting=false
- [ ] Phase 1.25: real spread → Gemini confirms → needs_splitting=true
- [ ] Phase 2: needs_splitting book gets spread prefix in OCR prompt
- [ ] Phase 3.1: picks up ocr_complete + needs_splitting books
- [ ] Phase 3.1: split-book.mjs runs successfully, sets split_completed=true
- [ ] Phase 3.1: retry on failure, needs_attention after 3 failures
- [ ] split-book.mjs: aborts on >20% page failures
- [ ] BPH books flow through Phase 2 and Phase 5 without exclusion
