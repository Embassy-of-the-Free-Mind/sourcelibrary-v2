# 2026-03-23/24: Byzantine Philosophy, Letter Collections, Global Import Pipelines, WEMI Linking, Manuscript OCR

## What Was Done

### Books Imported: 786 books, 222,770 pages

| Batch | Books | Pages | Collection |
|-------|-------|-------|------------|
| Byzantine (IA + Gallica) | 13 | 5,710 | byzantine-philosophy |
| Bodleian Greek MSS (discovery pipeline) | 111 | 21,021 | byzantine-philosophy |
| Late Antique Letters (PG/PL/MGH/CSEL/Thiel) | 25 | 14,321 | theology |
| Classical Letters (Cicero/Seneca/Pliny/Fronto/Aldine 1499) | 20 | 9,234 | classical-philosophy |
| Renaissance Letters (Ficino/Erasmus/Luther/Calvin/Galileo/Descartes) | 22 | 13,872 | renaissance-philosophy |
| Scientific Revolution (Brahe/Kepler/Dee/Newton/Spinoza/Grotius/Paracelsus) | 16 | 10,008 | natural-philosophy |
| Chester Beatty (Islamic/Persian/Hebrew/Syriac) | 27 | 9,572 | sacred-texts |
| John Rylands Manchester (Gaster, Hebrew, Persian, Latin, Arabic) | 552 | 139,032 | — |

### New Collection
- **byzantine-philosophy** — "The Last Flowering of Greek Thought, 1261-1453"
- 124 books (13 IA/Gallica + 111 Bodleian)
- Key authors: Plethon, Bessarion, Palamas, Scholarios, Metochites, Trebizond, Gaza, Argyropoulos

### New Import Routes (10 new, 24 total)

| Route | Library | IIIF | PR |
|-------|---------|------|----|
| `/api/import/vatlib` | Vatican DigiVatLib | v2 | #324 (merged) |
| `/api/import/onb` | Austrian National Library | v2 | #324 (merged) |
| `/api/import/bl` | British Library | v3 | #331 (merged) |
| `/api/import/sbb` | Staatsbibliothek Berlin | v2 | #331 (merged) |
| `/api/import/kyoto` | Kyoto University RMDA | v3 | #334 (merged) |
| `/api/import/yale` | Yale Beinecke | v3 | #335 (merged) |
| `/api/import/harvard` | Harvard Houghton | v2 | #335 (merged) |
| `/api/import/penn` | Penn Schoenberg | v2 | #335 (merged) |
| `/api/import/huntington` | Huntington Library | v2 | #335 (merged) |
| `/api/import/getty` | Getty Research | v3 | #335 (merged) |

Full inventory: `memory/import-pipeline-inventory.md`

### FAQ Page
- PR #328 (merged) — `/about/faq`, 9 questions
- Addresses AI translation quality critique (prompted by viral Bluesky post by @magisterconway — 2,832 likes)
- Key messaging: "working translations, not scholarly editions", originals always visible, we OCR from IIIF not bad IA OCR
- Includes curatorial philosophy rooted in EFM/BPH tradition

## Key Research Findings

### Roman Letters Project (romanletters.org)
- 7,049 late Roman letters, Claude-translated from IA OCR
- Viral Bluesky critique: translations are "almost entirely hallucination"
- We imported the underlying source editions (PG, PL, MGH, CSEL) to OCR/translate properly
- Source list extracted from their SQLite DB: `/tmp/roman-letters-sources.txt`

### British Library Post-Cyberattack
- BL IIIF route works but most manuscripts return 403 (2023 ransomware recovery ongoing)
- 54 esoteric/alchemical MSS catalogued with ARK identifiers: `/tmp/bl-discovery.txt`
- Polonsky Pre-1200 project items work; older MSS blocked
- Route ready — imports will work when BL recovers

### Vatican Rate Limiting
- IIIF manifests work but aggressively rate-limited (429 after ~30 rapid requests)
- Route works for manual one-at-a-time imports with 10s delays
- Search requires session cookies — no bulk discovery possible

### Global Library Survey
- **Confirmed IIIF**: BL, SBB Berlin, Kyoto RMDA, Yale, Harvard, Penn, Huntington, Getty
- **Needs API key**: NLI (Israel), Korean NL, Trove (Australia)
- **Ready for OAI-PMH**: Jagiellonian Krakow (Copernicus holograph!)
- **Dead ends**: NLC China (geo-blocked), Russian libraries (restricted), Marciana (no IIIF), Qatar (403)
- **SE Asian MSS**: Route through DREAMSEA (HMML), BL EAP, or Leiden — no SE Asian national library has IIIF
- **Hidden gem**: OPenn — 51K MSS from 30+ institutions as bulk CC0 TIFFs

## Batch Import Scripts (in repo root, gitignored)
- `_tmp-batch-import-byzantine.mjs` — IA + Gallica Byzantine batch
- `_tmp-batch-import-bodleian-byzantine.mjs` — Bodleian discovery pipeline (reusable for any theme)
- `_tmp-discover-vatlib-greek.mjs` — Vatican IIIF probe (rate-limited)
- `_tmp-batch-import-late-antique-letters.mjs` — PG/PL/MGH/CSEL/Thiel
- `_tmp-batch-import-classical-letters.mjs` — Cicero/Seneca/Pliny/Fronto/Aldine
- `_tmp-batch-import-renaissance-letters.mjs` — Ficino/Erasmus/Luther/Galileo/Descartes
- `_tmp-batch-import-scientific-revolution-letters.mjs` — Brahe/Kepler/Dee/Newton/Spinoza

## Failed Imports (to retry)
10 late antique books failed — Google Books scans without images:
- PL 16 (Ambrose), PL 22 (Jerome), PL 33 (Augustine), PL 54 (Leo)
- PG 32 (Basil), PG 37 (Gregory Nazianzus)
- MGH AA VIII (Sidonius), MGH AA XII (Cassiodorus)
- MGH Ep I-II (Gregory the Great), CSEL 29 (Paulinus)
- Fix: Find alternate IA scans with jp2 images

1 classical letter failed:
- Cicero Ad Familiares (`mtulliiciceroni00cice_5`) — same text-only issue

### WEMI Work-Level Linking (2026-03-24)
- `work_id` field populated for 297 books across 45 canonical works
- `scripts/backfill-work-ids.mjs` — pattern-based matching with 60+ work definitions
- Top: Corpus Hermeticum (24), Pico Opera (20), Iamblichus De Mysteriis (19), Plotinus Enneads (17), Zohar (13)
- New `/work/[id]` pages (e.g. `/work/zohar`) — all editions with thumbnails, libraries, translation progress
- Compact "N editions across M libraries →" link on book detail sidebar
- Memory: `memory/work-id-linking.md`

### Manuscript OCR Calibration (2026-03-24)
- OCR prompt v8 → v9 → v10 evolution:
  - v8: zero `<unclear>` on manuscripts (hallucinated fluent text)
  - v9: ~90% `<unclear>` (gave up on everything — useless)
  - v10: calibrated to 5-15% unclear (honest and useful)
- New `<script>printed|handwritten|mixed</script>` required tag
- Manuscript warnings now propagate from OCR → translation panel
- `performTranslation()` in ai.ts injects `<script>` and `<warning>` into translation output
- NotesRenderer shows amber/red banners even when showMetadata=false
- `page.script_type` stored in MongoDB via write processor
- Tested on Zohar BnF MS (Sephardic cursive) — Gemini 3 Flash with paleography context produces good Aramaic readings
- Memory: `memory/lesson-manuscript-ocr-calibration.md`

### New Pages Built
- `/about/faq` — 9 questions addressing AI translation critique, curatorial philosophy (PR #328)
- `/about/sources` — 51 institutions across 22 countries, 4 tiers (PR #338)
- `/work/[id]` — work-level pages showing all editions

### Additional Import Routes (session day 2)
| Route | Library | IIIF | Notes |
|-------|---------|------|-------|
| `/api/import/bl` | British Library | v3 | Post-cyberattack, most MSS 403 |
| `/api/import/sbb` | Staatsbibliothek Berlin | v2 | Diez Arabic/Persian/Turkish |
| `/api/import/kyoto` | Kyoto University RMDA | v3 | Japanese rare books |
| `/api/import/yale` | Yale Beinecke | v3 | Voynich, alchemical MSS |
| `/api/import/harvard` | Harvard Houghton | v2 | Islamic Heritage Project |
| `/api/import/penn` | Penn Schoenberg | v2 | + OPenn 51K MSS CC0 |
| `/api/import/huntington` | Huntington Library | v2 | Ellesmere Chaucer |
| `/api/import/getty` | Getty Research | v3 | Alchemical MSS, emblems |

### Global Library Survey Results
- 51 institutions surveyed across 22 countries
- SE Asian MSS: route through DREAMSEA (HMML), BL EAP, or Leiden
- Indonesian MSS: Perpustakaan Nasional unreachable, Leiden blocks automation
- Jagiellonian Krakow: OAI-PMH confirmed (PDF/DJVU only, no IIIF)
- Chester Beatty: OpenAPI confirmed, 4,495 records, IIIF 2.1.1
- John Rylands: Luna-based, IIIF at digitalcollections.manchester.ac.uk/iiif/{MS-ID}, 859 MSS discovered
- BL: 54 esoteric MSS catalogued, blocked post-cyberattack

## Next Steps
1. **BL recovery monitoring** — check `bl.digirati.io` periodically for alchemical MSS access
2. **Jagiellonian OAI-PMH harvest** — Copernicus De Revolutionibus holograph (PDF import via Hetzner)
3. **DREAMSEA/HMML contact** — Indonesian/SE Asian manuscripts
4. **NLI institutional access** — Kabbalah, Maimonides, Geniza
5. **Chester Beatty full import** — 4,495 records via OpenAPI, beyond the 27 curated
6. **Manuscript OCR re-processing** — re-OCR Rylands/Bodleian MSS pages with v10 prompt
7. **Work_id expansion** — Gemini batch for the 32K unmatched books
8. **OPenn bulk ingest** — 51K MSS as CC0 TIFFs from 30+ institutions
9. **Failed import retries** — find alternate IA scans for the 11 text-only items
