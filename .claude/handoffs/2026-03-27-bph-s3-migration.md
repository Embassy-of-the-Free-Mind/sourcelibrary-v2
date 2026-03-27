# BPH S3→R2 Migration — Handoff 2026-03-27

## Summary

Migrating 1,057 new BPH books (169,726 pages) from Momo's Ritman S3 bucket to Cloudflare R2 + MongoDB. Images are JPEG 2000 (JP2), converted to JPEG via `opj_decompress` + sharp on Hetzner.

## What's Running

**Migration script**: `scripts/migration/bph-s3-to-r2.mjs` running on Hetzner via nohup.
- Manifest: `/tmp/bph-manifest.json` (74MB, downloaded from presigned S3 URL)
- Presigned URLs expire **April 3, 2026** (7-day window from March 27)
- Rate: ~0.2-0.3 pages/s with 3 books × 20 pages concurrency
- ETA: ~2-3 days
- Resume support: `/tmp/bph-migration-progress.json`

**Monitor:**
```bash
ssh root@46.224.122.120 'tail -20 /tmp/bph-migration.log'
ssh root@46.224.122.120 'pgrep -c -f bph-s3-to-r2'
```

**If it dies, restart:**
```bash
ssh root@46.224.122.120 'cd /root/sourcelibrary && set -a && source .env.production.local && set +a && nohup node scripts/migration/bph-s3-to-r2.mjs --manifest /tmp/bph-manifest.json --concurrency 20 --book-concurrency 3 --resume > /tmp/bph-migration.log 2>&1 &'
```

## Pipeline After Import

Each book is created with:
- `pipeline_auto.status: 'archive_complete'` (images already on R2)
- `needs_splitting: true` (BPH scans are two-page spreads)
- `hidden: true`

**Pipeline flow:**
1. ~~Archive~~ — done (images on R2 with full/display/thumb variants)
2. **Split detection** — `scripts/workers/batch-split-bph.mjs` (run after import)
3. **OCR** — pipeline cron gates on `needs_splitting` before submitting
4. **Translation** → enrichment → chapters → images → complete

**Run split detection after migration:**
```bash
set -a; source .env.production.local; set +a
node scripts/workers/batch-split-bph.mjs --limit 50
```

## Data Provenance

Two provenance layers on every book:

| Layer | Source | Provider | Fields |
|-------|--------|----------|--------|
| Import | `bph-s3-manifest` | `picturae-dam` | title, author, published, publisher, place_published |
| Enrichment | `bph-scanned-books-csv` | `vitec-memorix` | dublin_core.dc_identifier (UBN), shelf_mark, provenance, binding |

**RIT→UBN mapping**: `ScannedBooks.csv` from Vitec Memorix, 100% coverage of manifest.
- CSV stored at: `/tmp/bph-scanned-books.csv` (Hetzner) and `scripts/data/bph-scanned-books.csv` (repo, not committed)
- RIT = Picturae DAM barcode (e.g., `RIT001001449`)
- UBN = BPH catalog number (e.g., `15312`)
- `dublin_core.dc_source` = `"BPH Catalogue (UBN: 15312)"`

**Run enrichment after migration (adds UBN + catalog fields):**
```bash
node scripts/migration/enrich-bph-from-csv.mjs --csv /tmp/bph-scanned-books.csv
```

## Overlap with Existing Collection

- **Existing BPH/EFM books**: 1,260 (provider=`bph`, no RIT source_id)
- **New from manifest**: 1,057 (provider=`bph`, source_id=`RIT*`)
- **Zero overlap by source_id** — manifest books are all new
- **~83 title matches** with existing books → skipped by migration script
- **~974 genuinely new books** imported

## Key Files

| File | Purpose |
|------|---------|
| `scripts/migration/bph-s3-to-r2.mjs` | Main migration: S3 JP2 → R2 JPEG + MongoDB |
| `scripts/migration/enrich-bph-from-csv.mjs` | Add UBN + catalog metadata from CSV |
| `scripts/workers/batch-split-bph.mjs` | Batch split detection + cropping |
| `scripts/data/bph-scanned-books.csv` | RIT→UBN mapping (3,074 rows) |

## Issues

- [#432](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/432) — BPH migration tracking issue
- [#264](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/264) — Split detection in pipeline (batch-split-bph.mjs addresses this)

## Momo's Data Files

Received from Momo (Mayank):
- `manifest.json` — 1,057 books with presigned S3 page URLs (JP2)
- `ScannedBooks.csv` — RIT→UBN mapping + catalog metadata
- `PageScans.csv.zip` (AllScansExport.csv) — per-page scan data with dimensions, batches
- `migration_state.db.zip` — SQLite DB from Momo's migration tool

## Known Issues

- JP2 conversion is CPU-bound (~1.5s/page via opj_decompress). Sharp lacks JP2 input support.
- Some pages get `ECONNRESET` from S3 — the script retries 2x with backoff.
- `nohup` on Hetzner sometimes spawns duplicate processes. Always check `pgrep -c -f bph-s3-to-r2` and kill extras.
- Language is `null` for 914/1057 books in the manifest. CSV has language for some. Pipeline metadata enrichment will detect language from OCR text.
