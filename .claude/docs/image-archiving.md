# Image Archiving & Provenance

Images from external sources (IA, Gallica, MDZ) are archived to Vercel Blob. Original provenance is always preserved.

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
- `archived_photo` — Vercel Blob URL (used for display)
- `archive_metadata.source_url`, `archived_at`, `bytes`

## Image Extraction
Extract illustrations with AI metadata (bounding boxes, quality scores, museum descriptions).
```bash
node scripts/evaluate-extraction.mjs BOOK_ID
```
- Gallery: https://sourcelibrary.org/gallery?book=BOOK_ID
- Cost: ~$0.0003/page, ~$0.10-0.25 for a 300-800 page book

### OCR-Aware Extraction (Feb 2026)
When OCR has already been run on a page, the image extraction prompt receives OCR context:
- **Page type** from `<page-type>` tag (illustration, diagram, text, etc.)
- **Preliminary detections** from OCR's `<detected-images>` tag (rough bounding boxes to refine)
- **Text density** (line count summary) — helps model understand text vs image regions

This improves bounding box accuracy by giving the model layout awareness. Falls back gracefully when OCR hasn't been run yet.

Implementation: `buildOcrContext()` in `src/lib/image-extraction.ts`, called from the Lambda worker when `page.ocr.data` exists.
