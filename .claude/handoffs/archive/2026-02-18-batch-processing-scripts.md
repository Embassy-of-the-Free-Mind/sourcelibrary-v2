# Handoff: Batch Processing Scripts (2026-02-18)

## What Was Done

### 1. Soft-deleted 60 post-1930 books with 403'd IA images
- Script: `scripts/remove-403-post1930.mjs` (already ran with `--apply`)
- 60 books removed (21,578 pages), moved to `deleted_books` collection (recoverable)
- 7 unique texts preserved (Blue Cliff Record, Macrobius Saturnalia, Hooke's Diary, Atmabodha, Haran Gawaita, Gateless Gate, Engi-shiki) — their IDs are hardcoded in `keepIds`
- Analysis script: `scripts/analyze-403-gaps.mjs`

### 2. Killed slow Hetzner enrichment (image-based)
- Was at ~530/2430 books after hours — bottleneck was downloading 25 page images per book as base64
- Process on Hetzner was PID 174147, killed

### 3. Created 3 new batch processing scripts

All scripts support: `--dry-run` (default), `--apply`, `--limit N`, `--book "term"`, `--force`

#### Script A: `scripts/enrich-metadata-text.mjs`
- **Replaces** the slow image-based `enrich-metadata-vision.mjs`
- Reads OCR text from MongoDB (first 10 pages, 2000 chars each) instead of downloading images
- Same classification output: language, categories, year, description, first_translation assessment
- Same save logic: ai_metadata, field_provenance, merged categories
- 10x concurrency (vs 5 for image version), ~$0.0002/book
- ~1,800 unenriched books to process
- **Tested:** dry-run works, classified 3 books correctly

#### Script B: `scripts/batch-generate-indexes.mjs`
- Replicates the MapReduce logic from `/api/books/[id]/index` route
- Batches translated pages into ~50k char chunks, extracts themes/quotes/people/places/concepts in parallel
- Synthesizes hierarchical summary (brief/abstract/detailed + sections)
- Builds concept index, syncs entities to cross-book `entities` collection
- Logs to `gemini_usage`
- ~4,700 books missing indexes, requires `pages_translated >= 5`
- **Tested:** dry-run works, found books sorted by pages_translated desc

#### Script C: `scripts/batch-extract-chapters.mjs`
- Replicates `src/lib/chapter-extraction.ts` logic
- Extracts markdown headings from OCR, identifies TOC pages, calls Gemini to filter noise
- Validates chapters against page IDs (±2 page offset tolerance)
- Saves `book.chapters[]` and `book.chapters_extracted_at`
- 0/5,017 books currently have chapters
- **Tested:** dry-run works, found books sorted by pages_ocr desc

## Pipeline Stats (as of 2026-02-18)

| Metric | Count |
|--------|-------|
| Total books | ~5,017 |
| Enriched (ai_metadata) | 3,136 |
| Unenriched | ~1,821 (after 60 deleted) |
| With OCR | ~4,200 |
| With translations | ~3,500 |
| With index | 304 |
| With summary | 1 |
| With chapters | 0 |

## Recommended Run Order

1. **Enrichment first** (text-based) — fastest, fills in language/categories/year for metadata
2. **Chapters second** — one API call per book, lightweight
3. **Indexes last** — most expensive (multiple API calls per book), needs translated pages

## Deploy to Hetzner

All scripts read `.env.local` for `MONGODB_URI` and `GEMINI_API_KEY` (+ `_2` through `_10`). To run on Hetzner:

```bash
scp scripts/enrich-metadata-text.mjs root@hetzner:/root/sourcelibrary/scripts/
scp scripts/batch-extract-chapters.mjs root@hetzner:/root/sourcelibrary/scripts/
scp scripts/batch-generate-indexes.mjs root@hetzner:/root/sourcelibrary/scripts/
# Ensure .env.local and node_modules (@google/generative-ai, mongodb) exist on Hetzner
```

## Open Thread: USTC/ISTC Bibliographic Enrichment

User mentioned enriched databases (USTC, ISTC) in the `secondrenaissance` repo on Supabase as another enrichment source. Could provide authoritative year, printer, location data. Needs investigation:
- What fields are available in the Supabase tables?
- How to match Source Library books to USTC/ISTC records (title? identifier?)
- How to flag books with suspect/missing metadata (no year, AI-only provenance, etc.)

## Files Modified/Created This Session

- `scripts/enrich-metadata-text.mjs` — NEW
- `scripts/batch-generate-indexes.mjs` — NEW
- `scripts/batch-extract-chapters.mjs` — NEW
- `scripts/remove-403-post1930.mjs` — MODIFIED (added keepIds), RAN with --apply
- `scripts/analyze-403-gaps.mjs` — CREATED previous session
