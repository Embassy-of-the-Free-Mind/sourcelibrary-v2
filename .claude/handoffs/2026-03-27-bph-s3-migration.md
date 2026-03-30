# BPH S3→R2 Migration — Handoff 2026-03-29

## Summary

Migrating 1,057 new BPH books (~170K pages) from Momo's Ritman S3 bucket to Cloudflare R2 + MongoDB. Images are JPEG 2000 (JP2), converted to JPEG via `opj_decompress` + sharp on Hetzner.

## Current Status (2026-03-29)

**751 / 1,057 books completed (71%). ~90K pages imported. Zero failures. ~4h remaining — finishes today.**

Running autonomously on Hetzner with auto-restart wrapper. No intervention needed.

## Architecture (final)

Producer/consumer with bounded buffer:
- **Producer:** downloads JP2s to /dev/shm (RAM-backed tmpfs) at 30 pages/book concurrency
- **3 consumer workers** process books simultaneously (6 convert+upload workers each = 18 total)
- **Buffer of 8 books** — downloads never blocked by processing
- `sharp.concurrency(1)` prevents libvips thread contention
- **Async `exec`** (not `execSync`) for opj_decompress — critical for true parallelism
- Prioritized manifest: gems (pre-1560, Hermes, Ficino, Bruno, Lull, etc.) imported first

**Throughput:** ~167 pages/min (~2.8 pages/s), CPU at 100%.

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

## TODO After Migration Completes

1. **Backfill missing pages** — 885 pages failed in early runs (before upload retry fix, runs 1-3). Books marked "completed" in progress file but have fewer pages than manifest. Need a script to compare `pages_count` vs manifest page count, then re-download+upload the gaps. Presigned URLs expire April 3.

2. **Enrich from CSV** (adds UBN catalog numbers + metadata):
   ```bash
   ssh root@46.224.122.120
   cd /root/sourcelibrary && set -a; source .env.production.local; set +a
   node scripts/migration/enrich-bph-from-csv.mjs --csv /tmp/bph-scanned-books.csv
   ```

3. **Split detection** (BPH scans are two-page spreads):
   ```bash
   node scripts/workers/batch-split-bph.mjs --limit 50
   ```
   Run in batches. Pipeline cron gates on `needs_splitting` — OCR won't start until split detection completes.

4. **Pipeline picks up automatically:** OCR → translation → enrichment → chapters → images → complete

## Pipeline State

Each imported book has:
- `pipeline_auto.status: 'archive_complete'` (images already on R2)
- `needs_splitting: true` (BPH scans are two-page spreads)
- `hidden: true`
- `image_source.provider: 'bph'`, `source_id: 'RIT...'`

## Performance Evolution

| Version | Architecture | Pages/s | CPU | Bottleneck |
|---------|-------------|---------|-----|------------|
| v1 (original) | Interleaved DL+convert+upload, 3 books | 0.2 | 14% | Network/CPU interleaved |
| v2 (phase-separated) | DL→convert→upload per book, 2 books | 0.8 | 30% | Sequential phases |
| v3 (streamed) | DL then convert+upload merged, 2 books | 1.0 | 56% | execSync blocking event loop |
| v4 (producer/consumer) | Decoupled DL, 3 consumers, async exec | 2.8 | 100% | opj_decompress throughput (theoretical floor) |

Key optimizations (in order of impact):
1. **Async `exec` instead of `execSync`** — 6x speedup. execSync blocks the entire Node event loop.
2. **Producer/consumer with bounded buffer** — downloads never blocked by processing
3. **3 concurrent consumer workers** — saturates all 8 ARM cores
4. **Pre-fetch existing source_ids** — 1 query vs 1000+ individual findOne calls
5. **RAM-backed tmpfs** (/dev/shm) for 70MB TIF intermediates
6. **`sharp.concurrency(1)`** — prevents libvips thread pool contention

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

Received from Momo (Mayank), stored on Hetzner at `/tmp/`:
- `bph-manifest.json` (74MB) — 1,057 books with presigned S3 page URLs (JP2). **Expires April 3, 2026.**
- `bph-scanned-books.csv` — RIT→UBN mapping + catalog metadata (3,074 rows)
- `bph-manifest-prioritized.json` — reordered manifest with gems first (generated by us)
- Also: `PageScans.csv.zip`, `migration_state.db.zip` (Momo's tools)
