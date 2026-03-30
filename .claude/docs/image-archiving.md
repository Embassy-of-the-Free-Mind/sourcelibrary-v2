# Image Archiving & Provenance

Images from external sources (IA, Gallica, MDZ, etc.) are archived to Cloudflare R2 (`images.sourcelibrary.org`). Original provenance is always preserved. All new archiving goes to R2 (3 variants: full-res, display, thumbnail).

## Archive Endpoint
```
POST /api/books/[id]/archive-images
{ "limit": 100 }
```

## Provenance Fields (Book Level)
`image_source` object: provider, provider_name, source_url, iiif_manifest, identifier, license, attribution, access_date.
Dublin Core: `dublin_core.dc_source`, `dublin_core.dc_identifier`.

## Provenance Fields (Page Level)
- `photo_original` — original IIIF URL (never overwritten)
- `archived_photo` — Cloudflare R2 URL (e.g. `https://images.sourcelibrary.org/archived/{bookId}/{page}.jpg`)
- `archive_metadata.source_url`, `archived_at`, `bytes`

## Archiving Infrastructure

Three dedicated workers download page images and upload to R2:

- **`scripts/workers/archive-ocr.mjs`** (Hetzner, every 30 min) — Per-page IIIF archiving for most sources (MDZ, Gallica, Bodleian, Vatican, Wellcome, Cambridge, HAB, CDLI, Manchester, Chester Beatty, etc.). Per-domain rate limiting. Up to 10,000 pages/run.
- **`scripts/workers/archive-bulk.mjs`** (Hetzner, every 10 min) — Bulk JP2-zip archiving for Internet Archive books. ~4x faster than per-page IIIF. 20 books/run.
- **`scripts/workers/archive-erara.mjs`** (Mac local, every 30 min via launchd) — PDF-based archiving for e-rara.ch books. Runs locally because e-rara blocks Hetzner IPs.

Other:
- **`POST /api/books/[id]/archive-images`** — Manual per-book archiving API endpoint
- **Pipeline orchestrator Phase 1** checks archiving progress and advances to `archive_complete`
- **`ARCHIVABLE_SOURCES` regex** in `pipeline-orchestrator.mjs` (line ~643) determines which source domains require archiving. Books from unlisted domains skip archiving entirely. Keep this in sync with `next.config.ts` `remotePatterns`.
- **24h timeout** — if archiving takes >24h, the book advances anyway since OCR works on original IIIF URLs
- **R2 costs:** Storage $0.015/GB/month, writes $4.50/million ops, egress free

## Image Extraction
Extract illustrations with AI metadata (bounding boxes, quality scores, museum descriptions).
```bash
# Via Lambda workers (production)
curl -X POST https://sourcelibrary.org/api/jobs/queue-books \
  -H "Content-Type: application/json" \
  -d '{"bookIds":["BOOK_ID"], "action":"image_extraction"}'
```
- Gallery: https://sourcelibrary.org/gallery?book=BOOK_ID
- Cost: ~$0.0009/page for pages with visual content

### OCR-Aware Extraction (Feb 2026)
When OCR has already been run on a page, the image extraction prompt receives OCR context:
- **Page type** from `<page-type>` tag (illustration, diagram, text, etc.)
- **Preliminary detections** from OCR's `<detected-images>` tag (rough bounding boxes to refine)
- **Text density** (line count summary) — helps model understand text vs image regions

This improves bounding box accuracy by giving the model layout awareness. Falls back gracefully when OCR hasn't been run yet.

Implementation: `buildOcrContext()` in `src/lib/image-extraction.ts`, called from the Lambda worker when `page.ocr.data` exists.
