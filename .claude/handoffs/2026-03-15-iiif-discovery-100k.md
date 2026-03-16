# IIIF Discovery & Import — 100K Books Plan

**Date:** 2026-03-15
**Branch:** dev/prototype
**Status:** Import running, discovery complete for e-rara

## What Was Built

Complete IIIF discovery and import system at `scripts/iiif-discovery/`:

```
scripts/iiif-discovery/
├── README.md
├── analyze-candidates.mjs      # Pre-import dedup, prioritization, cost estimates
├── import-batch.mjs             # Batch import with auto-reconnect, language filter
├── status.mjs                   # Progress dashboard
├── lib/
│   ├── candidate-store.mjs      # MongoDB staging (import_candidates collection)
│   └── iiif-metadata.mjs        # IIIF metadata extraction, date parsing, language normalization
└── sources/
    ├── erara.mjs                # e-rara OAI-PMH — COMPLETE: 160,589 candidates
    ├── gallica.mjs              # Gallica SRU API
    ├── bsb.mjs                  # BSB Munich (3 strategies: IIIF collection, OAI-PMH, range scan)
    ├── biblissima.mjs           # Biblissima Wikibase P196 sweep
    └── berlin.mjs               # Berlin SBB OAI-PMH METS
```

## Current State

### Discovery
- **e-rara: COMPLETE** — 160,589 candidates harvested (93,948 pre-1800)
- Other sources: crawlers built and validated, not yet run

### Import
- **Latin/Greek import running** — 2,560 of 18,197 imported so far
- Collection at ~14,700 books (was 10,083 at session start)
- First run imported 2,088 before MongoDB timeout; fixed with auto-reconnect
- Import running in background: `tail -5 /tmp/latin-greek-import-2.log`

### Key Fix
import-batch.mjs was rewritten to use auto-reconnecting MongoDB client instead of `withMongo` wrapper. Long-running imports (8+ hours) would kill the connection. Status updates are now best-effort — the HTTP import to `/api/import/iiif` continues even if the local DB status tracking fails temporarily.

## Supply Numbers (validated)

| Source | Pre-1800 Digitized | API | Status |
|--------|-------------------|-----|--------|
| e-rara.ch | 93,948 | OAI-PMH | Complete |
| Gallica (BnF) | 259,921 | SRU | Ready |
| BSB Munich (VD16/17/18) | 443,026 | OAI-PMH | Ready |
| Berlin SBB | ~100,000 est. | OAI-PMH METS | Ready |
| Biblissima | ~155,000 est. | Wikibase API | Ready |
| **Gross total** | **~1,050,000** | | |
| **After dedup/overlap** | **~740,000** | | |

## Costs

### Import (no processing) — $0
IIIF imports store no images. Pages reference source library IIIF servers. All 740K books could be imported for free (just MongoDB page documents).

### Processing by tier (from analyze-candidates.mjs on 58K sample)
| Tier | Description | Est. books | AI cost |
|------|-------------|-----------|---------|
| 1 | Classical languages, pre-1600 | ~10K | $23K |
| 2 | Classical 1600-1800 + vernacular pre-1600 | ~20K | $45K |
| 3 | Vernacular 1600-1800 | ~40K | $91K |
| **All** | | **~70K** | **$133K** |

### Infrastructure at 100K books
- MongoDB Atlas: $200-400/mo (320 GB processed data)
- AWS Lambda + SQS: ~$50/mo
- Vercel: ~$20/mo
- Vercel Blob: $0 (no image archiving for IIIF)

## What's Running Right Now

1. **Latin/Greek import** — `tail -5 /tmp/latin-greek-import-2.log`
   - 18,197 candidates, ~2s/book, ~10h total
   - Will finish overnight
   - Resumable (candidates marked as imported)

2. **e-rara discovery** — COMPLETE (160,589 records)

## Next Steps

1. Wait for Latin/Greek import to finish
2. Run `analyze-candidates.mjs` again with full e-rara data
3. Start Gallica crawl: `node scripts/iiif-discovery/sources/gallica.mjs`
4. Start BSB crawl: `node scripts/iiif-discovery/sources/bsb.mjs --strategy=oai --set=vd16`
5. Import remaining pre-1800 candidates by language tier
6. Begin OCR/translation processing (budget-dependent)

## Dedup Results (applied)

Probabilistic dedup (Jaro-Winkler + blocking + union-find) applied to all 828K candidates:
- 160,703 duplicates marked as skipped
- 665,148 estimated unique
- 19.7% reduction, dominated by BSB internal multi-copy dupes (135K)

LLM validation experiments (Gemini Flash):
- Gold standard (752 pairs): 75.5% agreement, 96% high confidence
- Cluster validation (100 clusters size 10+): 9% false positive rate
- Missed match detection (200 cross-source groups): **43.5% had matches string methods missed**
- Cross-language matches invisible to string methods: Latin↔German, French↔German translations

Key finding: hybrid approach (string methods for speed + LLM for accuracy on edge cases) is the right architecture. Paper documents this at `research/dedup-paper/`.

## Research Paper

`research/dedup-paper/paper.md` — draft with lit review, 5 methods, Agricola running example, 4 SVG figures.
Three experiments complete with results. Targeting DHQ or JCDL.

## GitHub Issue
https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/190

## Key Decisions Made
- **IIIF images stay external** — no Vercel Blob archiving. Source libraries are permanent institutions.
- **Import first, process later** — get to 100K browsable books immediately, translate as budget allows.
- **Priority scoring at import time** — Latin alchemy > English architecture. Pipeline processes highest-value books first.
- **Pre-import dedup** — manifest URL (exact) + normalized title/author (fuzzy) catches cross-source duplicates.

## Files Modified This Session
- `scripts/iiif-discovery/` — entire directory (new)
- No changes to existing app code

## Commands
```bash
# Check import progress
tail -5 /tmp/latin-greek-import-2.log

# Check overall status
set -a; source .env.production.local; set +a; node scripts/iiif-discovery/status.mjs

# Run analysis
node scripts/iiif-discovery/analyze-candidates.mjs

# Import more languages
node scripts/iiif-discovery/import-batch.mjs --language=German,French --limit=10000

# Start Gallica discovery
node scripts/iiif-discovery/sources/gallica.mjs
```
