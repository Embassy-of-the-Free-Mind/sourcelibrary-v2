---
stage: pipeline
measure: [agreement]
languages: []
canons: []
n_pages: 104
verdict: "Softening the critical rule (drop unsure findings, demote OCR non-words) moves Opus's critical-page rate from 69% to 61% but lifts Opus–Gemini agreement only from κ 0.51 to 0.57. A severity-weighted score per 1,000 words agrees far better between the two families (Spearman 0.74) than any yes/no page flag, while Opus's level runs about 1.6× Gemini's on random pages."
status: undecided
decision: "Keep reporting severity per 1,000 words, not a share of pages with a critical error. Anchor the level to one scale and show the reader spread. The rubric's 'one letter is critical' clause stays a proposal (SEVERITY-RUBRIC-PROPOSAL.md); demoting non-words changes 16 of 686 spans, too few to matter."
feeds: [judge, figure]
n_books: null
issue: [244]
---
## 2026-11-14 · Is the error zoo's critical rule too harsh, and does softening it make two judges agree? (#244)

**Question.** Derek: some severity calls have looked too harsh. The calibration set (#6420, `calibration-report-2026-11-12.md`) found the same rubric read by Opus and Gemini on identical frozen text agrees at κ 0.51, while each model re-reading its own pages agrees at 0.84–0.86. Does a softer critical rule close that gap, and is a yes/no page flag the right instrument at all?

**Frame.** The 104 calibration packets in blocks A and B (52 random, 52 top-decile risk), each read once by `opus-rubric` and `gem-rubric`; the retest pairs (Opus 15, Gemini 30). No new reads: every variant re-scores the stored reviews.

**Method.** `scripts/eval/error-zoo/calib-variants.py`, using calib-score.py's loaders and its critical definition (a `serious` finding, or right_page `no`). Variants: V1 drops findings the reader marked `sure:false`; V2 demotes an OCR-pane finding whose own explanation calls the misreading a non-word or meaningless (translation-pane "fluent over garble" stays critical, since the reader cannot see it); V3 both; V4 two or more criticals. The weighted score is MQM-style: critical 25, major or moderate 5, minor 0, per 1,000 words of the page's OCR text, under V3 rules.

**Results.**

| rule | Opus critical pages | Gemini critical pages | Opus vs Gemini κ | Opus re-read κ | Gemini re-read κ |
|---|---|---|---|---|---|
| V0 current | 69% | 53% | 0.51 | 0.86 | 0.84 |
| V1 sure only | 62% | 53% | 0.55 | 0.86 | 0.84 |
| V2 non-words demoted | 68% | 53% | 0.53 | 1.00 | 0.84 |
| V3 both | 61% | 53% | 0.57 | 1.00 | 0.84 |
| V4 two or more (V3) | 48% | 46% | 0.54 | 0.86 | 0.73 |

Weighted score per 1,000 words, Spearman between readers: Opus vs Gemini 0.74; Opus re-read 0.94; Gemini re-read 0.82. On the 52 random pages Opus gives 153 weighted points per 1,000 words and Gemini 94.

- **The sure flag is one-sided.** Opus marked 135 of its 415 serious findings unsure; Gemini marked none of its 271. A sure-only rule therefore softens one reader only.
- **The "one letter" cases are real but rare.** The narrow non-word rule catches 16 of 686 serious spans. About five are truly self-flagging (GOtt read as "GOBt", Rijn as "Aju", with the English correct). In the rest the English built on the non-word ("perversiam" rendered "perversity", reversing the sense), which is critical by any standard.
- **Consensus.** Both readers call 18 of 52 random pages critical under V3; Opus alone calls 24 and Gemini 21.
- **The gap is level, not noise.** Each reader repeats itself closely; the two differ in how much they count. A softer rule trims the level a little and leaves the disagreement.

**Caveats.** 104 pages, 15 and 30 retest pairs; the non-word rule is a keyword match on the reader's own explanation, and its 16 spans were read by eye in the output, not against the image. The weighted score's per-page level depends on a short denominator for sparse pages.

**What it means.** For the quality map and /quality: report a weighted defect rate per 1,000 words, put each reader family on one anchored scale (pooled-defects.py already does this against the served-grades scale), and show the spread between readers as part of the uncertainty. Do not publish a share of pages with a critical error; it is the least reliable number here. For the judge: when a single critical decides an action (containment, repair), confirm it with the other family; Opus's unsure criticals are the first candidates.
