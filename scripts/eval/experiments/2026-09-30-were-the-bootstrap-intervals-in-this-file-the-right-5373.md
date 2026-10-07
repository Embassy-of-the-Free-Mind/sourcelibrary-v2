## 2026-09-30 — Were the bootstrap intervals in this file the right width? The generator cycled; 31 quoted intervals recomputed, no decision changes (#5373)

**Headline: no routing or adoption decision changes. 22 of the 31 quoted intervals moved, most by a few percent of
their width; two had been a quarter to a third too narrow (Paddle on Chinese manuscript, lite on 18th-century
Greek). One label flips (v15's invented-tag reduction becomes decisive, by one page in 320), and the flip PR #5372
found in its own first score is confirmed.**
- **The fault.** `lib/paired-stats.mjs` drew from `seed = (seed * 1103515245 + 12345) & 0x7fffffff` in double
  arithmetic. The product passes 2^53, so the low bits were rounded off before the mask kept exactly those bits:
  13,676 distinct values in 1,000,000 draws, deciles 95,446–104,437, chi-square 106,210 over 304 bins (303 expected).
  Three scripts carried their own copy beside the library (`stats-cross-model`, `reference-error-rate`,
  `ocr-preprocessing/gemini-score`). All four now use mulberry32: 999,759 distinct, deciles 99,388–100,359,
  chi-square 297.
- **The error depended on the seed.** On paired differences shaped like #5372's (23 pages up, 11 down, 270 ties), the
  old generator gave 0.88 of the analytic width on 38 of 40 seeds and 0.35 on two. The new one gives 0.97–1.01.
- **Method.** Stored verdicts and scores only, $0. For each result the OLD generator had to reproduce the stored
  interval first (`PAIRED_STATS_LEGACY_LCG=1`); only then was it recomputed. v15 needed the scorer as of d49c98985,
  because the note verifier changed afterwards. External check: on #5372 the fixed library reproduces that PR's own
  bootstrap exactly and sits within 0.2 pp of its analytic intervals on all nine primary cells.
- **Largest moves** (each row below carries its own note): Paddle on Chinese manuscript Δ [−0.036, −0.014] →
  [−0.047, −0.015]; Greek 1700–1799 lite median CER 0.077–0.122 → 0.080–0.140; Latin reference error [0.17, 2.47] →
  [0.15, 2.78]; batch-continuity A2 [−25.5, −1.2] → [−26.5, −2.0]. Every rule that reads an interval gives the same
  verdict: the Greek "inadequate" reads the median, the cost lane reads CI-upper ≤ +0.05, the continuity bound fails
  for every arm before and after.
- **Not an interval from this generator, so untouched:** leaf identity #5311 (Wilson); restraint A/B #5349 (McNemar);
  garble #5369 and invention location #5363 (counts, precision/recall); picture boxes and the evidence dashboard
  (their own mulberry32); every Kraken/Yigdzin arm of #5250 (Python `random`).
- **Could not be recomputed:** the observational lite-vs-flash read (#4759). Its pairs file was never committed. Three
  of its intervals end near zero; its report now says so.
- **Left as they are, on purpose:** six scripts that use the same arithmetic to draw a SAMPLE or a blinded shuffle
  (`harvest-wikisource-gt`, `contact-sheet-screen`, `neighbour-leaf-test`, `repeat-instability-draw`,
  `suda-sol/make-pilot`, `analysis/gap-validation-gold-export`). Those draws are made and judged; changing the
  generator would stop them reproducing. A unit test lists them and fails on a seventh.
- *Replicated?* The generator fix is pinned by `tests/unit/paired-stats-prng.test.ts` (distinctness, uniformity,
  interval width over twenty seeds; it fails on the old generator). *Artifact:* the corrected reports under
  `results/`; before/after table on #5373.
