# First-Translation Quality Report — 2026-06-29

*Non-circular eval (#2876). Grades STORED verdicts against gold we already hold; ~zero token cost. Stats: Wilson 95% CIs (`inference.ts`) + Cohen's κ (`agreement.ts`).*

## Gold set

- **2272** books with a non-pipeline answer.
  - Adjudicated (source 2): census 483 · Tier-2 study 384 · external-API 33 32.
  - Catalog priors (source 1, Latin slice): 1373 added (of 1436 assessed books matched to a held prior; 121 with a confirmed *complete* prior). Scanned 10420 assessed books against 24040 catalog rows.

> **Recall lever status:** the catalog confirms a *complete* prior on only 121 of 1436 matched books — not because priors are absent but because `translation_catalogs.completeness` is mostly unset. Filling that field is the single highest-leverage unblock for the recall measurement (issue §0 finding, now quantified).

## Precision & recall (per method)

`precision(first)` = of books a method badges first, how many gold confirms · `precision(not_first)` = of claimed priors, how many are real (**1 − fabrication rate**) · `recall(not_first)` = of known priors, how many the method catches.

| Method | precision(first) | precision(not_first) | recall(not_first) | emitted | skipped (circular) |
|---|---|---|---|---|---|
| Stored disposition (production) | 58.9% [55.1%–62.6%] (393/667) | 43.2% [28.7%–59.1%] (16/37) | 72.4% [70.0%–74.6%] (1084/1498) | 2196 | 0 |
| Derived verdict (derive.ts) | 55.5% [50.2%–60.7%] (187/337) | 52.9% [31.0%–73.8%] (9/17) | 49.4% [46.8%–52.0%] (701/1420) | 1748 | 452 |
| Tier-2 stored verdict | n/a (0) | n/a (0) | 0.0% [0.0%–79.3%] (0/1) | 1 | 452 |

> **Measured fabrication rate (production "prior found"):** 56.8% of stored `not_first` dispositions are NOT confirmed by gold (n=37). The docs' "~63%" is now a measured 43.2% precision.

> **Read precision as a sample-conditional number, not the corpus rate.** The adjudicated gold (Tier-2 study + census) was drawn to probe suspected errors and promote/demote candidates, so it is enriched for hard cases — precision here is a *lower bound* on whole-corpus precision, and recall is measured on the Latin slice the catalog can speak to. The honest fix is the unified sampling pass (#2564 §F): draw the Tier-2 queue AS a stratified random sample so each run's gold doubles as a corpus-representative calibration set.

## Stratified — Western vs non-Western (the recall gap)

| Method | stratum | precision(first) | recall(not_first) |
|---|---|---|---|
| Stored disposition (production) | western | 68.3% [63.4%–72.8%] (254/372) | 74.7% [72.3%–76.9%] (1023/1370) |
| Stored disposition (production) | non-Western | 47.1% [41.5%–52.8%] (139/295) | 47.7% [39.2%–56.3%] (61/128) |
| Derived verdict (derive.ts) | western | 72.0% [61.4%–80.5%] (59/82) | 52.4% [49.7%–55.1%] (693/1322) |
| Derived verdict (derive.ts) | non-Western | 50.2% [44.1%–56.3%] (128/255) | 8.2% [4.2%–15.3%] (8/98) |
| Tier-2 stored verdict | western | n/a (0) | 0.0% [0.0%–79.3%] (0/1) |
| Tier-2 stored verdict | non-Western | n/a (0) | n/a (0) |

## Stratified — single-work vs container

| Method | stratum | precision(first) |
|---|---|---|
| Stored disposition (production) | single-work | 59.7% [55.9%–63.5%] (381/638) |
| Stored disposition (production) | container | 41.4% [25.5%–59.3%] (12/29) |
| Derived verdict (derive.ts) | single-work | 55.8% [50.4%–61.1%] (183/328) |
| Derived verdict (derive.ts) | container | 44.4% [18.9%–73.3%] (4/9) |
| Tier-2 stored verdict | single-work | n/a (0) |
| Tier-2 stored verdict | container | n/a (0) |

## Calibration — does `evidence_strength` predict correctness?

| evidence_strength | accuracy vs gold | n |
|---|---|---|
| strong | 50.0% | 6 |
| moderate | 0.0% | 1 |

_n=7 is too small to interpret. Almost all graded `first_translation.evidence_strength` values today were written from the same adjudications used as gold (excluded as circular). Calibration becomes measurable once tier-1 derivation writes graded verdicts to books OUTSIDE the gold set — re-run then._

## Agreement (source 3, label-free) — cross-family Cohen's κ

From 46448 attempts in `first_translation_attempts`, each book voted per evidence family (catalog / model-knowledge / agent). κ corrects raw agreement for chance.

- **Overall mean κ = 0.355** (fair), over 12283 books with ≥2 families.
- Western: κ = 0.354 (fair, n=8160) · non-Western: κ = 0.272 (fair, n=2011).

| family pair | κ | raw agree | n |
|---|---|---|---|
| agent ↔ catalog | 0.204 | 73.7% | 498 |
| agent ↔ model_knowledge | 0.373 | 68.8% | 494 |
| catalog ↔ model_knowledge | 0.488 | 73.6% | 12277 |

## How to read this

- **High `precision(not_first)` + low `recall(not_first)`** = the cheap catalog path is trustworthy when it fires but misses priors → the recall lever (catalog completeness, work_id clustering) is where to invest, not more verification.
- **A stratum where non-Western recall ≪ Western recall** confirms catalogs don't index those scripts → route those books to Tier-2 / alternative authorities, never auto-badge.
- **Calibration that rises strong > moderate > weak** is what makes graded badging trustworthy; flat calibration means `evidence_strength` isn't earning its gate.
- Effort routing follows the numbers: spend the ~57k-tokens/book Tier-2 disposer only where cheap tiers are measured unreliable (the ambiguous middle and books about to be publicly badged).

*Full machine-readable detail: `scripts/eval/results/ft-quality-report-2026-06-29.json`.*
