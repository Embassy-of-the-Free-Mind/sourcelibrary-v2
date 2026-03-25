# Visual Art Wing — Handoff 2026-03-23

## Status
- **2,678 artworks** imported from Wikimedia Commons into `books` collection
- All have `resource_type` field (painting/print/drawing/object)
- All hidden (`hidden: true`, `hidden_reason: 'artwork_experimental'`) — except 908 preview set (Botticelli, Leonardo, Goltzius, Fra Angelico, Drebbel, Saenredam, Michelangelo)
- 13 art collections created, 6 visible (7 empty/hidden awaiting esoteric imports)
- Import still running — hasn't reached: Raphael drawings, Venetians (Titian/Bellini/Giorgione/Veronese), Caravaggio, Bosch, Rudolf II court (Arcimboldo/Spranger/Sadeler), Blake, Stradanus, Teniers, Dee, Paracelsus, astronomical objects, tarot, Atalanta Fugiens, Splendor Solis, Khunrath, Fludd, Kircher, Dürer, Holbein

## Key Files
- **Import script:** `scripts/import-commons-artworks.mjs` — walks Commons categories, downloads images to R2 (3840px display + 600px thumb), stores full metadata
- **Backfill script:** `scripts/backfill-artwork-metadata.mjs` — re-fetches extmetadata for records imported before metadata improvements
- **Collections script:** `scripts/create-art-collections.mjs` — creates/updates 13 art collections, assigns artworks
- **Type definition:** `src/lib/types/book.ts` — `resource_type` field added
- **Artwork UI:** `src/components/artwork/ArtworkInfo.tsx` — dedicated layout for visual art (hero image, magnifier, provenance)
- **Artwork hero:** `src/components/artwork/ArtworkHero.tsx` — ImageWithMagnifier wrapper
- **Routes:**
  - `/artwork` — DB-backed landing page (collections + artists)
  - `/artwork/[slug]` — individual artwork detail
  - `/artwork/artist/[slug]` — artist page with works grid (dash-separated names)
  - `/book/art-*` — also works (book page branches on resource_type)

## Data Model
Artworks live in `books` collection with `resource_type` set. Key fields:
- `resource_type`: painting | print | drawing | object | fresco | emblem
- `medium`, `dimensions_display`
- `commons_*`: title, url, full_url, width, height, license, credit, categories, sha1, upload_date, uploader, artist_html, assessment
- `image_source`: provider, attribution, license, access_date, contributing_library, identifier
- `harvested_at`: when we imported
- `thumbnail`: 600px grid thumb on R2
- `thumbnail_blob`: 3840px display image on R2

## What's NOT Done Yet
1. **Wikidata extraction** — Commons structured data (SDC) has P180/P6243 linking to artwork Q-items. Not collected yet. Would unlock all Wikidata metadata (artist dates, current location, genre, depicts, movement)
2. **Gemini Vision enrichment** — art-historical descriptions, iconographic elements, cross-references to Source Library books. ~$0.003/artwork.
3. **Artist entity model** — artists are just strings, no `artists` collection yet
4. **Rijksmuseum OAI-PMH** — 93K pre-1700 prints, all CC0. Different import path.
5. **commons_categories often empty** — API `cllimit` may need `max` not `50`
6. **Ugly slugs** — many are Dutch catalog numbers, not human-readable
7. **Cross-references** — related_books linking artworks ↔ texts (the killer feature)

## GitHub Issue
#293 — full plan with research, data model, phased implementation

## R2 Storage
All artwork images under `artwork/` prefix on R2:
- `artwork/{slug}.jpg` — 3840px display
- `artwork/{slug}-thumb.jpg` — 600px grid thumbnail
