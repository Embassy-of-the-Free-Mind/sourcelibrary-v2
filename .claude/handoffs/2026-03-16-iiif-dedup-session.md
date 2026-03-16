# IIIF Discovery, Import, Dedup & Research Paper

**Date:** 2026-03-15 to 2026-03-16
**Branch:** dev/prototype
**Session scope:** Build the entire pipeline from discovery to dedup to research paper

## What was accomplished

### 1. IIIF Discovery System (`scripts/iiif-discovery/`)

Built and ran crawlers for 4 European IIIF sources:

| Source | Crawler | Records | API | Status |
|--------|---------|---------|-----|--------|
| BSB Munich | `sources/bsb.mjs` | 432,113 | OAI-PMH (VD16/17/18 sets) | Complete |
| e-rara | `sources/erara.mjs` | 160,639 | OAI-PMH | Complete |
| Gallica (BnF) | `sources/gallica.mjs` | 123,439 | SRU API | Complete |
| Biblissima | `sources/biblissima.mjs` | 111,737 | Wikibase API (P196) | Complete |
| Berlin SBB | `sources/berlin.mjs` | Not yet run | OAI-PMH METS | Ready |
| **Total** | | **827,928** | | |

All records normalized to common schema in `import_candidates` MongoDB collection.

### 2. Import

- **15,885 Latin/Greek books imported** from e-rara via `import-batch.mjs`
- Collection went from 10,083 → **28,295 books**
- IIIF images served from source libraries (no Vercel Blob cost)
- Import-batch.mjs was rewritten mid-session for auto-reconnecting MongoDB (first run died after 2,088 books from connection timeout)

### 3. Probabilistic Deduplication (`dedupe-candidates.mjs`)

Jaro-Winkler + blocking + union-find clustering, applied to all 828K candidates:

| Metric | Value |
|--------|-------|
| Total candidates | 827,928 |
| Duplicate clusters | 73,009 |
| Records marked as dupes | 160,703 |
| Estimated unique | 665,148 |
| Reduction | 19.7% |

Breakdown by source: BSB 135K dupes (31% — multi-copy records), e-rara 18.6K, Gallica 9K, Biblissima 0.

**Quality assessment:**
- Clusters ≤9: ~98% accurate (201K records)
- Clusters 10-19: ~60% accurate (17.7K records) — mix of real dupes and chained false positives
- Clusters 20+: ~20% accurate (17K records) — mostly false (ducal decrees, prolific authors)
- Main failure mode: transitive chaining via union-find connects different works by the same author

### 4. LLM Validation Experiments

Three experiments with Gemini Flash (`research/dedup-paper/llm-validate.mjs`):

**Gold standard (752 pairs):** 75.5% agreement with expected labels, 96% high confidence. Key disagreement: our "related edition" sampling was flawed — many same-author pairs are genuinely different works, not editions.

**Cluster validation (100 clusters size 10+):** 9% false positive rate. LLM correctly recognizes multi-volume works as SAME_WORK.

**Missed match detection (200 cross-source groups):** **43.5% had matches string methods missed.** 66 cross-language SAME_WORK (Latin↔German, French↔German translations), 21 missed SAME_EDITION from title transcription differences.

**Key finding:** hybrid approach (string methods for speed + LLM for edge cases) is the right architecture. Matches what OCLC landed on in 2025 with human catalogers.

### 5. Research Paper (`research/dedup-paper/`)

Full draft targeting DHQ or JCDL:
- `paper.md` — sections 1-5 written, sections 6-7 have preliminary results, section 8 TODO
- 4 SVG figures (FRBR hierarchy, data pipeline, gold standard, dedup pipeline)
- `gold-standard-pairs.json` — 752 labeled pairs across 8 strata
- `llm-gold-standard-results.json` — LLM classifications for all 752 pairs
- `llm-cluster-validation.json` — 100 cluster validations
- `llm-missed-matches.json` — 87 cross-language matches found
- `generate-gold-standard.mjs` — stratified pair sampler
- `llm-validate.mjs` — Gemini Flash validation in 3 modes

Running example throughout: Agricola's De Re Metallica across BSB, e-rara, Gallica.

### 6. Union Catalog Vision

`import_candidates` is documented as a permanent research asset — a queryable union catalog of every digitized pre-modern text across European IIIF libraries. Like USTC but for digitizations. Memory file: `memory/iiif-union-catalog.md`.

## Key numbers

- **828K total candidates** harvested
- **665K estimated unique** after dedup
- **~680K realistic unique** (accounting for 4% uncertainty from large-cluster false positives)
- **28,295 books** in the collection (up from 10,083)
- **$0** infrastructure cost for import (IIIF images stay on source servers)
- **$133K** to process everything through OCR+translation
- **$23K** to process just Tier 1 (Latin/Greek/Hebrew pre-1600)

## Files created/modified

```
scripts/iiif-discovery/
├── README.md
├── analyze-candidates.mjs
├── dedupe-candidates.mjs
├── import-batch.mjs
├── status.mjs
├── lib/
│   ├── candidate-store.mjs
│   └── iiif-metadata.mjs
└── sources/
    ├── erara.mjs
    ├── gallica.mjs
    ├── bsb.mjs
    ├── biblissima.mjs
    └── berlin.mjs

research/dedup-paper/
├── paper.md
├── generate-gold-standard.mjs
├── llm-validate.mjs
├── gold-standard-pairs.json
├── gold-standard-pairs.tsv
├── llm-gold-standard-results.json
├── llm-cluster-validation.json
├── llm-missed-matches.json
└── figures/
    ├── fig1-frbr-hierarchy.svg
    ├── fig2-data-pipeline.svg
    ├── fig3-gold-standard.svg
    └── fig4-dedup-pipeline.svg

.claude/handoffs/2026-03-15-iiif-discovery-100k.md (updated)
memory/iiif-union-catalog.md (new)
```

No changes to existing application code.

## Next steps

1. **Paper experiments:** implement Methods 3-5 (Splink, token-set, embeddings), run against gold standard, fill in Sections 6-7
2. **Import more books:** German, French, Italian candidates ready for batch import
3. **Run Berlin SBB crawler** (not yet started)
4. **Fix large-cluster false positives:** add cluster validation step (centroid checking or LLM spot-check for clusters >9)
5. **Process imported books:** OCR/translation on the 15.8K Latin/Greek imports (budget-dependent)
6. **Expose union catalog via API** — make `import_candidates` queryable for researchers

## GitHub Issue
https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/190

## Commands
```bash
# Status
set -a; source .env.production.local; set +a
node scripts/iiif-discovery/status.mjs

# Import more languages
node scripts/iiif-discovery/import-batch.mjs --language=German --limit=5000

# Run analysis
node scripts/iiif-discovery/analyze-candidates.mjs

# LLM validation
node research/dedup-paper/llm-validate.mjs --mode=validate-clusters --min-size=10
node research/dedup-paper/llm-validate.mjs --mode=find-missed --sample=500
```
