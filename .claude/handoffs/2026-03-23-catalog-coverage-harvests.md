# Handoff: Catalog Coverage — IIIF Library Harvests

**Date:** 2026-03-23
**Branch:** main (committed)

## What Was Done This Session

### 1. Spot Checks & Bug Fixes
- Verified English false positives = 0 (confirmed)
- Found Ficino scan matching bug: `-o` suffix not stripped (ficino ≠ ficin)
- Fixed suffix regex to include Italian `-o`: `/(us|is|ius|inus|o)$/`
- Full rebuild completed — Ficino De Vita now correctly matched to Gallica scans

### 2. Dashboard Redesign
- Removed all lucide-react icons, text-based indicators only
- Source Library visual identity: Cormorant Garamond headings, cream (#fdfcf9) background, warm palette
- Rust (#9e4a3a) CTAs, gold (#c9a86c) scans, sage (#8b9a7d) translations
- "The Opportunity" hero shows non-English scanned-but-untranslated works (109,506)
- "Actionable Gaps" tab with preset filters
- Language table with clickable gap column
- USTC links, IIIF viewer links, source citations per result
- Scan quality tiers shown (high/microfilm)

### 3. Internet Archive English Books Harvest
- Discovered IA has 106K Early English Books (microfilm rescans, uploaded early 2024)
- Collections: `pub_early-english-books-1475-1640` (34,902) and `pub_early-english-books-1641-1700` (71,441)
- Harvested 67,681 items into `import_candidates` (source: `ia_microfilm`, scan_quality: `low`)
- English scan coverage: 1,152 → 51,054 (0.7% → 31.1%)
- Year-range splitting needed to bypass IA's 10K result cap per query

### 4. Scan Quality Tiers
- Model: high (BSB, e-rara, SBB, HAB, etc), medium (Gallica, Biblissima), low (IA microfilm)
- Stored per-edition in `catalog_coverage.scan_quality`
- Build script prefers higher-quality scans when multiple match
- Dashboard shows quality breakdown in language table and search results

### 5. USTC Holdings & Digitisations Scraping
- USTC edition pages (ustc.ac.uk) embed Inertia.js JSON with copies + digitisations
- Harvester: `scripts/catalog-coverage/harvest-ustc-holdings.mjs`
- 1000-edition sample: 4.5 copies/edition avg, 41% have digitisation links
- 40+ digitisation providers found (EEBO, HAB, BSB, Google Books, HathiTrust, etc.)
- Stored in `ustc_holdings` collection (ustc_sn, copies[], digitisations[])
- GitHub issue #321 tracks the full plan

### 6. A-Tier German Library OAI-PMH Harvests
- Harvester: `scripts/catalog-coverage/harvest-oai-libraries.mjs`
- **SBB Berlin**: VD16 set (239K records), running. ~5K pre-1700 so far. All with IIIF manifests.
- **HAB Wolfenbuttel**: 42K records. Needs restart — parser fixed to handle missing dates.
- **SLUB Dresden**: 650K records. Started, running. ~1.6K pre-1700 so far.
- **Heidelberg**: Started, running. ~1.6K pre-1700 so far.
- OAI records include: title, author, year, language, publisher, place, rights, physical_format, page_count, subjects, manifest_url, viewer_url, scan_quality, harvested_at

### 7. Provider Research
- 10 digitisation providers researched (Berlin, Dresden, Heidelberg, HAB, Vatican, Gottingen, Halle, Cervantes, ONB Vienna, Google Books)
- A-tier (IIIF + OAI-PMH): SBB Berlin, SLUB Dresden, Heidelberg, HAB
- B-tier (IIIF, no bulk): Vatican (80K manuscripts), Gottingen, Halle
- C/D-tier: Cervantes (no IIIF), ONB (portal migrated), Google Books (no API)
- HAB may not actually have public IIIF manifests despite initial research claim

## Pending / Backfill

### Harvests Still Running
- SBB Berlin: ~50% through VD16 (need VD17 too)
- SLUB Dresden: just started (650K records, will take hours)
- Heidelberg: running
- HAB: needs restart with fixed parser (`--library=hab`)

### Backfill Needed
- **scan_quality**: Set on 664K existing import_candidates (bsb/erara='high', gallica/biblissima='medium')
- **author_surname**: Extract on existing import_candidates
- **harvested_at**: Backfill on existing records from conversation dates
- Memory note: `.claude/projects/-Users-dereklomas-sourcelibrary/memory/catalog-coverage-backfill.md`

### Next Steps
1. Restart HAB harvest with fixed parser
2. Let SBB/SLUB/Heidelberg complete
3. Run full catalog_coverage rebuild to match new sources against USTC
4. Update meta with quality-aware stats
5. Consider USTC holdings bulk data request (email ustc@st-andrews.ac.uk)
6. Backfill scan_quality and author_surname on existing 664K records

## Key Numbers (Current)
| Metric | Value |
|--------|-------|
| Total editions | 1,562,796 |
| With IIIF scan | ~271K (17.3%) |
| English scans | 51,054 (31.1%) — was 1,152 |
| With Eng. translation | 110K (7.0%) |
| Non-English scanned not translated | 109,506 works |
| Neither scanned nor translated | 860,337 works |
| import_candidates | ~730K+ (original 664K + 67K IA + new OAI harvests) |
| USTC holdings sampled | 1,050 editions → 4,539 copies, 414 digitisations |

## Commands
```bash
# Restart HAB harvest
set -a; source .env.production.local; set +a
node scripts/catalog-coverage/harvest-oai-libraries.mjs --library=hab

# Full rebuild after harvests complete
node scripts/catalog-coverage/build.mjs

# Client-side meta computation (if build fails on work-level stats)
# See inline script in conversation

# USTC holdings scrape (rate-limited 1 req/sec)
node scripts/catalog-coverage/harvest-ustc-holdings.mjs --sample=1000

# IA English books (already complete)
node scripts/catalog-coverage/harvest-ia-english.mjs
```
