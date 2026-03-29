# Session: Issue triage, domain migration, taxonomy design

## Date: 2026-03-27

## What got done
- **Merged PR #424** (support page copy) + **PR #438** (dead-link check + migration fix)
- **Closed 10 issues:** #419, #387 (stale incidents), #395/#396/#397 (folded into #368), #407/#409/#351 (folded into #353), #398 (domain migration verified), #383 (bracket conversion — won't-fix, full prompt audit posted)
- **Domain migration complete:** 2,345 `esoteric-arts` books split into `practice`/`divination` via Gemini (3 passes, 0 remaining)
- **Dead-link health check script** built and shipped: `scripts/maintenance/dead-link-check.mjs`
- **Full prompt audit** on #383: discovered ALL translation prompt versions (even v1) already instruct XML tags. Brackets come from Gemini ignoring instructions + OCR layer annotations flowing through.
- **48-domain taxonomy designed** for #368, tested against real library data (67% category-mappable, 33% needs Gemini)

## Open issues: 20 → 10
| # | Issue | Status |
|---|-------|--------|
| 434 | Split detection pipeline phases | Open |
| 432 | BPH migration: direct R2 upload | Open, urgent |
| 384 | Migrate hardcoded language prompts to DB | Open |
| 374 | Gemini classification for artwork collections | Open |
| 373 | Dead-link health check | Closed by PR #438 |
| 368 | Redesign faceted taxonomy | Open — 48 domains finalized, ready for Phase 1 |
| 353 | Expand enrichment (epic) | Open |
| 350 | Hebrew/Rashi OCR quality audit | Open |
| 348 | Embed the library (Gemini embeddings) | Open |
| 385 | Epic: Catalog Coverage | Open |

## Next: #368 Phase 1 implementation
1. Update `src/lib/taxonomy/faceted-vocabulary.ts` with 48 domains (currently has stale 15-value vocabulary)
2. Write category→domain mapping script for 67% free coverage
3. Gemini tagger for remaining 33% (~$2-5)
4. Update `/topics` browse page with 3-level hierarchy
5. Key gotcha: Dunhuang (1,227) and Manichaeism (1,225) must NOT auto-map to buddhism/gnosticism — need per-book Gemini classification

## Note on git
- One commit went directly to main (migration script fix) instead of through PR. Harmless but broke workflow. Watch for branch state.
- The old `faceted_tags.knowledge_domain` values in DB are now: sacred, cosmos, practice, divination, governance, philosophy, medicine, mathematics. These will be replaced by the 48-domain system.
