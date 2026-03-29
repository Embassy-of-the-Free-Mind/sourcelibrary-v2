# Kloss + IDP Dunhuang Imports — 2026-03-24 to 2026-03-26

## What happened

### Kloss Collection (CMC Prins Frederik, Bibliotheca Klossiana)
- **1,521 books imported** from `kloss_catalog` MongoDB collection via PDF download + pdftoppm extraction
- **101,838 pages** on R2 at `images.sourcelibrary.org/books/{id}/pages/`
- Provider: `image_source.provider: 'cmc_kloss'`
- Script: `scripts/import/import-kloss-collection.mjs`

### Kloss Pre-OCR Enrichment
- Language detection from titles: 1,029 books tagged (German, French, Latin, Dutch, English)
- Author normalization: 63 names cleaned (6 Kloss variants → 1, brackets stripped)
- Shelf mark classification: 1,468 books mapped to Kloss's Roman numeral subject system
- Multi-volume grouping: 343 items in 71 groups
- Stored under `kloss_enrichment` field on each book
- Script: `scripts/import/kloss-enrich.mjs` (re-runnable)
- All books set to `pipeline_status: 'archive_complete'` + dedup fields backfilled

### Kloss Collections Created
- Parent: `kloss-collection` (Bibliotheca Klossiana, 1,520 books)
- 12 subcollections using `parent: 'kloss-collection'` field:
  - kloss-inventories (228), kloss-strict-observance (126), kloss-masonic-history (112),
    kloss-french-higher-degrees (109), kloss-rose-croix-degrees (81), kloss-grand-orient (63),
    kloss-templar-degrees (60), kloss-rosicrucianism (49), kloss-alchemy-occult (41),
    kloss-constitutions (35), kloss-asiatic-brethren (20), kloss-illuminati (16)
- GitHub issue #345 for post-OCR enrichment (GND/VIAF author linking, USTC cross-ref, etc.)

### IDP Dunhuang (International Dunhuang Project)
- **2,909 items harvested** into `import_candidates` (source: `idp_dunhuang`)
  - 2,213 Manichaean manuscripts
  - 696 Buddhist paintings (some overlap)
  - Scraper: `scripts/import/harvest-idp-dunhuang.mjs`
- **~2,047 books imported** (import crashed at record 2,025 due to MongoDB ECONNRESET)
  - **Resumed** with `--skip-existing --delay 3000` for remaining 849
  - Provider: `image_source.provider: 'idp_dunhuang'`
  - Script: `scripts/import/import-idp-batch.mjs`
  - Images downloaded from IIIF Image API → R2

### HAB Wolfenbüttel
- **5,456 records** already in `import_candidates` from prior harvest (source: `hab`)
- Has `alchq` OAI set (alchemy) — not yet filtered or imported as books
- HAB records have no IIIF manifests in OAI — need manifest URL resolution before import
- Import route exists: `/api/import/hab`

## Known Issues
- IDP metadata scraper misses some fields (material, script, dimensions) — regex patterns don't match all IDP HTML field-label variants. Viewer URLs stored for backfill. Correct field names: `field-label-measurements.dimensions`, `field-label-provenance.text.value`. Some `<p>` content is plain text, not wrapped in facet links.
- ~14 IDP slug collisions (pressmarks like `1919,0101,0.35` and `1919,0101,0.35*` slugify identically). Need to add random suffix to slug generation.
- IDP import resume is running as background task b6krndw4q
- Kloss books all `status: 'draft'` — not visible on site until promoted
- 1,649 old Kloss pages still on Vercel Blob (original 19 books, pre-R2 migration)

## Files Modified
- `scripts/import/kloss-enrich.mjs` (created)
- `scripts/import/harvest-idp-dunhuang.mjs` (created)
- `scripts/import/import-idp-batch.mjs` (created)
- All three already committed to main via prior merge

## What's Next
1. Check IDP resume import completed (task b6krndw4q)
2. Create IDP collections (Manichaean manuscripts, Buddhist paintings from Dunhuang)
3. Backfill missing IDP metadata with corrected scraper
4. Fix slug collision bug in import-idp-batch.mjs
5. Run Kloss enrichment final pass (if any new books from retry)
6. HAB Wolfenbüttel: resolve IIIF manifest URLs for alchemy set, then import
7. Consider moving heavy imports to Hetzner server (closer to European sources)
