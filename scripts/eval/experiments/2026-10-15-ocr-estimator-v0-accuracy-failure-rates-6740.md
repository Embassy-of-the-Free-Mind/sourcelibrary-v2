---
stage: ocr
measure: [accuracy, judged]
languages: [la, en, de, fr, grc, lzh, hy, he, syc, bo, nah]
scripts: [Latn, Grek, Hani, Armn, Hebr, Syrc, Tibt]
canons: []
n_books: 713
n_pages: 1032
verdict: "OCR estimator v0 fits the Pareto charts' 11,212 scored page × engine reads (1,032 pages, 713 works, 36 engines, 10 script charts) without divergences. Engine differences inside a chart hold (sign right in 732 of 768 in-sample pairs), but levels run 0.064 CER high, because 6.6% of reads score exactly 100% error and a beta-binomial cannot fit that point mass. Flash-Lite is behind Gemini 3 Flash on Latin print by 7 points [5, 10]. The failure-rate model makes three points: reading again from the image is what fails (Tibetan 58–88% of pages not of the leaf); correcting a specialist draft rarely makes it worse (Opus 1–6%, Flash low under 1% on Tibetan); and both write lanes make 0.4% of pages worse [0.0, 2.0] once each judge is read through its controls."
status: informational
decision: "Ready for the planner on within-chart differences; not on levels (a hurdle term for 100%-error reads is the next change) (#6740)"
superseded_by: null
issue: [6740, 6553, 6688]
---
## 2026-10-15 · OCR estimator v0: what does pooling the Pareto charts say about each reader, and how often does each route fail readers? (#6740)

PRIOR ART: `src/data/ocr-pareto.json` / `scripts/eval/build-ocr-pareto.mjs` (per-chart means with by-work intervals, no
pooling across charts or engines; its `--dump-rows` page rows are the input here, re-scored by nothing);
`2026-10-12-estimator-v1-ordinal-instrument-rounds-6557.md` (the translation estimator; the measured/pooled rule and
"untested family = test first" carry over); `scripts/lib/ocr-routing-table.json` (#6688, PR #6695: the routing
decisions this informs, not rebuilt). No model calls; $0; CPU only.

### What was built

Two models, both in `scripts/eval/estimator/ocr/`:

- **Accuracy** (`model_ocr_v0.py`): a hierarchical beta-binomial on characters wrong out of characters, for each
  page × engine row of the charts.
  - Effects: engine nested in engine family; script chart; engine × chart and family × chart (shrunk);
    manuscript vs print; period; panel, i.e. the reference set, as a round effect; work; page.
  - A failed read is counted and not scored (#6523): 170 rows.
  - A cell is *measured* when the engine read at least 5 pages of the chart. It is *pooled* when only a sibling in its
    family did, and *untested* when neither did.
- **Failure rates** (`failures_v0.py`): a hierarchical binomial per (rate, route, script), for three rates.
  - The rates are text not of the leaf, failed reads, and pages made worse.
  - Inputs: 78 committed k-of-n counts (`failure-observations.jsonl`, each with its file and quote) plus the charts'
    own failed reads.
  - **Book-clustered:** a count over n pages from b books enters as b trials. This assumes every page of a book shares
    one outcome, the conservative extreme.
  - **Judges as instruments:** a judge's report is modelled as its catch rate × the true rate plus its false-positive
    rate × the rest. Both rates are fitted from planted or known-answer controls.
  - A mechanical score against a reference, or a check by eye, counts as exact.

### Accuracy: the fit

- **Data:** 11,212 scored rows; 1,032 pages; 713 works; 36 engines in 8 families; 10 charts.
- **Sampling:** 3 chains × 500 draws, 0 divergences, R-hat ≤ 1.006, smallest effective sample 348. Run time 5.9 h on
  3 cores.
- **Posterior predictive check (in sample):**
  - **Levels are biased.** The fitted mean CER per cell exceeds the observed mean by 0.064 (median; 10th–90th
    percentile 0.012 to 0.121).
    - The cause is a point mass: 6.6% of scored reads are exactly 100% error. They are mostly unplaced reads (text
      that could not be aligned to the reference). Syriac manuscripts have 32% such rows, Armenian 30%, Hebrew 29%.
    - A beta with one dispersion (φ = 4.2) cannot fit that point mass and many near-zero pages at once.
  - **Differences mostly hold.** Within a chart, the fitted difference between two engines on their shared pages is
    off by a median 0.027 CER (90th percentile 0.12). The sign is right in 732 of 768 pairs where the observed gap is
    at least 0.01.
  - **So:** use the model for which engine is ahead within a chart, never for an absolute accuracy. The next change is
    a hurdle: P(100% error) as its own Bernoulli, with the beta-binomial on the rest.

**Per chart: the engine in use against the leader.** Accuracy is 1 − E[CER] for an average page and work of the chart,
weighted by the chart's own period mix (biased low, see above). The last column is the leader minus the engine in use,
on the same posterior draws, with its 90% interval. `results/ocr-v0.json` has every engine.

| chart | in use | its accuracy [90%] | P(in use is best) | leader | leader's accuracy | P(leader best) | leader − in use | measured engines |
|---|---|---|---|---|---|---|---|---|
| Latin print | Flash-Lite 3.1 | 0.770 [0.717, 0.809] | 0.00 | Gemini 3 Flash | 0.842 [0.801, 0.871] | 0.81 | **+0.072 [+0.046, +0.100]** | 16 |
| German, French etc. | Flash-Lite 3.1 | 0.944 [0.916, 0.964] | 0.05 | Gemini 3 Flash | 0.963 [0.943, 0.976] | 0.89 | +0.019 [−0.001, +0.042] | 17 |
| Early English print | Flash-Lite 3.1 | 0.820 [0.741, 0.870] | 0.02 | Chandra OCR 2 | 0.838 [0.768, 0.885] | 0.16 (6 engines at 0.11–0.16) | +0.020 [−0.026, +0.061] | 13 |
| Greek | Gemini 3 Flash | 0.847 [0.809, 0.876] | **0.94** | (in use) | | | | 18 |
| Chinese manuscript | PaddleOCR-VL | 0.735 [0.683, 0.780] | 0.21 | Gemini 4 Argon low (CLI) | 0.739 [0.683, 0.786] | 0.36 (Opus 0.24) | +0.003 [−0.022, +0.030] | 17 |
| Chinese print | Flash-Lite 3.1 | 0.699 [0.591, 0.788] | 0.02 | Chandra OCR 2 | 0.735 [0.625, 0.832] | 0.17 (5 engines at 0.13–0.17) | +0.037 [−0.060, +0.136] | 13 |
| Syriac manuscript | Flash-Lite 3.1 (chart default) | 0.130 [0.045, 0.301] | 0.00 | Sophro | 0.733 [0.501, 0.887] | 1.00 | +0.59 | 14 (2 manuscripts) |
| Syriac print | OmniSyr (Kraken) | 0.796 [0.697, 0.887] | 0.39 | (in use) | | | | 11 |
| Armenian | Flash-Lite 3.1 | 0.881 [0.763, 0.951] | 0.77 | (in use) | | | | 11 (3 works) |
| Hebrew | none chosen | | | Opus | 0.809 [0.683, 0.898] | 0.98 of 5 measured | | 5 |

- **Latin print is the one decision the charts plainly disagree with.**
  - Flash-Lite is the reader for new Latin pages. Gemini 3 Flash is ahead by 7 points [5, 10], with P = 0.81 of being
    the best of 16 measured engines, and P = 0.00 that Flash-Lite is best.
  - **Caveat:** 79 of the 170 Latin pages are #5126 pages whose reference was located with our own stored reading
    (graded `not_fit` on the chart). A panel effect shifts every engine on such a panel equally; it does not remove a
    lean toward the engine whose reading anchored the reference. The independent Wikisource panel alone is what should
    settle this. The planner's brief for it uses only that panel.
- **Greek is settled** (P(3 Flash best) = 0.94).
- **Chinese manuscript is a three-way tie.** PaddleOCR-VL, Gemini 4 Argon low and Opus are within 0.004 of each other.
- **Early English and Chinese print are flat.** In each, ten or more engines lie within 0.03 of the leader. The posterior cannot choose among
  them, and #6304 found the Chinese print references do not fit.
- **Other effects:**
  - The panel effect is small: τ = 0.25 logit [0.10, 0.51].
  - Period matters: 1800–1899 is −0.65 logit (more errors) against 1500–1599 at +0.71 (fewer).
  - Manuscript vs print is not separable from the chart. Every manuscript chart is all manuscript.

### Failure rates

**Judges as instruments** (posterior median [90%]):

| judge | catch rate | false-positive rate | controls behind them |
|---|---|---|---|
| Opus | 0.95 [0.92, 0.97] | 0.005 [0.001, 0.014] | 52/56 and 57/60 Tibetan known-answer, 41/41 Chinese look-alike, 3/3 planted (#6203); 0/40 false flags on agreeing controls (#6694) |
| Gemini 3.8 Flash high | 0.93 [0.87, 0.97] | **0.043** [0.026, 0.064] | 53/57, 5/5, 3/3; 0/40 and 1/15 false flags |
| Gemini 3.1 Pro | 0.83 [0.73, 0.90] | 0.07 [0.01, 0.26] (prior; no FP control) | 47/56 Tibetan known-answer |

**Rates by route** (posterior median [90%]; book-clustered effective n; the raw counts are given per judge):

| rate | route | script | rate [90%] | raw | effective n |
|---|---|---|---|---|---|
| not of the leaf | Gemini 3.1 Pro reads from the image instead of the specialist | Tibetan | 88% [76, 95] | 27/30 (mechanical) | 30 |
| not of the leaf | Opus reads from the image instead of the specialist | Tibetan | 58% [43, 72] | 18/30 | 30 |
| not of the leaf | Opus reads from the image instead of the specialist | Chinese tables | 21% [13, 29] | 23/100 (Gemini judge) | 100 |
| not of the leaf | Haiku corrects a specialist draft | Chinese | 20% [14, 27] | 20/99 | 99 |
| not of the leaf | served text, all lanes, one random page per book (#6691) | mixed | **5.4% [3.1, 8.7]** | 10/184 by eye | 184 |
| not of the leaf | served text, most-read non-English books, pages contained by the adjudicator or corrector (#6420, #6694) | mixed | 1.5% [0.4, 2.6] | 144/7,682 pages | 771 books |
| failed read | Gemini 3.8 Flash low CLI, lane B, after one retry | mixed | 1.7% [0.4, 4.5] | 23/976 | 99 |
| failed read | Opus correcting in place | mixed | 0.1% [0.0, 1.0] | 0/976 | 99 |
| failed read | DeepSeek-OCR (benchmark) | Greek | 33% [26, 40] | 47/136 | 122 |
| failed read | Gemini 3.7 / 3.8 Flash CLI (benchmark) | German, French etc. | 26–29% | 7–8/23 | 23 |
| failed read | Gemini 3.8 Flash CLI (benchmark) | Chinese manuscript | 7.3% [5.0, 10.3] | 38/498 | 261 |
| made worse | Gemini 3.1 Pro reads from the image instead of the specialist | Tibetan | 95% [85, 99] | 29/30 | 30 |
| made worse | Opus reads from the image instead of the specialist | Tibetan / Chinese | 88% / 44% | 27/30; 43/99 | |
| made worse | Haiku / Gemini 3.1 Pro / Sonnet correct a specialist draft | Chinese | 45% / 39% / 24% | 45/99; 39/99; 25/99 | 99 |
| made worse | Gemini 3.8 Flash high / Opus correct a specialist draft | Chinese | 7.7% / 5.6% | 8/99; 6/99 | 99 |
| made worse | Opus / Sonnet / Gemini 3.8 Flash low correct a specialist draft | Tibetan | 1.1% / 1.5% / 0.7% | 0/30 each | 30 |
| made worse | lane B write: Gemini CLI read, Opus adjudication (gate, main200a/b, q300 arm A) | mixed | **0.4% [0.0, 2.0]** | Opus 1/164; Gemini 8/164 | 164 |
| made worse | Opus corrects stored text in place (q300 arm B audit and blind judge) | mixed | **0.4% [0.0, 2.0]** | Opus 1/236; Gemini 12/236; by eye 0/5 | 138 |
| made worse | lane A, Tengyur CLI re-read and re-translation | Tibetan | 4.8% [1.2, 12.4] | 2/40, both readers | 40 |

- **The Gemini judge's "worse" calls are mostly its false-positive rate.** Gemini 3.8 high calls 4.9% of lane-B writes
  and 5.1% of Opus-correct writes worse. Its own controls put its false-positive rate at 4.3%, and Opus (0.5% false
  positives, 95% catch) finds 0.4–0.6%.
  - Read through both instruments, the two write lanes are indistinguishable, at about 0.4%.
  - The #6694 rule ("conjunctive: each judge separately") stopped arm B on Gemini's 3/40. That rule is stricter than
    this model, on purpose; the model does not replace it.
- **Reading again from the image fails readers; correcting a draft mostly does not.**
  - On Tibetan and Chinese tables, a general model reading from nothing writes text not on the leaf on a fifth to
    nine-tenths of pages.
  - Correcting the specialist's draft makes pages worse under 2% of the time on Tibetan (Opus, Sonnet, Flash low) and
    under 8% on Chinese (Opus, Flash high).
  - The exceptions are the weaker correctors: Haiku makes 45% of Chinese pages worse and 20% get text not of the leaf;
    Gemini 3.1 Pro 39% worse; Sonnet 24% worse.
- **Served text:** 5.4% [3.1, 8.7] of random served pages carry a passage or more not of the leaf (#6691, confirmed by
  eye). On the most-read non-English books, 1.5% of pages were contained, and those come in clumps (one Vitruvius
  volume, Hebrew in q1000).

### Limits

- **The accuracy levels are biased (above).** A hurdle for 100%-error reads is the fix. It was not done here: one more
  fit is about 6 h on this box's CPU budget.
- **Every panel of a chart is in the fit, including those the chart grades `not_fit`.** An engine that anchored a
  panel's reference may be favoured there.
- **The engine × chart effect is not tested out of sample.** The planned holdout of Gemini 4 Argon was dropped for CPU,
  so no "predict before it reports" check exists for OCR yet.
- **Book clustering is the conservative extreme.** A write audit whose books were not recorded (lane B gate, main200,
  q300 audit) enters as independent pages; the table marks these. They are the rows most likely to be too narrow.
- **One page per book holds in the charts' primary panels and in #6691. It does not hold in the batch lanes** (q300 and
  later are 10 pages a book). There the effective n is the book count.
- **Missing, so not counted:** the weekly lane-D audits post on #6420 as comments with no committed counts file.
  #6691's per-stratum `not_this_leaf` calls were left out, because they overcount about 3×.
- **Not used for rates:** controls where a corrector, not a judge, was planted against (planted errors left in a draft),
  and counts in edits rather than pages.

Artifacts: `scripts/eval/estimator/ocr/` — `build-ocr-table.py`, `model_ocr_v0.py`, `fit_ocr_v0.py`, `report_ocr_v0.py`,
`failures_v0.py`, `failure-observations.jsonl`, `manifest.json`, `results/ocr-v0.json` (every chart × engine, the PPC,
hyperparameters), `results/failures-v0.json` (every cell with its observations and file references). The fitted
posterior, the draws and the page table are on cloudlayer: `/data/scratch/sl/jobs/qloop-6740/`. To rebuild:
`node scripts/eval/build-ocr-pareto.mjs --dump-rows=R`, then `build-ocr-table.py`, then `fit_ocr_v0.py` in a venv
with numpyro, jax and pandas.
