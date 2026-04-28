# Pipeline Fix + IIIF Expansion — 2026-04-29

## Pipeline Fixes
- Purged ~7,800 stale Gemini batch succeeded jobs blocking OCR submissions across 3 API keys
- Advanced 234 IIIF books from stuck `archiving` → `archive_complete`
- Recycled 1,466 books (415K pages) from `translate_complete` back to `archive_complete` for full OCR (were stuck with 25-page preview only, including Tibetan/Bhutanese texts)
- Lesson saved: `memory/lesson-gemini-batch-succeeded-accumulation.md`

## Archive-OCR Domain Fix
- PR #1424 (auto-merging): Added BL EAP, Met Museum, NDL, Getty, Stanford, Darmstadt, Kyoto to archive-ocr provider lists and rate limits
- 1,213 recent books (200K pages) were not on R2 because their domains weren't in provider lists
- Root cause: archive-bulk only handles IA books; IIIF books need archive-ocr, which filters by domain

## New Harvesters
- `scripts/iiif-discovery/sources/sat.mjs` — SAT Daizokyo Buddhist text aggregator. 8,764 manifests discovered from UTokyo, NDL, Kyoto, BSB, BnF Pelliot chinois, etc.
- `scripts/iiif-discovery/sources/harvard.mjs` — Harvard LibraryCloud API. 2,044 items discovered across medieval MSS, Korean classics, Latin/Renaissance. Harvard has 222K+ digitized books total.
- Both committed on branch `worktree-archive-iiif-domains`

## Imports Done
- 41 SAT Buddhist texts imported (~4,800 pages): Lotus Sutra, Diamond Sutra, Platform Sutra, Laṅkāvatāra, Mahāprajñāpāramitā, etc.

## Research Docs
- `.claude/docs/iiif-sources-2026-04.md` — Tier 1-3 IIIF sources for expansion
- Issue #1426 — IIIF expansion roadmap (7 new harvesters needed)

## Asian IIIF Research Findings
Top untapped sources:
- NIJL Kokusho (Japan): 101K manifests of pre-modern Japanese literature
- Waseda Kotenseki (Japan): 300K Japanese/Chinese classics
- IDP Dunhuang (BL): 500K+ Silk Road manuscripts (IIIF v3)
- UTokyo: 31K manifests including 190K pages Buddhist canon (CC BY)
- Keio: 4.5K manifests (Gutenberg Bible, ukiyo-e, medical)
- SAT Daizokyo: 8.7K Buddhist manuscript aggregator (done)
- Korea/China: no IIIF adoption yet (proprietary systems)

## Next Steps
- Run larger SAT import batches (8,700+ remaining)
- Import Harvard discoveries via `import-batch.mjs --source=harvard`
- Write NIJL harvester (101K Japanese texts — biggest win)
- Write e-codices harvester (single collection.json → 2,800 Swiss MSS)
- Merge PR #1424, pull to Hetzner
- Monitor recycled 1,466 books flowing through full OCR
