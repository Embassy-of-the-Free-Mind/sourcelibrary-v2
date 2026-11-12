# Audit policy replay (#8632) — target: serious OCR error or wrong leaf

Frame: the weekly audit's random stratum, served, fresh: 1249 pages, 228 positive (18%), 66 cells. Scores: train.py out-of-book. 8 weeks × 40 checks, 300 simulations each.

## 1. Do cells know something the score does not?

Cross-validated AUC, score alone 0.843; score + 12 cell indicators 0.841.

| cell (language, OCR family) | pages | observed | score's mean prediction (recalibrated) | gap |
|---|---|---|---|---|
| Latin|flash | 398 | 14% | 14% | -0% |
| Latin|lite | 160 | 33% | 29% | +4% |
| Chinese|paddle | 144 | 12% | 16% | -3% |
| German|flash | 109 | 7% | 8% | -0% |
| German|lite | 60 | 15% | 14% | +1% |
| Greek|flash | 57 | 35% | 32% | +3% |
| French|flash | 35 | 9% | 11% | -2% |
| Italian|flash | 31 | 6% | 14% | -8% |
| Dutch|flash | 28 | 4% | 14% | -10% |
| Chinese|flash | 24 | 25% | 24% | +1% |
| Chinese|other | 15 | 0% | 23% | -23% |
| Tibetan|other | 15 | 0% | 2% | -2% |

## 2. Serious pages found per 40 checks

| policy | found per 40 (mean over sims) | vs random |
|---|---|---|
| random | 7.4 | 1.00× |
| top-decile | 18.7 | 2.54× |
| pps | 11.1 | 1.51× |
| pps-sharp | 16.8 | 2.27× |
| cell-ts | 12.1 | 1.64× |
| oracle | 28.5 | 3.87× |

Unbiased rate from the adaptive draw: the Hájek estimate from pps-drawn pages averages **17.1%** (sd across weeks 1.7%) against the frame's true rate **18.3%**. With weights ∝ score³ (pps-sharp) the estimate averages **16.0%** (sd 3.1%). A top-decile draw cannot give this estimate: pages outside the decile have inclusion probability zero.

