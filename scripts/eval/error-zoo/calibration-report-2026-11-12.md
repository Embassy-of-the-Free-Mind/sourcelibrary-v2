# Calibration set — first results (#6420)

118 packets: A 72, B 32, C 10, D 4. Readers read: opus-rubric 118, gem-rubric 118, opus-rubric-r2 15, gem-rubric-r2 30, opus-current 42.

## Agreement on identical text

| pair | pages | critical: A rate | B rate | raw agree | κ | κ, sure only | page band κ |
|---|---|---|---|---|---|---|---|
| two families, same rubric | 104 | 69% | 53% | 76% | 0.51 | 0.55 | 0.46 |
| Opus re-read | 15 | 67% | 60% | 93% | 0.86 | 0.86 | 0.86 |
| Gemini re-read | 30 | 67% | 73% | 93% | 0.84 | 0.84 | 0.85 |
| rubric vs current brief (Opus) | 42 | 62% | 45% | 83% | 0.67 | 0.77 | — |

## Planted errors and controls (known answers, no human needed)

| reader | planted: page flagged critical | planted: the planted words named | wrong page caught | typed e-text flagged critical (false alarm) |
|---|---|---|---|---|
| opus-rubric | 9/10 | 7/10 | 3/3 | 0/1 |
| gem-rubric | 9/10 | 6/10 | 3/3 | 0/1 |
| opus-rubric-r2 | 3/3 | 2/3 | 1/1 | 0/1 |
| gem-rubric-r2 | 4/4 | 3/4 | 3/3 | 0/1 |
| opus-current | — | — | — | — |

## Critical rate by block and stratum (rubric readers)

| reader | A random | A top decile | B random | B top decile |
|---|---|---|---|---|
| opus-rubric | 17/36 [32%, 63%] | 27/36 [59%, 86%] | 12/16 [51%, 90%] | 16/16 [81%, 100%] |
| gem-rubric | 11/36 [18%, 47%] | 21/36 [42%, 73%] | 10/16 [39%, 82%] | 13/16 [57%, 93%] |

## The risk score against each reader, beside the ceiling (blocks A and B)

- score vs opus-rubric: AUC 0.80 on 104 pages (72 critical)
- score vs gem-rubric: AUC 0.77 on 104 pages (55 critical)
- ceiling: Opus label as a predictor of Gemini's, balanced accuracy 0.75; Gemini's of Opus's 0.79 (a binary label's AUC equals its balanced accuracy)

