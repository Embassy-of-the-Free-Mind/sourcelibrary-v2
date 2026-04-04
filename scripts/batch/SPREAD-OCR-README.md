# BPH Spread OCR — Batch Submission Guide

## What this does

Submits BPH two-page spread books for combined split detection + OCR via the existing Gemini Batch API infrastructure. One API call per spread page returns:
- `<split-position>N</split-position>` — where to crop (0-1000 scale)
- Left page OCR with full metadata tags
- `<page-break/>` separator
- Right page OCR with full metadata tags

## Scripts

### `scripts/batch/submit-spread-ocr.mjs` — Submit books

```bash
set -a; source .env.production.local; set +a

# Dry run — see what would be submitted
node scripts/batch/submit-spread-ocr.mjs --count=10 --dry-run

# Submit 5 small books for testing
node scripts/batch/submit-spread-ocr.mjs --count=5 --key=auto

# Submit a specific book
node scripts/batch/submit-spread-ocr.mjs --book-id=69c8a26f6c6f3cc53c85e418

# Production: submit 100 books, round-robin keys
node scripts/batch/submit-spread-ocr.mjs --count=100 --key=auto --delay=5
```

### `scripts/workers/batch-collector.mjs` — Collect results

Existing collector. Run after batch jobs complete:
```bash
node scripts/workers/batch-collector.mjs
```

**TODO**: Update collector to handle `<page-break/>` in spread OCR results (see "After Collection" below).

### `scripts/tmp-split-one-book-v3.mjs` — Post-collection processing

After OCR results are collected, this script:
1. Crops images at `<split-position>` + 1% overlap
2. Uploads cropped halves to R2 (with `sp` prefix)
3. Updates original pages as left pages, inserts right pages
4. `$unset`s stale image fields
5. Updates book counts and cover

## Pipeline flow

**IMPORTANT**: The Vercel `batch-ocr-async` route uses INLINE submission for books <20 pages.
Inline does NOT work with `gemini-3.1-flash-lite-preview` (jobs stuck PENDING forever).
The Hetzner `pipeline-orchestrator.mjs` uses FILE-BASED submission which works.
See `.claude/docs/spread-splitting.md` "Batch Submission — Critical Details" for full explanation.

**Recommended path**: Modify the Hetzner orchestrator to detect spread books and prepend the
spread prefix to the OCR prompt. This reuses the proven file-based submission, key rotation,
safety settings, and file cleanup — all already working at scale.

```
1. pipeline-orchestrator.mjs (on Hetzner)
   └─ Detects needs_splitting books, prepends spread prefix to OCR prompt
   └─ Downloads images, builds JSONL with safety settings
   └─ Uploads JSONL via Files API (file-based, NOT inline)
   └─ Creates batch job via REST API (same key as upload)
   └─ Deletes uploaded file immediately
   └─ Creates batch job tracked in batch_jobs collection

2. Gemini processes batch (15-60 min typically)

3. batch-collector.mjs
   └─ Polls batch_jobs for completed jobs
   └─ Downloads results, matches by metadata.key to page IDs
   └─ Saves OCR to pages.ocr.data
   └─ TODO: parse <page-break/> and split into left/right

4. tmp-split-one-book-v3.mjs (per book)
   └─ Reads OCR from pages, extracts <split-position>
   └─ Crops images, uploads to R2
   └─ Creates right-page records
   └─ Updates book
```

## Known Issues & Mitigations

### 1. Inline vs file-based batch submission
**Issue**: Inline batch submission (`ai.batches.create({ src: [...] })`) has a ~20MB payload limit. With base64 images, this limits to ~8-10 pages per batch. Our first attempt submitted 20 pages inline and jobs stuck at PENDING forever.
**Mitigation**: The `batch-ocr-async` route automatically uses file-based submission for larger batches. Always submit through the route, never directly via SDK.

### 2. CDN cache of spread images
**Issue**: R2 images are cached for 1 year. Re-uploading a cropped image at the same path doesn't invalidate the cache. Old spread images continue to serve.
**Mitigation**: Use `sp` prefix on all R2 paths for split pages: `pages/{bookId}/sp{NNNN}.jpg`. New paths = no stale cache.

### 3. Frontend image priority chain
**Issue**: The frontend checks `cropped_photo > archived_photo > photo_original > photo`. If any legacy field points to a spread image, it overrides the cropped `photo`.
**Mitigation**: `$unset` all legacy fields on split pages. The frontend bypass (PR #719) also skips the chain entirely when `split_from_spread: true`.

### 4. Safety blocks (~2-5% of pages)
**Issue**: Gemini blocks some historical occult/religious content. Blocked pages have no OCR result.
**Mitigation**: The collector handles partial results. Blocked pages can be retried with `gemini-3-flash-preview` (less aggressive safety) or flagged for manual review.

### 5. UvA IIIF image timeouts
**Issue**: ~133 BPH books have images on `images.uba.uva.nl` which frequently timeout.
**Mitigation**: The route has per-image timeouts and skips failed images. Books with >50% image failures should be deferred.

### 6. Model pricing confusion
**Issue**: Pricing varies significantly between models and between realtime/batch.
**Actual pricing (from Gemini docs, 2026-04-01)**:
- `gemini-3.1-flash-lite-preview` batch: input $0.125/1M, output $0.75/1M
- `gemini-3-flash-preview` batch: input $0.25/1M, output $1.50/1M
- Per spread page: ~2,400 input + ~900 output tokens
- 184K pages with Lite batch: **~$45**

### 7. Books already partially processed
**Issue**: Some books were split by earlier scripts with different field conventions.
**Mitigation**: Check `split_completed` flag before processing. Use `--force` only intentionally. The v3 script is non-destructive (updates in place, doesn't delete).

### 8. `<page-break/>` parsing in collector
**Issue**: The existing batch-collector saves the full OCR text to `ocr.data` without splitting on `<page-break/>`. For spread OCR, we need to split the text and create separate page records.
**Mitigation**: TODO — update collector or add post-processing step. Until then, the full spread OCR lands in `ocr.data` and the v3 script handles splitting.

## Cost estimate

| Books | Pages | Model | Batch cost |
|---|---|---|---|
| 1,114 | ~184K | gemini-3.1-flash-lite | ~$45 |
| 1,114 | ~184K | gemini-3-flash-preview | ~$90 |

## Testing checklist

- [x] Prompt tested on 159+ pages across 5+ full books
- [x] 8 books fully split and live (see issue #731 for links)
- [x] Frontend fix deployed (PR #719)
- [x] File-based batch submission confirmed working (431 completed Lite jobs in DB)
- [x] Script submitted 5 test books via route (pending as of 2026-04-03)
- [ ] Batch jobs complete successfully
- [ ] Collector saves OCR correctly
- [ ] Post-collection splitting works
- [ ] Full end-to-end on 50 books
- [ ] Production run on remaining 1,114 books
