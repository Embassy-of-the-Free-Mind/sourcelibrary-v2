# BPH Spread Page Splitting — System Design Document

## Purpose

Source Library acquires historical texts from institutional archives and makes them accessible: OCR'd, translated, searchable. The Embassy of the Free Mind (BPH) collection has **1,122 books** where the physical books were scanned as two-page spreads — a single photograph showing both left and right pages of an open book. These need to be split into individual pages for:

- **Display**: users expect to see one page at a time
- **OCR**: cleaner transcription when the model sees one page
- **Navigation**: page numbers should correspond to real book pages
- **Translation**: the translation pipeline expects single-page text
- **Image extraction**: illustrations need per-page references

## Batch Submission — Critical Details

The Hetzner `pipeline-orchestrator.mjs` has the **only proven working batch submission path**. Key details discovered the hard way:

### Inline vs File-Based Submission

| Method | Limit | Works with Lite? | Where |
|---|---|---|---|
| Inline (`ai.batches.create({ src: [...] })`) | ~20MB (~8-10 images) | **NO** — jobs stuck PENDING forever | SDK, Vercel route |
| File-based (upload JSONL → REST API) | 150+ pages per job | **YES** — 431 completed + 1,564 saved | Hetzner orchestrator |

**ALWAYS use file-based submission for `gemini-3.1-flash-lite-preview`.** The inline method via the `@google/genai` SDK does not work with this model.

### JSONL Format (file-based)

```json
{"request":{"contents":[{"parts":[{"text":"prompt"},{"inlineData":{"mimeType":"image/jpeg","data":"base64..."}}]}],"safetySettings":[{"category":"HARM_CATEGORY_HARASSMENT","threshold":"BLOCK_NONE"},{"category":"HARM_CATEGORY_HATE_SPEECH","threshold":"BLOCK_NONE"},{"category":"HARM_CATEGORY_SEXUALLY_EXPLICIT","threshold":"BLOCK_NONE"},{"category":"HARM_CATEGORY_DANGEROUS_CONTENT","threshold":"BLOCK_NONE"},{"category":"HARM_CATEGORY_CIVIC_INTEGRITY","threshold":"BLOCK_NONE"}],"generationConfig":{"temperature":0.1,"maxOutputTokens":16384,"thinkingConfig":{"thinkingBudget":0}}},"metadata":{"key":"pageId"}}
```

Key differences from SDK inline format:
- Wrapped in `request: { ... }` — not bare `contents`
- `safetySettings: BLOCK_NONE` on ALL 5 categories (prevents ~2-5% safety blocks on historical texts)
- `generationConfig` not `config`
- `metadata.key` for result matching (results come back in random order)

### File Upload Rules

1. **Upload via resumable protocol** to `https://generativelanguage.googleapis.com/upload/v1beta/files`
2. **Use `text/plain` content type** — `application/jsonl` has a backend bug
3. **Same API key for upload AND batch creation** — files are key-scoped. Using a different key → 404.
4. **Delete file immediately after batch creation** — Gemini copies into the job. Prevents hitting 20GB storage quota.
5. **Key rotation on 429** — try all keys for upload, then use the successful key for batch creation.

### Batch Creation (REST, not SDK)

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:batchGenerateContent?key={apiKey}
{
  "batch": {
    "display_name": "...",
    "input_config": { "file_name": "files/xxx" }
  }
}
```

The `@google/genai` SDK's `ai.batches.create()` uses a different format that doesn't work reliably with Lite. Use the REST API directly.

### Source of Truth

`scripts/workers/pipeline-orchestrator.mjs` lines 1095-1181 — `uploadBatchFile()` and `createBatchJobFromFile()`. This is the code that produced all 431+1564 successful Lite batch jobs.

### Past Issues (from handoffs)

| Date | Issue | Root cause | Fix |
|---|---|---|---|
| 2026-02-24 | All 3 keys quota-exhausted | 1,581 duplicate submissions from OCR resubmission loop | 5 guards added (check pending jobs before resubmitting) |
| 2026-03-17 | File-based batch 404 | Upload key ≠ batch creation key (files are key-scoped) | Pass upload key index to batch creation |
| 2026-03-17 | 700+ small batch jobs | Inline submission created one job per 20 pages | Changed to file-based, one job per book |
| 2026-04-01 | 288 jobs stuck PENDING | Used inline SDK for Lite model | File-based submission works; inline doesn't for Lite |
| 2026-04-03 | 12 more jobs stuck PENDING | Route uses inline for <20 page books | Need to force file-based regardless of size |

## The Pipeline

### Input
A book with `needs_splitting: true` and N spread pages in the `pages` collection.

### Phase 1: Fetch Images
Download each spread page image. Retry 3x with backoff. Flag failures rather than silently skipping.

### Phase 2: OCR + Split Detection
One Gemini call per spread page using `gemini-3.1-flash-lite-preview`. The spread-aware prompt (prepended to OCR v10) returns:
- `<split-position>N</split-position>` — where to crop (0-1000 scale)
- Left page OCR with full metadata tags
- `<page-break/>` separator
- Right page OCR with full metadata tags

If Gemini determines it's a single page: `split_position: null`, no `<page-break/>`.

### Phase 3: Crop Images + Upload
For two-page spreads:
- Crop left half: 0 to (splitPosition + 1% overlap)
- Crop right half: (splitPosition - 1% overlap) to end
- Upload display (1200px), full-res, and thumbnail for each half

For single pages (portrait covers, blanks):
- Re-upload at the `sp`-prefixed path for CDN cache busting

All uploads use `sp` prefix: `pages/{bookId}/sp{NNNN}.jpg`

### Phase 4: Write Page Records

**For left pages** (update existing record — preserves page ID/URL):
```
$set: {
  page_number: sequential,
  photo: sp-prefixed display URL,
  thumbnail: sp-prefixed thumb URL,
  page_type: extracted from <page-type> tag,
  ocr: { data, model, prompt_version },
  columns: extracted from <columns> tag (if > 1),
  split_from_spread: true,
  split_side: 'left',
}
$unset: {
  photo_original, archived_photo, cropped_photo, thumbnail_blob
}
```

**For right pages** (insert new record):
```
{
  id: new ObjectId,
  page_number: sequential,
  photo: sp-prefixed display URL,
  thumbnail: sp-prefixed thumb URL,
  page_type, ocr, columns, etc. (same fields as left)
  split_from_spread: true,
  split_side: 'right',
  split_source_page: original page ID (for tracing)
}
```

### Phase 5: Update Book
- `pages_count`: new total
- `pages_ocr`: count of pages with OCR
- `needs_splitting: false`
- `split_completed: true`
- `thumbnail`: first title-page or frontispiece from page_type tags
- `cover_page`: that page's number

## Where the Complexity Comes From

### 1. The Frontend Image Priority Chain

This is the root cause of most display bugs. The page record has 6 image-related fields accumulated over time:

| Field | Origin | Purpose |
|---|---|---|
| `photo` | Standard pipeline | Primary display image |
| `photo_original` | Import | Original source URL before any processing |
| `archived_photo` | Archiving | Locally cached copy of source image |
| `cropped_photo` | Old split detection | Cropped version from split pipeline |
| `thumbnail` | Standard pipeline | 150px grid thumbnail |
| `thumbnail_blob` | Vercel Blob era | Legacy CDN thumbnail |

The frontend checks them in priority order:

**`getPageThumbUrl()` in `src/lib/utils.ts`:**
1. `crop` coordinates → proxy URL with crop params
2. `thumbnail_blob` → direct URL
3. Derive from `photo` path (regex for `/NNNN.jpg` pattern)
4. `thumbnail` → direct URL
5. `archived_photo || photo_original || photo` → proxy URL

**`BookPagesSection.tsx` cover picker (line 494):**
```
cropped_photo || archived_photo || photo_original || photo
```

**The problem**: If ANY of the legacy fields exist and point to a spread image, the frontend shows the spread instead of the cropped single page. Setting `photo` is necessary but not sufficient — you must also `$unset` all fields that override it.

**Mitigation**: The split pipeline MUST `$unset: { photo_original, archived_photo, cropped_photo, thumbnail_blob }` on every page it touches. This is a hard requirement, not optional cleanup.

### 2. CDN Cache Invalidation

R2 images are served via Cloudflare with `Cache-Control: max-age=31536000` (1 year). Uploading a new image at the same key does NOT invalidate the cache. Old visitors see the old image.

**Mitigation**: Use unique path prefixes (`sp`) for split pages. The `sp` prefix means split page images never collide with pre-existing cached spread images. New paths = no cache to invalidate.

### 3. Re-processing / Idempotency

Running the split pipeline twice on the same book without guards creates duplicate right pages and inconsistent state. The old scripts had no guards and left artifacts.

**Mitigation**:
- Check `split_completed` flag before processing
- `--force` flag for intentional re-runs
- v3 script updates originals in place (no delete+recreate)
- Right pages have `split_source_page` for traceability

### 4. OCR Tags as Both Data and Metadata

The OCR output contains inline XML tags (`<language>`, `<page-type>`, `<vocab>`, etc.) that serve dual purposes:
- **Metadata**: parsed and stored as structured fields on the page record
- **Display**: stripped by `NotesRenderer.tsx` before rendering, shown in a sidebar

When splitting spreads, each half needs its own complete set of tags. The prompt must specify this.

**Mitigation**: The spread prefix explicitly says "each page gets its own metadata tags." The split logic preserves whatever tags Gemini outputs per page. The `NotesRenderer` handles stripping regardless of source.

### 5. Mixed Source Quality

BPH images come from multiple sources:
- R2 (`images.sourcelibrary.org/pages/...`) — our processed images
- UvA IIIF (`images.uba.uva.nl/iiif/...`) — Allard Pierson's server, unreliable
- Archived (`images.sourcelibrary.org/archived/...`) — our archived copies of source images

UvA IIIF images frequently timeout (5-15% failure rate). The pipeline needs robust retry logic.

**Mitigation**: 3 retries with exponential backoff per image. Failed fetches are flagged, not silently dropped. Books with >20% fetch failures should be deferred, not partially processed.

## Cost

| Model | Rate (batch) | 184K pages est. |
|---|---|---|
| gemini-3.1-flash-lite | in: $0.125/1M, out: $0.75/1M | ~$90 |
| gemini-3-flash-preview | in: $0.25/1M, out: $1.50/1M | ~$181 |

The combined spread+OCR approach costs the same as separate passes because image tokens dominate and are paid either way.

## Production Checklist

Before processing the full 1,122 books:

- [ ] Verify Gemini Batch API supports `gemini-3.1-flash-lite-preview` (288 jobs currently stuck pending)
- [ ] If not, use `gemini-2.5-flash-lite` or realtime with concurrency control
- [ ] Add `<vocab>` per-page requirement to spread prompt
- [ ] Add ISO 639-1 language code enforcement to prompt
- [ ] Generate slugs for BPH books that lack them
- [ ] Build result collection pipeline for batch jobs (parse `<page-break/>`, create pages, crop images)
- [ ] Test on 50+ books across all difficulty levels before full run
- [ ] Monitor for safety blocks (~2-5% of pages) — need retry/fallback strategy

## Key Files

| File | Purpose |
|---|---|
| `scripts/tmp-split-one-book-v3.mjs` | Production-ready single-book split script |
| `src/lib/page-split/splitDetection.ts` | Heuristic pixel-based gutter detection |
| `src/lib/page-split/split-processing.ts` | Image cropping utilities (`cropAndUploadHalf`) |
| `src/lib/utils.ts` → `getPageThumbUrl()` | Frontend image URL resolution (the priority chain) |
| `src/components/reader/NotesRenderer.tsx` | Strips metadata tags from OCR for display |
| `src/lib/types/prompts/defaults.ts` | `extractPageType()`, `extractColumns()`, `parseDetectedImages()` |
| `scripts/workers/batch-collector.mjs` | Existing batch result collector (reference for metadata extraction) |
| `.claude/handoffs/2026-04-02-bph-spread-splitting.md` | Session handoff with full context |
| GitHub #698, #699 | Pipeline architecture and Mayank's issue |
