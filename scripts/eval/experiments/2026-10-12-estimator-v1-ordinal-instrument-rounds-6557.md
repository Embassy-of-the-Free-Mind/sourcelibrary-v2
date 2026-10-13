---
stage: translation
measure: judged_vs_reference
languages: [la, grc, de, fr, it, nl, es, he, ar, arc, fa, sa, pi, lzh, bo]
scripts: [Latn, Grek, Hebr, Arab, Deva, Hani, Tibt]
canons: []
n_books: null
n_pages: 685
verdict: "Estimator v1 (ordinal, round spread per instrument class, four chains) covers held-out experiments at 0.92 (v0 0.90; 330 cells) and held-out packet instruments at 0.85 (v0 0.74; 62 cells). In the preregistered #6545 test it covered 9 of 12 panel means (v0 8) and 7 of 8 differences between arms; the two best-measured cells came in 0.4 below the prediction."
status: undecided
decision: "Ready for the planner on differences between arms inside one judging round. Not ready on levels across judging rounds, and not for the router (#6557)"
superseded_by: null
issue: [6557, 6545, 6553]
---
## 2026-10-12 · Estimator v1: do the four fixes named in v0 make its predictions hold across judging instruments? (#6557) — for differences between arms, yes; for levels, no: #6545 came in 0.4 below on the best-measured cells

PRIOR ART: `2026-10-12-estimator-core-translation-6557.md` (v0: the table, the Gaussian model, its leave-one-out
table and the four fixes it names). `.claude/docs/quality-research-system.md` §3 asks for the ordered-logistic
likelihood. The v0 code and results in `scripts/eval/estimator/` are untouched; v1 sits beside them. No model
calls; $0; CPU only.

### Verdict

**READY FOR THE PLANNER ON DIFFERENCES BETWEEN ARMS. NOT READY ON LEVELS ACROSS JUDGING ROUNDS, and not for the
router.**
- **Why ready on differences:** which arm is ahead, and by how much, holds up.
  - In the preregistered #6545 test the difference from 3.8 Flash was covered for 7 of 8 arms, by v0 and by v1.
  - On held-out experiments a within-language difference is covered 0.88 of the time, and the best model per
    language is right 62 times in 66.
- **Why not ready on levels:** a new judging round moves the whole level further than the model allows.
  - #6545 stage 1 scored the stored 3.8 Flash output at 3.83 in both languages. v1 predicted 4.20 and 4.27, and
    labelled both cells "measured: same pages, same output". Both are outside the 90% interval.
  - All eight Gemini-made cells came in below their predicted value, by 0.11 to 0.44.
  - Held out, xlref-t4 is still covered only 9 times in 16.
- **What the four fixes did:** held-out coverage is 0.92 of 330 cells (v0: 0.90), and 0.85 of the 62 cells on the
  packet instruments that broke v0 (v0: 0.74). No estimate passes 5. All 15 fits converged.
- **Rule 1 for the planner: plan on differences inside one judging round.** Never compare a predicted level with
  a level from another round, and never use a predicted level as a bar ("above 4.3, route it").
- **Rule 2: an untested family is unknown, not estimated.** A model read in a single script family, with no
  measured sibling in the target one, was covered 6 times in 15 and missed by 0.6 points on average (Haiku). The
  planner must treat such a cell as "test first".

### What changed from v0

The table is the same: 19,271 scored judgements, 685 pages, 488 works, rebuilt from the committed result files
and checked byte-identical against v0's `manifest.json`. The effects in the model are the same. Four things differ
(`scripts/eval/estimator/model_v1.py`).

1. **One round spread per instrument class.** v0 had one spread for every judging round. v1 has three:
   - **panel:** the #6182-style multi-arm panel, xl and Tengyur. 7 rounds.
   - **packet:** blind packets with their own judge prompt: xlref t1–t5 and #5606. 6 rounds.
   - **canon-ref:** the #6331 canon reference set. 1 round, so its spread stays close to its prior.
2. **Measured or pooled.** A cell is *measured* only if the model was read on at least 5 pages of that script
   family in the data the fit saw. Otherwise it is *pooled*. Every held-out cell and every row of the table below
   carries the label.
3. **Ordinal likelihood.** The 1–5 score is modelled as ordered categories (ordered logistic). An estimate is an
   expected score, so it cannot leave 1–5. canon-ref stores only the mean of its two judges; its likelihood is the
   exact distribution of the mean of two ordinal scores.
4. **Four chains.** 500 warm-up and 500 kept draws each, with R-hat, effective sample size and divergences
   reported for every fit.

**The learned round spread, in score points (median [90%]):**

| instrument class | rounds | spread between rounds |
|---|---|---|
| panel | 7 | 0.08 [0.04, 0.15] |
| packet | 6 | 0.14 [0.09, 0.25] |
| canon-ref | 1 | 0.10 [0.01, 0.34] |

v0's single value was 0.12 [0.08, 0.17]. Packets move about twice as much from round to round as panels do.

### Chain diagnostics

| fit | divergences (of 2,000 draws) | largest R-hat | smallest effective sample |
|---|---|---|---|
| full fit | 2 | 1.02 | 178 |
| 14 leave-one-out fits, worst case | 4 | 1.03 | 235 |
| 14 leave-one-out fits, total | 9 of 28,000 | | |

- **R-hat** is below 1.03 for every quantity in every fit, including each work and page effect.
- **The slowest-mixing quantities** are three spread parameters: family × language, model × language, and pages.
  They are small, and their effective sample is 180 to 340.
- **Run time:** each fit took 20 to 34 minutes on 4 cores. v0 took 8 minutes for one chain.

### Leave one experiment out: v0 beside v1

The cells are the same as v0's: language × model × route with at least 5 pages, 330 in all. The v1 prediction is
the simulated mean of the cell's own scores, with a fresh round of the held-out experiment's instrument class.

| held out | instrument | cells | 90% coverage v0 → v1 | MAE v0 → v1 | interval width v0 → v1 | measured cells: v1 coverage | pooled cells: v1 coverage | best model v0 → v1 | contrasts covered v0 → v1 |
|---|---|---|---|---|---|---|---|---|---|
| 6182-xl | panel | 138 | 0.96 → 0.95 | 0.14 → 0.12 | 0.70 → 0.60 | 68: 0.94 | 70: 0.96 | 11/14 → 12/14 | 0.94 → 0.94 |
| 6182-claude-xl | panel | 58 | 0.83 → 0.83 | 0.24 → 0.21 | 0.79 → 0.65 | 33: 0.97 | 25: **0.64** | 12/14 → 12/14 | 0.76 → 0.67 |
| 6331-cli38-xl | panel | 44 | 0.98 → 1.00 | 0.08 → 0.08 | 0.53 → 0.47 | 44: 1.00 | none | 4/14 → 4/14 (all 3.8 CLI vs 3.8 API, the same model) | 0.88 → 0.85 |
| 6182-tib | panel | 10 | 1.00 → 1.00 | 0.12 → 0.11 | 0.78 → 0.57 | 3: 1.00 | 7: 1.00 | 1/1 → 1/1 | 0.98 → 1.00 |
| 6182-claude-tib | panel | 4 | 1.00 → 1.00 | 0.21 → 0.20 | 0.79 → 0.56 | 2: 1.00 | 2: 1.00 | 1/1 → 1/1 | 0.50 → 0.50 |
| 6331-cli38-tib113 | panel | 3 | 1.00 → 1.00 | 0.01 → 0.03 | 0.44 → 0.28 | 3: 1.00 | none | 1/1 → 1/1 | 1.00 → 1.00 |
| 6331-cli38-tib58 | panel | 3 | 1.00 → **0.33** | 0.10 → 0.13 | 0.46 → 0.20 | 3: 0.33 | none | 1/1 → 1/1 | 0.33 → 0.33 |
| 6331-canon-ref | canon-ref | 8 | 0.88 → 1.00 | 0.11 → 0.11 | 0.65 → 0.88 | 8: 1.00 | none | 3/3 → 3/3 | 0.71 → 0.57 |
| xlref-t1 (Latin) | packet | 5 | 1.00 → 1.00 | 0.08 → 0.10 | 0.43 → 0.55 | 5: 1.00 | none | 1/1 → 1/1 | 1.00 → 1.00 |
| xlref-t2 (Greek) | packet | 5 | 0.80 → 0.80 | 0.16 → 0.20 | 0.51 → 0.68 | 5: 0.80 | none | 1/1 → 1/1 | 0.50 → 0.40 |
| xlref-t3 (vernaculars) | packet | 17 | 0.88 → 0.94 | 0.12 → 0.13 | 0.58 → 0.56 | 17: 0.94 | none | 5/5 → 5/5 | 0.70 → 0.70 |
| **xlref-t4 (Semitic, Persian)** | packet | 16 | **0.38 → 0.56** | 0.33 → 0.28 | 0.58 → 0.73 | 16: 0.56 | none | 4/4 → 4/4 | 0.67 → 0.70 |
| xlref-t5 (Indic, Chinese) | packet | 13 | 1.00 → 1.00 | 0.15 → 0.14 | 0.54 → 0.68 | 13: 1.00 | none | 3/3 → 3/3 | 0.68 → 0.82 |
| **#5606 A/B** | packet | 6 | **0.50 → 1.00** | 0.22 → 0.22 | 0.42 → 0.93 | 6: 1.00 | none | 3/3 → 3/3 | 1.00 → 1.00 |
| **all** | | **330** | **0.90 → 0.92** | **0.16 → 0.14** | 0.66 → 0.60 | 226: 0.93 (v0 0.89) | 104: 0.88 (v0 0.90) | by model 61/66 → **62/66** | 0.89 → 0.88 (913 pairs) |

**By instrument class:**

| class | cells | 90% coverage v0 → v1 | 50% coverage v1 | MAE v1 |
|---|---|---|---|---|
| panel | 260 | 0.93 → 0.93 | 0.66 | 0.13 |
| panel, measured cells only | 156 | 0.96 → 0.96 | 0.72 | 0.09 |
| packet | 62 | **0.74 → 0.85** | 0.52 | 0.18 |
| canon-ref | 8 | 0.88 → 1.00 | 0.88 | 0.11 |

**The three experiments the brief names:**
- **xlref-t4: 0.38 → 0.56 (9 of 16).** Better, not fixed.
  - The seven misses: six are Arabic and Persian Gemini arms, 0.39 to 0.58 below the prediction. The seventh is
    Persian Opus, which scored 5.0 on 5 pages against a predicted 4.47.
  - The Hebrew and Aramaic cells are all covered.
  - So the shortfall is not one shift of the whole round. It is specific to two languages. A round spread cannot
    express that, however it is split.
  - These are the same pages the #6182 xl panel judged (47 of the 52). The difference is the instrument, not the
    sample.
- **#5606: 0.50 → 1.00 (6 of 6).** Fixed, by wider intervals: 0.42 → 0.93 points. The error itself did not change
  (MAE 0.22).
- **6182-claude-xl: 0.83 → 0.83.** Unchanged in total, but the label now separates it.
  - Measured cells: 0.97 of 33.
  - Pooled cells: 0.64 of 25. Nine of the ten misses are Haiku, predicted 0.6 to 1.0 too low in every language,
    because Haiku had been read only on the Tengyur.

**What the pooled label does and does not tell you:**
- **It is not a blanket warning.** 89 of the 104 pooled cells belong to models with a measured sibling in the
  target script family (the Gemini Flash and Lite versions, Pro) or read in other script families (Sonnet, Opus). They
  are covered 86 times in 89.
- **It is decisive for a model with neither.** Haiku's pooled cells are covered 6 times in 15 (v0: 7 in 15). The
  model's interval for them is about 1.1 points wide and still wrong. No fix in this run changes that; only a
  test does. That is rule 2.

**What got worse:**
- **6331-cli38-tib58: 3 of 3 → 1 of 3.**
  - Splitting the round spread made the panel class's own spread smaller (0.08 points against v0's shared 0.12).
    Panel intervals narrowed with it: 0.46 → 0.20 points for these cells.
  - This round is the largest panel-round shift in the data: −0.10 [−0.19, −0.03] in the full fit.
  - The two misses are 0.10 and 0.23 points.
- **Contrasts did not improve.** A within-language difference between two cells is covered 0.88 of the time
  (v0: 0.89), and 0.87 when both cells are measured (318 pairs). Outside the 6182-xl holdout it is 0.76 (v0: 0.79; 299 pairs).
  The sign is right in 675 of 730 pairs where the true gap is at least 0.1.
- **The middle of the intervals is too wide.** The 50% intervals cover 0.64 of cells (v0: 0.56). For the planner
  this errs toward running a test that was not needed, not toward skipping one.

### #6545: re-pinned before it reported, then scored

- **The order of events:** the v1 prediction for stage 1 was posted on #6545 at 06:47Z, as a
  [second comment](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6545#issuecomment-6119212061),
  pinned at commit `b8eccb912` (`predictions/6545-stage1-v1.json`). #6545 posted its stage-1 result at 07:17Z.
  v0's pin is from 00:07Z.
- **The result file** is `scripts/eval/results/pro-translate-6545/r1s1/scores.json` on branch
  `job-pro-translate-6545` at `4588b44d8`. Persian 23 pages, Sanskrit 30.
- **Scoring:** `score-6545.py`; full output in `results/6545-stage1-scored.json`. ✗ = the observed panel mean is
  outside the pinned 90% interval.

**Opus judge, panel means: v0 8/12, v1 9/12.**

| language | cell | observed | v0 pin | v1 pin | v1, had the round been classed as a packet (computed after the result) |
|---|---|---|---|---|---|
| Persian | 3.8 Flash CLI (stored output) | 3.83 | 4.20 [4.02, 4.41] ✗ | 4.20 [3.98, 4.39] ✗ | 4.17 [3.83, 4.52] |
| Persian | 3.1 Pro CLI, default thinking | 3.96 | 4.18 [3.77, 4.56] | 4.17 [3.67, 4.59] | 4.17 [3.61, 4.65] |
| Persian | Opus | 4.65 | 4.68 [4.34, 5.04] | 4.83 [4.65, 4.93] | 4.83 [4.57, 4.96] |
| Persian | Stored production text | 3.70 | 3.97 [3.77, 4.16] ✗ | 3.89 [3.65, 4.11] | 3.87 [3.52, 4.22] |
| Persian | Stored, corrected by 3.8 Flash | 3.96 | 4.08 [3.64, 4.47] | 4.07 [3.61, 4.48] | 4.04 [3.57, 4.52] |
| Persian | Stored, corrected by Opus | 4.09 | 4.34 [3.88, 4.91] | 4.48 [3.83, 5.00] | 4.48 [3.78, 5.00] |
| Sanskrit | 3.8 Flash CLI (stored output) | 3.83 | 4.26 [4.08, 4.45] ✗ | 4.27 [4.05, 4.47] ✗ | 4.27 [3.93, 4.60] ✗ |
| Sanskrit | 3.1 Pro CLI, default thinking | 4.17 | 4.42 [4.04, 4.84] | 4.42 [3.98, 4.80] | 4.43 [3.87, 4.83] |
| Sanskrit | Opus | 4.77 | 4.59 [4.30, 4.85] | 4.77 [4.57, 4.90] | 4.77 [4.50, 4.93] |
| Sanskrit | Stored production text | 3.53 | 3.93 [3.73, 4.10] ✗ | 3.88 [3.67, 4.08] ✗ | 3.90 [3.53, 4.23] |
| Sanskrit | Stored, corrected by 3.8 Flash | 3.73 | 4.11 [3.65, 4.47] | 4.10 [3.63, 4.53] | 4.10 [3.57, 4.60] |
| Sanskrit | Stored, corrected by Opus | 4.13 | 4.27 [3.84, 4.82] | 4.45 [3.80, 4.97] | 4.47 [3.73, 4.97] |

- **The misses are the best-measured cells.** The stored 3.8 Flash output and the stored production text are the
  same pages and the same text that #6331 judged. This round scored them 0.2 to 0.44 lower.
- **Every Gemini-made cell is below its prediction** (0.11 to 0.44). The two Opus cells are on it (−0.18, 0.00).
  A harsher round pulls the middle of the scale down and leaves the top where it was. The ordinal model has
  that shape; what it lacks is enough spread for a new round.
- **The round was not a #6182-style panel.** It was a new blind round of seven arms with its own judge prompt and
  one Opus judge per page. The pin assumed a panel round with two Opus judges.
  - One judge instead of two changes nothing: 9/12.
  - The packet class's spread would have covered 11/12. That figure was computed
    after the result, so it explains the miss; it is not a prediction.
  - So the instrument class of a new round has to be chosen before the result, and a round with a new judge
    prompt should not be assumed to be a panel.

**Differences from 3.8 Flash CLI, Opus judge: v0 7/8, v1 7/8.**

| language | difference from 3.8 Flash CLI | observed | v0 pin | v1 pin |
|---|---|---|---|---|
| Persian | 3.1 Pro | +0.13 | -0.02 [-0.41, 0.35] | -0.02 [-0.50, 0.39] |
| Persian | Opus | +0.83 | 0.48 [0.15, 0.83] | 0.63 [0.41, 0.83] |
| Persian | corrected by 3.8 Flash | +0.13 | -0.15 [-0.52, 0.24] | -0.13 [-0.54, 0.26] |
| Persian | corrected by Opus | +0.26 | 0.15 [-0.30, 0.74] | 0.28 [-0.37, 0.80] |
| Sanskrit | 3.1 Pro | +0.33 | 0.17 [-0.19, 0.57] | 0.15 [-0.27, 0.52] |
| Sanskrit | Opus | +0.93 | 0.32 [0.06, 0.58] ✗ | 0.50 [0.28, 0.72] ✗ |
| Sanskrit | corrected by 3.8 Flash | -0.10 | -0.15 [-0.61, 0.17] | -0.17 [-0.60, 0.23] |
| Sanskrit | corrected by Opus | +0.30 | -0.01 [-0.41, 0.56] | 0.15 [-0.47, 0.70] |

- **The order of the arms:** observed Opus, then Pro, then 3.8 Flash, then the stored text, in both languages.
  The pins had that order in Sanskrit. In Persian they had 3.8 Flash and Pro level (4.20, 4.17).
- **Pro vs 3.8 Flash:** predicted a tie in Persian and a lean to Pro in Sanskrit (P = 0.75). Observed +0.13 and
  +0.33. #6545 then found that 3.8 Flash re-run with Pro's prompt closes the gap, which no pin covered.
- **The one miss:** Opus over 3.8 Flash in Sanskrit, +0.93 against a predicted +0.50 [0.28, 0.72]. The gap is
  wider because 3.8 Flash fell and Opus did not.

**Pro judge (prior only; no Gemini judge was in the data): v0 7/12, v1 6/12.**
- The Pro judge scored 11 of the 12 cells lower than predicted, by 0.1 to 0.9. The prior assumed it would score
  Gemini arms slightly higher than the Opus judge does. It scored them up to 0.5 lower, except its own model's
  Sanskrit arm (+0.30).
- **Self-preference**, as pinned: (Opus − 3.8 under the Opus judge) minus (the same under the Pro judge) was
  +0.17 in Persian and +0.03 in Sanskrit. Both pins said about +0.32 [−0.15, +0.75]. Covered, and smaller than
  the prior.
- These scores are now the first Gemini-judge data. They are not in this fit.

### What we know (full fit, Opus judge, panel instrument; expected score for an average work)

`est [90%]` · P(best among Flash-Lite, 3 Flash, 3.8 Flash, 3.1 Pro, Sonnet) · basis and pages in that language.
Basis: m = measured (≥ 20 pages), thin (5–19), pooled (< 5, or the script family unread). Bold is the leader.

| lang | Flash-Lite 3.1 | 3 Flash | 3.8 Flash CLI | 3.1 Pro (thinking 128) | Sonnet 5.5 | Opus, ceiling only (v0 → v1) |
|---|---|---|---|---|---|---|
| Sanskrit | 3.47 [3.30, 3.63] · 0.00 · m 30 | 3.88 [3.73, 4.03] · 0.00 · m 42 | 4.28 [4.14, 4.41] · 0.40 · m 53 | **4.30 [4.12, 4.46] · 0.60 · m 30** | 4.00 [3.84, 4.16] · 0.00 · m 53 | 4.64 → 4.74 [4.58, 4.87] · thin 7 |
| Pali | 3.80 [3.62, 3.98] · 0.00 · m 30 | 4.19 [4.03, 4.34] · 0.00 · m 65 | 4.57 [4.44, 4.68] · 0.18 · m 70 | **4.62 [4.48, 4.75] · 0.81 · m 30** | 4.49 [4.35, 4.62] · 0.01 · m 70 | 5.04 → 4.91 [4.83, 4.96] · thin 6 |
| Chinese | 3.55 [3.39, 3.72] · 0.00 · m 25 | 4.04 [3.90, 4.17] · 0.00 · m 25 | **4.35 [4.23, 4.46] · 0.66 · m 100** | 4.31 [4.11, 4.48] · 0.34 · m 25 | 4.23 [4.10, 4.35] · 0.00 · m 100 | 4.99 → 4.80 [4.69, 4.89] · thin 7 |
| Tibetan | 3.95 [3.69, 4.20] · 0.00 · m 171 | 4.39 [4.19, 4.59] · 0.00 · m 171 | **4.68 [4.53, 4.81] · 1.00 · m 171** | 4.47 [4.26, 4.66] · 0.00 · m 171 | 4.29 [4.07, 4.51] · 0.00 · m 171 | 4.74 → 4.73 [4.59, 4.85] · m 171 |
| Persian | 3.19 [2.97, 3.41] · 0.00 · m 24 | 3.85 [3.65, 4.04] · 0.00 · m 24 | **4.20 [4.02, 4.38] · 0.96 · m 23** | 4.03 [3.79, 4.26] · 0.04 · m 23 | 3.72 [3.49, 3.96] · 0.00 · m 23 | 5.12 → 4.82 [4.69, 4.92] · thin 5 |
| Hebrew | 3.89 [3.71, 4.09] · 0.00 · m 30 | 4.28 [4.12, 4.43] · 0.00 · m 30 | **4.58 [4.45, 4.70] · 0.97 · m 29** | 4.42 [4.23, 4.60] · 0.03 · m 29 | 4.25 [4.06, 4.43] · 0.00 · m 29 | 5.02 → 4.86 [4.77, 4.93] · thin 7 |
| Arabic | 3.84 [3.64, 4.04] · 0.00 · m 27 | 4.12 [3.95, 4.30] · 0.00 · m 27 | **4.49 [4.33, 4.63] · 0.92 · m 24** | 4.37 [4.17, 4.55] · 0.08 · m 24 | 4.29 [4.09, 4.47] · 0.00 · m 24 | 5.03 → 4.87 [4.78, 4.94] · thin 7 |
| Aramaic | 3.20 [2.76, 3.63] · 0.00 · thin 5 | 3.53 [3.10, 3.94] · 0.00 · thin 5 | **3.89 [3.48, 4.27] · 0.68 · thin 5** | 3.81 [3.34, 4.25] · 0.29 · thin 5 | 3.68 [3.21, 4.10] · 0.03 · thin 5 | 4.45 → 4.54 [4.20, 4.81] · pooled 1 |
| Greek | 3.55 [3.42, 3.69] · 0.00 · m 75 | 3.88 [3.76, 4.00] · 0.00 · m 75 | **4.27 [4.16, 4.38] · 0.99 · m 69** | 4.14 [4.00, 4.27] · 0.01 · m 69 | 4.08 [3.94, 4.21] · 0.00 · m 69 | 4.33 → 4.51 [4.32, 4.67] · thin 10 |
| Latin | 4.13 [4.01, 4.25] · 0.00 · m 71 | 4.32 [4.21, 4.44] · 0.00 · m 71 | **4.63 [4.54, 4.71] · 0.98 · m 71** | 4.53 [4.41, 4.64] · 0.02 · m 71 | 4.47 [4.35, 4.58] · 0.00 · m 71 | 4.85 → 4.83 [4.74, 4.90] · m 20 |
| German | 4.29 [4.11, 4.46] · 0.00 · m 22 | 4.62 [4.48, 4.74] · 0.00 · m 22 | **4.81 [4.72, 4.89] · 0.65 · m 22** | 4.79 [4.65, 4.90] · 0.35 · m 22 | 4.64 [4.48, 4.78] · 0.00 · m 22 | 4.96 → 4.96 [4.90, 4.99] · thin 7 |
| French | 4.62 [4.46, 4.77] · 0.00 · thin 14 | 4.63 [4.47, 4.78] · 0.00 · thin 14 | **4.82 [4.71, 4.91] · 0.56 · thin 14** | 4.81 [4.66, 4.92] · 0.44 · thin 14 | 4.67 [4.50, 4.81] · 0.00 · thin 14 | 5.04 → 4.97 [4.93, 4.99] · thin 5 |
| Italian | 4.18 [3.91, 4.44] · 0.00 · thin 10 | 4.45 [4.20, 4.67] · 0.00 · thin 10 | **4.71 [4.53, 4.85] · 0.60 · thin 10** | 4.69 [4.47, 4.86] · 0.40 · thin 10 | 4.48 [4.21, 4.70] · 0.00 · thin 10 | 4.91 → 4.92 [4.82, 4.98] · pooled 4 |
| Dutch | 4.11 [3.78, 4.40] · 0.00 · thin 7 | 4.31 [4.01, 4.57] · 0.00 · thin 7 | **4.64 [4.40, 4.82] · 0.79 · thin 7** | 4.56 [4.27, 4.79] · 0.21 · thin 7 | 4.27 [3.93, 4.55] · 0.00 · thin 7 | 4.79 → 4.89 [4.74, 4.97] · pooled 2 |
| Spanish | 4.35 [4.07, 4.60] · 0.00 · thin 6 | 4.54 [4.28, 4.74] · 0.00 · thin 6 | **4.76 [4.58, 4.89] · 0.50 · thin 6** | 4.76 [4.55, 4.91] · 0.50 · thin 6 | 4.57 [4.29, 4.78] · 0.00 · thin 6 | 4.88 → 4.94 [4.86, 4.99] · pooled 2 |

**What moved from v0:**
- **No leader changed** in any of the 15 languages.
- **Nothing is above 5.** v0's largest estimate was 5.12 (Opus, Persian), with an upper bound of 5.40. v1's
  largest is 4.97, and its largest upper bound is 4.99.
- **Sanskrit, Pro vs 3.8 Flash, is closer to a coin flip.** P(Pro ahead) is 0.60 (v0: 0.77); the difference is
  +0.02 [−0.11, +0.14]. #6545 stage 1 tests it with full thinking.
- **Persian:** 3.8 Flash is ahead of Pro (thinking 128) with probability 0.96: 0.17 points [0.01, 0.34], from 23
  works.
- **Chinese** is still open: P(3.8 Flash ahead of Pro) is 0.66 (v0: 0.60).
- **Opus cells read on 5 to 7 pages** have intervals 0.1 to 0.3 points wide. Near the top of the scale the
  ordinal model has little room to spread. Read them as "near the ceiling", not as a measurement to ±0.1.

### Limits

- **Every judge in the fit is still Claude.** Self-preference is a prior. #6545's Pro-judge scores are the first
  data that can change that; they are not fitted here.
- **The pinned test is one round in two languages.** Its 12 cells share one round shift, so 9 of 12 is one
  round's worth of evidence about levels, not twelve.
- **The instrument classes were assigned by hand** from the experiment write-ups, three classes for 14 rounds.
  canon-ref has one round, so its spread is mostly prior.
- **An instrument can shift single languages, and the model has no term for it.** That is the residual in
  xlref-t4. A round × language spread per instrument class is the next change to test. It was not added here:
  it would have been chosen after seeing the held-out misses. #6545 stage 2 (Chinese, Greek, Hebrew) is the next
  clean test, and it needs a pin with the instrument class chosen first.
- **Leave-one-out cells are not independent.** The 62 packet cells come from six experiments, so 0.85 is six
  experiments' worth of evidence: four at 0.94 or above, one at 0.80, one at 0.56.
- **The label is by script family, with a 5-page floor.** Persian is its own script family here, so "Opus is
  measured in Persian" rests on 5 pages. The table marks it thin.
- **A simulation that recovers known effects** (design §3) has still not been run.

Artifacts:
- `scripts/eval/estimator/`: `model_v1.py`, `loo_v1.py`, `report_v1.py`, `predict-6545-v1.py`,
  `score-6545.py`, `predictions/6545-stage1-v1.json`, `results/6545-stage1-scored.json`,
  `results/report-v1-2026-10-12.json` (every held-out miss, every pooled cell, the per-fit diagnostics and the
  round × language residuals).
- v0's files in the same directory are unchanged.
- The bulk table, the posterior and the 14 leave-one-out files are on cloudlayer:
  `/data/scratch/sl/jobs/estimator-v1-6557/`. The table rebuilds from `build-table.py`.
- To rerun: a Python venv with `numpyro`, `jax` and `pandas`; `loo_v1.py --holdout <experiment|none>`, then
  `report_v1.py`.
