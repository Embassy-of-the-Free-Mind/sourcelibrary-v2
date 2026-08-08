# Archived 2026-08 — FT v2 rationalization (issue #3726)

Superseded script generations, moved here during the FT v2 cleanup. Kept for
provenance, never run.

- `ft-pilot-sample.mjs`, `-r2`, `-r3` — first three generations of the FT pilot
  sampler. The live one is `scripts/eval/ft-pilot-sample-r4.mjs`. Their output
  JSONs (which `ft-pilot-score-cum.mjs` still reads) remain in
  `scripts/eval/results/`.
- `translation-census.mjs`, `translation-census-v2.mjs` — first two census
  generations. The live one is
  `scripts/analysis/translation-census-all-languages.mjs`; the works-catalog
  census lane (`scripts/works-catalog/translation-census.mjs`) is a different,
  live tool.

Verified before moving: no exact-path inbound references in tracked files
(`git grep`, 2026-08-08).
