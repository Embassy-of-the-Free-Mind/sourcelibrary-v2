---
stage: ocr
measure: [agreement, judged]
languages: [la, de, fr, it, grc, zh, ar, he, bo]
scripts: [Latn, Grek, Hani, Arab, Hebr, Tibt]
canons: []
n_books: 118
n_pages: 118
status: informational
feeds: [judge, detector]
superseded_by: null
router_evidence: "none — no route was compared; readers were compared on frozen text"
defect_rates: "none — page-level critical yes/no and bands, not defects per 1,000 words"
verdict: "On 118 frozen pages, Opus and Gemini 3.8 Flash low under one consequence-based rubric agree on 'this page has a critical error' at kappa 0.51 (76% raw; Opus 69%, Gemini 53%), while each family agrees with itself at 0.84-0.86 on re-reads: most disagreement is between the families' thresholds, not noise. Both readers flag 9 of 10 planted critical errors and 3 of 3 wrong-page controls. The risk score predicts each reader at AUC 0.80 / 0.77, as well as one family's label predicts the other's (0.75-0.79): it is at the agreement ceiling. The rubric moves Opus: 62% of block-A pages critical under it against 45% under the current brief (kappa 0.67 between the two)."
decision: "No production write. Derek's 36-page sitting is prepared (not scheduled). The Opus re-read (15/30) and current-brief (42/72) arms stopped when the box's Claude account reached 100% of its week; the numbers use what was read."
---

PRIOR ART: `scripts/eval/error-zoo/CALIBRATION-SET-DESIGN.md` (the design this runs); `2026-11-12-is-serious-predictable-6420.md` (which found no independent second reading in the stored data); `scripts/audit/convergent-audit-lib.mjs` kindAgreement.

## 2026-11-12 · Calibration set: two model families on identical text (#6420, Derek's decision 1)

**Who reads this.** Anyone quoting a serious-error rate, choosing a judge, or deciding whether the risk score needs more work.

**The set** (`calib-build.mjs`; key `scripts/eval/error-zoo/calibration-key-2026-11-12.jsonl`): 118 pages, one per book, text and image frozen by sha256.

| block | pages | what |
|---|---|---|
| A | 72 | Latin 24, German, French, Italian 16 each; half random, half the risk score's top decile within the language |
| B | 32 | Greek, Chinese, Arabic, Hebrew 8 each; same halves |
| C | 10 | one critical error planted in a copy of a low-risk page: number, negation, name, dropped line, a line from the next leaf |
| D | 4 | 3 wrong-page (image of n, text of n+1), 1 typed e-text page (only one was found cheaply) |

**Readers** (weekly-audit brief plus `RUBRIC-ADDENDUM.md`, sealed): Opus (`run-readers.sh`), Gemini 3.8 Flash low on the spare agy pools (`run-cli-arm.py`). Flash high was out of quota; Flash low is the model the weekly audit's Gemini reader uses, so this calibrates the instrument in use. Re-reads of 30 pages by each; Opus with the current brief (no rubric) on block A.

### Results (`calibration-report-2026-11-12.md`)

| pair, identical text | pages | κ critical | raw | rates | κ page band |
|---|---|---|---|---|---|
| Opus vs Gemini, rubric | 104 | **0.51** (sure only 0.55) | 76% | 69% / 53% | 0.46 |
| Opus re-read | 15 | 0.86 | 93% | | 0.86 |
| Gemini re-read | 30 | 0.84 | 93% | | 0.85 |
| Opus rubric vs Opus current brief | 42 | 0.67 | 83% | 62% / 45% | — |

| known answers | Opus | Gemini |
|---|---|---|
| planted page flagged critical | 9/10 | 9/10 |
| planted words named in a finding | 7/10 | 6/10 |
| wrong-page control caught | 3/3 | 3/3 |
| e-text control flagged (false alarm) | 0/1 | 0/1 |

| risk score | AUC | ceiling (one family's label predicting the other's) |
|---|---|---|
| vs Opus critical | 0.80 (104 pages, 72 critical) | 0.79 |
| vs Gemini critical | 0.77 (55 critical) | 0.75 |

Aiming works: block A random vs top decile, Opus 17/36 vs 27/36, Gemini 11/36 vs 21/36.

### What it means

- **The disagreement is about thresholds, not noise.** Each family is stable (κ ≈ 0.85 on re-reads); the two
  disagree at 0.51, Opus calling 16 points more pages critical. A rate from one family is that family's rate.
- **The rubric is not neutral.** Under it Opus calls 17 points more block-A pages critical than under the current
  brief: names, numbers and dropped lines now count as critical. Whether it raises agreement *between* families, or
  with a person, needs Derek's sitting (Gemini under the current brief was not run).
- **More modelling will not buy much yet.** The score is already as good against each reader as the other reader is.
  The next gain is in the labels: a person's judgment on block A, and the rule for what counts as critical.

### Limits

- The Opus re-read and current-brief arms are partial (15/30, 42/72): the box's Claude account reached 100% of its
  week mid-run and the pace guard refused further calls.
- One e-text control; the false-alarm line rests on one page.
- No human judgment yet. Derek's sitting (36 pages, prefilled spans) is ready: https://claude.ai/artifact/LXu4ekUd61X1NS17Rr689E.
