# 2026-03-26: Archiving Pipeline Optimization

## What happened
Imported 3 Cheng Yu Tung East Asian Library books from IA, then discovered the archiving pipeline had major bottlenecks. Fixed them.

## Cheng Yu Tung imports
- `q_113_xinke_v19_0001` — 歷代神仙通鑑 (Comprehensive Mirror of Immortals), 168 pages, 1700
- `q_137_luzutai_v01_0001` — 呂祖太極生生書 Vol. 1, 46 pages, 1845
- `q_137_luzutai_v02_0001` — 呂祖太極生生書 Vol. 2, 58 pages, 1845

## Archiving fixes

### Stuck books cleared (~4,700)
- Kloss (1,502): already on R2, promoted to archive_complete
- Wikimedia Commons (811): single-image artworks, no pages
- Rijksmuseum (482): same
- Met (10): same
- IDP Dunhuang (1,481 + 566): already on R2
- EFM (18): on Vercel Blob

### e-rara bulk PDF archiver (NEW)
- `scripts/workers/archive-erara.mjs` — downloads full PDF per book from e-rara, extracts with pdftoppm
- e-rara blocks Hetzner IPs (403), so runs **locally on Mac** via launchd
- `~/Library/LaunchAgents/org.sourcelibrary.archive-erara.plist` — every 30min, 100 books/batch
- Rate: ~400 books/hr with 1s delay between PDFs
- ETA: ~3-4 days for 13.8K remaining

### archive-ocr.mjs fixes (Hetzner)
- **Query fix:** Replaced $lookup aggregate (was timing out on Atlas) with two-step book-first query
- **Provider filter:** Skips e-rara + IA (handled by dedicated workers)
- **Gallica rate:** Dropped from 2/s to 0.5/s (was getting 429'd)
- **countDocuments:** Switched to estimatedDocumentCount (no more timeout)
- Now successfully archiving MDZ, Bodleian, IIIF, Gallica, NDL, LoC pages

### archive-bulk.mjs fixes (Hetzner)
- **Provider filter:** Added `ia` alongside `internet_archive` (CYT books have provider=`ia`)
- **Page mapping:** Falls back to `page_number` when URL lacks `/page/n{leaf}` pattern (BookReader imports)

### Pipeline status resets
- 630 failed post-translation books → metadata_enriched (retry)
- 403 MDZ needs_attention → archive_complete
- 22 other needs_attention → archive_complete

### MongoDB index
- Created `books_first_translation_progress_idx` on `{is_first_translation, pages_translated, pages_count}` for progress queries

## Current state
- archiving: 14,827 (mostly e-rara, clearing ~400/hr)
- archive_complete: 10,854 (blocked — OCR paused by Derek)
- needs_attention: 2,616 (all e-rara, will self-resolve)
- failed: 38 (genuinely broken)
- >90% translated: 3,303
- >90% first-ever English: 1,910

## Files modified
- `scripts/workers/archive-erara.mjs` (NEW, local only)
- `~/Library/LaunchAgents/org.sourcelibrary.archive-erara.plist` (NEW, local)
- Hetzner: `scripts/workers/archive-ocr.mjs` (query fix, provider filter, Gallica rate)
- Hetzner: `scripts/workers/archive-bulk.mjs` (ia provider, page_number fallback)
- None committed to git (all are Hetzner-only patches or local scripts)
