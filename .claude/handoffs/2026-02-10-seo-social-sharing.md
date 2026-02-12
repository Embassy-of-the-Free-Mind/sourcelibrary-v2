# SEO & Social Sharing Fixes — 2026-02-10

## What Was Done

### Gallery Image URL Migration (`:` to `-`)
Social media crawlers (Twitter, LinkedIn) can't follow URLs with colons. Migrated gallery image URLs from `pageId:index` to `pageId-index` format across ~10 files. Parsers accept both formats for backward compat.

### Per-Route Canonical URLs
Root layout's `canonical: '/'` was bleeding into child routes, causing LinkedIn to fetch homepage OG instead of page-specific metadata. Added explicit canonicals to: root, gallery, gallery/image/[id], support, about/processing, about/research.

### OG Image Improvements
- Gallery image OG cards: bbox-cropped, image-only (no text overlay), 2000px IIIF source for sharpness
- Shortened OG titles to first sentence + book attribution
- Added publication year to book and page OG titles

### Book Page Payload Reduction
Musaeum hermeticum book page was 5.35 MB (over LinkedIn's 3 MB scrape limit). Added MongoDB projection excluding `ocr.data`, `translation.data`, `summary.data`, `modernized.data` from the pages query. Result: **5.35 MB → 1.50 MB**.

## Key Files Modified
- `src/app/gallery/image/[id]/layout.tsx` — metadata, canonical, ID parsing
- `src/app/gallery/image/[id]/opengraph-image.tsx` — image-only card, bbox crop, 2000px IIIF
- `src/app/gallery/image/[id]/page.tsx` — normalize `-` back to `:` for likes
- `src/app/api/gallery/image/[id]/route.ts` — accept both separators
- `src/app/book/[id]/page.tsx` — lightweight projection, year in OG title
- `src/app/book/[id]/page/[pageId]/layout.tsx` — year in OG title
- `src/app/layout.tsx` — root canonical re-added
- Gallery page.tsx, SectionsNav.tsx, guide/page.tsx — `:` to `-` in hrefs
- tweet-generator.ts, mcp-server/src/index.ts, social/candidates/route.ts — URL generation

## Minor Outstanding Items
- LinkedIn warns "description should be at least 100 characters" on some gallery images with short descriptions
- Book page OG image shows middle of thumbnail (cropped to 1200x630) — user said "that's ok, maybe"
- `/book/[id]/guide` (client component) inherits root canonical `/` — low priority since it's client-rendered
