# BPH S3→R2 Migration — Handoff 2026-03-28 (updated)

## Summary

Migrating 1,057 new BPH books (~170K pages) from Momo's Ritman S3 bucket to Cloudflare R2 + MongoDB. Images are JPEG 2000 (JP2), converted to JPEG via `opj_decompress` + sharp on Hetzner.

## Current Status

**219 / 1,057 books completed** (21%). Zero failures since upload fix. Running on Hetzner with auto-restart wrapper.

**Architecture:** Producer/consumer with bounded buffer.
- Producer downloads JP2s to /dev/shm (RAM-backed tmpfs) at 30 pages/book concurrency
- 3 consumer workers process books simultaneously (6 convert+upload workers each = 18 total)
- Buffer of 8 books — downloads never blocked by processing
- `sharp.concurrency(1)` prevents libvips thread contention
- Async `exec` (not `execSync`) for opj_decompress — critical for true parallelism

**Throughput:** ~3 pages/s, CPU at 96%. ETA: ~12 hours from 2026-03-28 15:30 UTC.

**Prioritized manifest:** Gems (pre-1560, Hermes, Ficino, Bruno, Lull, etc.) imported first via `/tmp/bph-manifest-prioritized.json`.

## What's Running

**Auto-restart wrapper:** `scripts/migration/run-bph-migration.sh` running via nohup on Hetzner.
- Uses `/tmp/bph-manifest-prioritized.json` (gems first, then rest)
- Restarts on crash (up to 50 times, 30s cooldown)
- Resume via `/tmp/bph-migration-progress.json`

**Monitor:**
```bash
ssh root@46.224.122.120 'tail -20 /tmp/bph-migration.log'
ssh root@46.224.122.120 'python3 -c "import json; d=json.load(open(\"/tmp/bph-migration-progress.json\")); print(len(d[\"completed\"]))"'
```

**If it dies and wrapper isn't running:**
```bash
ssh root@46.224.122.120 'nohup bash /root/sourcelibrary/scripts/migration/run-bph-migration.sh > /dev/null 2>&1 &'
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

**Run enrichment (adds UBN + catalog fields):**
```bash
node scripts/migration/enrich-bph-from-csv.mjs --csv /tmp/bph-scanned-books.csv
```

## Known Issues

- **885 pages failed** in early runs (before upload retry fix). Books marked "completed" but have missing pages. Need a backfill script to find books where `pages_count < expected` and re-upload gaps.
- **Presigned URLs expire April 3, 2026.** Must complete before then.
- JP2 conversion is CPU-bound (~1s/page via opj_decompress). This is the theoretical floor.
- Some pages get `ECONNRESET` from S3 — retries (5x with exponential backoff) handle this.

## Performance Evolution

| Version | Architecture | Pages/s | CPU | Bottleneck |
|---------|-------------|---------|-----|------------|
| v1 (original) | Interleaved DL+convert+upload, 3 books | 0.2 | 14% | Network/CPU interleaved |
| v2 (phase-separated) | DL→convert→upload per book, 2 books | 0.8 | 30% | Sequential phases |
| v3 (streamed) | DL then convert+upload merged, 2 books | 1.0 | 56% | execSync blocking event loop |
| v4 (producer/consumer) | Decoupled DL, 3 consumers, async exec | 3.0 | 96% | opj_decompress throughput (theoretical floor) |

Key optimizations:
1. Pre-fetch existing source_ids (1 query vs 1000+ findOne)
2. RAM-backed tmpfs for temp files (/dev/shm)
3. `sharp.concurrency(1)` to prevent thread contention
4. Async `exec` instead of `execSync` (6x speedup — the big one)
5. Producer/consumer with bounded buffer
6. 3 concurrent consumer workers

## Data Provenance

| Layer | Source | Provider | Fields |
|-------|--------|----------|--------|
| Import | `bph-s3-manifest` | `picturae-dam` | title, author, published, publisher, place_published |
| Enrichment | `bph-scanned-books-csv` | `vitec-memorix` | dublin_core.dc_identifier (UBN), shelf_mark, provenance, binding |

## Key Files

| File | Purpose |
|------|---------|
| `scripts/migration/bph-s3-to-r2-fast.mjs` | Main migration: producer/consumer, S3 JP2 → R2 JPEG + MongoDB |
| `scripts/migration/bph-s3-to-r2.mjs` | Original version (superseded) |
| `scripts/migration/run-bph-migration.sh` | Auto-restart wrapper on Hetzner |
| `scripts/migration/enrich-bph-from-csv.mjs` | Add UBN + catalog metadata from CSV |
| `scripts/workers/batch-split-bph.mjs` | Batch split detection + cropping |
| `scripts/data/bph-scanned-books.csv` | RIT→UBN mapping (3,074 rows) |

## Issues

- [#432](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/432) — BPH migration tracking issue
- [#264](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/264) — Split detection in pipeline

## Momo's Data Files

Received from Momo (Mayank):
- `manifest.json` — 1,057 books with presigned S3 page URLs (JP2), expires April 3
- `ScannedBooks.csv` — RIT→UBN mapping + catalog metadata
- `PageScans.csv.zip` (AllScansExport.csv) — per-page scan data with dimensions, batches
- `migration_state.db.zip` — SQLite DB from Momo's migration tool
