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
