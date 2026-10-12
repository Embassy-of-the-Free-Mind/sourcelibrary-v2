---
stage: translation
measure: judged_vs_reference
languages: [la, grc, de, fr, it, nl, es, he, ar, arc, fa, sa, pi, lzh, bo]
scripts: [Latn, Grek, Hebr, Arab, Deva, Hani, Tibt]
canons: []
n_books: null
n_pages: 685
verdict: "A pooled hierarchical model of 19,271 judged scores predicts held-out experiments at 90% coverage 0.90 (330 cells) and the best model per language 61/66 times. It is overconfident across instrument types and for a model seen in one script family only."
status: undecided
decision: "Trust enough to extend to OCR. The planner waits until #6545 scores the preregistered prediction (#6557)"
superseded_by: null
issue: [6557, 6545, 6553]
---
## 2026-10-12 · Can the translation evidence we already hold be pooled into one estimator that predicts tests before they run? (#6557) — yes, inside the #6182 setup; not yet across instruments

PRIOR ART: `.claude/docs/quality-research-system.md` §3 (the design, PR #6550). The per-experiment scorers are
`scripts/eval/pareto-6182/score-xl.py` and `score-tib.py`; each one reports its own experiment and nothing pools
across experiments. `2026-10-07-other-languages-pareto-6182.md`, `2026-10-08-claude-subscription-arms-6182.md` and
the xlref t1–t5 entries are the source experiments. No model calls; $0.

### What was built

- **The table** (`scripts/eval/estimator/build-table.py`; counts in `manifest.json`, bulk rows on the job box).
  - Shape: one row per (experiment, page, arm, judge). 20,846 rows, 20,841 scored. 5 failed reads are kept as
    `scored=false` and never scored.
  - 1,570 lever-arm rows are kept but not fitted (thinking, context, check-and-fix, fixed OCR), because they are
    not the engine as routed. That leaves 19,271 rows in the fit: 685 pages from 488 works.
  - Sources: #6182 xl + Tengyur, the #6331 CLI 3.8 arms (xl, Tengyur 58 and 113, canon-ref), the Claude
    subscription arms (xl, Tengyur), xlref t1–t5 and #5606.
  - **Every judge is Claude:** Opus throughout, plus Sonnet on #5606 (171 scores). Every instrument judges against
    a published human reference.
- **The model** (`model.py`): Gaussian, hierarchical, fitted with NumPyro NUTS on CPU in about 8 minutes.
  - Fidelity = global mean
    + language (nested in script family)
    + model (pooled in family: Gemini Lite / Flash / Pro, Claude Haiku / Sonnet / Opus)
    + route (CLI, stored)
    + family × script family, family × language and model × language interactions (all shrunk)
    + work + page + judging round + judge model.
  - The design asks for an ordinal likelihood. Gaussian was used first because the predictions are panel means; one
    cost is that Opus cells can exceed 5 (see limits).
- **What the data can and cannot identify:**
  - **Identified:** the model, language and work effects, and the model × language effects wherever a model was
    read in that language.
  - **Identified, small:** the route (CLI +0.03 [0.00, 0.07] over the API; stored +0.02) and the round-to-round
    shift between judging rounds (τ = 0.12 [0.08, 0.17]).
  - **Sonnet judge vs Opus judge** (#5606 only): −0.04 [−0.15, +0.05].
  - **Not identified:** self-preference. No Gemini judge has ever scored a translation here. A self-preference
    term for Claude is the same thing as the Claude family effect, so its posterior is its prior. Every "Pro judge"
    number below comes from the prior N(0.15, 0.15) per family, plus a Pro-judge scale offset N(0, 0.30).

### Validation 1: leave one experiment out

Each experiment was hidden in turn, the model was refitted without it, and its cells (language × model × route,
≥ 5 pages) were predicted. The prediction includes a fresh judging-round effect and the cell's own sampling noise.
`scripts/eval/estimator/loo.py`; the summary is in `results/report-2026-10-12.json`.

| held out | pages | cells | 90% coverage | MAE | best model right | contrasts covered |
|---|---|---|---|---|---|---|
| 6182-xl | 365 | 138 | 0.96 | 0.14 | 11/14 | 0.94 (614 pairs) |
| 6331-cli38-xl | 365 | 44 | 0.98 | 0.08 | 4/14 (all 3.8 CLI vs 3.8 API, the same model) | 0.88 |
| 6182-claude-xl | 365 | 58 | 0.83 | 0.24 | 12/14 | 0.76 |
| 6182-tib | 171 | 10 | 1.00 | 0.12 | 1/1 | 0.98 |
| 6182-claude-tib | 171 | 4 | 1.00 | 0.21 | 1/1 | 0.50 |
| 6331-cli38-tib113 | 113 | 3 | 1.00 | 0.01 | 1/1 | 1.00 |
| 6331-cli38-tib58 | 58 | 3 | 1.00 | 0.11 | 1/1 | 0.33 |
| 6331-canon-ref | 138 | 8 | 0.88 | 0.11 | 3/3 | 0.71 |
| xlref-t1 (Latin) | 71 | 5 | 1.00 | 0.08 | 1/1 | 1.00 |
| xlref-t2 (Greek) | 75 | 5 | 0.80 | 0.16 | 1/1 | 0.50 |
| xlref-t3 (vernaculars) | 59 | 17 | 0.88 | 0.12 | 5/5 | 0.70 |
| xlref-t4 (Semitic, Persian) | 52 | 16 | **0.38** | 0.33 | 4/4 | 0.67 |
| xlref-t5 (Indic, Chinese) | 68 | 13 | 1.00 | 0.15 | 3/3 | 0.68 |
| #5606 A/B | 57 | 6 | 0.50 | 0.22 | 3/3 | 1.00 |
| **all** | | **330** | **0.90** (50%: 0.56) | **0.16** | 51/66 by engine, **61/66 by model** | **0.89** (913 pairs) |

- **Where it is calibrated:** inside the #6182 judging setup. It predicted a held-out round's cells at 96–98% and
  its within-language differences at 88–94%. When it named the wrong best model, the true best was on average only
  0.02 points better.
- **Failure 1: a new instrument shifts the whole level.**
  - xlref-t4 came in about 0.4 below the prediction on every Gemini arm, and #5606 about 0.3 above. Both used
    pairwise packets with a different judge prompt.
  - The round effect the model learned (τ ≈ 0.12) is the spread *between #6182-style rounds*. It is too small for
    a change of instrument.
  - Contrasts outside the big xl panel were covered about 78% of the time, not 90%.
- **Failure 2: a model seen in one script family does not transfer.**
  - Haiku had been read only on the Tengyur, where it was catastrophic. Predicted from that, it came out about 0.9
    too low in every European language (8 of the 10 misses in 6182-claude-xl).
  - A model × script-family term exists, but it learned its spread from Gemini, where models move together.
- **Fixes before the planner:**
  - one round-effect variance per instrument class;
  - treat a cell as **pooled**, not measured, unless the model was read in that script family.

### Validation 2: preregistered prediction for #6545 (posted before it ran)

The stage-1 predictions for Persian and Sanskrit are in the
[#6545 comment](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6545#issuecomment-6115425096),
pinned at commit `34051670e` (`predictions/6545-stage1.json`).
- **The headline:** in Persian, Pro with full thinking ties 3.8 Flash CLI (P = 0.45; Δ −0.02 [−0.41, +0.35]). In
  Sanskrit, Pro leans ahead (P = 0.77; Δ +0.17 [−0.19, +0.57]).
- **Correction and self-preference** cells are prior-only, and wide.
- **Scoring:** not yet scored. It gets scored when #6545 reports.

### What we know (full fit, Opus judge against the reference; cell mean for an average work)

`est [90%]` · P(best among Flash-Lite, 3 Flash, 3.8 Flash, 3.1 Pro, Sonnet) · basis: measured (≥ 20 pages in that
language), thin (5–19), pooled (< 5) · pages/works. Opus is a ceiling only, not a lane.

| lang | Flash-Lite 3.1 | 3 Flash | 3.8 Flash CLI | 3.1 Pro (thinking 128) | Sonnet 5.5 | Opus |
|---|---|---|---|---|---|---|
| Sanskrit | 3.49 [3.36, 3.64] · 0 · m 30 | 3.91 [3.77, 4.07] · 0 · m 42 | 4.27 [4.14, 4.42] · 0.23 · m 53 | **4.32** [4.15, 4.51] · **0.77** · m 30 | 4.01 [3.85, 4.17] · 0 · m 53 | 4.64 · thin 7 |
| Pali | 3.80 [3.63, 3.95] · 0 · m 30 | 4.22 · 0 · m 65/31 | 4.60 [4.42, 4.74] · 0.14 · m 70/34 | **4.68** [4.47, 4.87] · **0.85** · m 30 | 4.51 · 0.01 · m 70/34 | 5.04 · thin 6 |
| Chinese | 3.60 · 0 · m 25 | 4.09 · 0 · m 25 | **4.36** [4.23, 4.49] · **0.60** · m 100 | 4.33 [4.12, 4.53] · 0.39 · m 25 | 4.23 · 0 · m 100 | 4.99 · thin 7 |
| Tibetan | 3.96 · 0 · m 171/10 | 4.43 · 0 · m 171/10 | **4.73** [4.51, 4.94] · **1.00** · m 171/10 | 4.52 · 0 · m 171/10 | 4.35 · 0 · m 171/10 | 4.74 · m 171/10 |
| Persian | 3.15 [2.95, 3.32] · 0 · m 24 | 3.84 · 0 · m 24 | **4.13** [3.94, 4.33] · **0.94** · m 23 | 3.99 [3.76, 4.24] · 0.06 · m 23 | 3.70 · 0 · m 23 | 5.12* · thin 5 |
| Hebrew | 3.90 · 0 · m 30 | 4.26 · 0 · m 30 | **4.52** [4.35, 4.69] · **0.97** · m 29 | 4.36 · 0.03 · m 29 | 4.22 · 0 · m 29 | 5.02* · thin 7 |
| Arabic | 3.79 · 0 · m 27 | 4.07 · 0 · m 27 | **4.40** [4.24, 4.59] · **0.87** · m 24 | 4.30 · 0.12 · m 24 | 4.23 · 0.01 · m 24 | 5.03* · thin 7 |
| Aramaic | 3.18 · 0 · thin 5 | 3.53 · 0 · thin 5 | **3.79** [3.39, 4.15] · **0.64** · thin 5 | 3.72 · 0.28 · thin 5 | 3.63 · 0.09 · thin 5 | 4.45 · pooled 1 |
| Greek | 3.54 · 0 · m 75 | 3.86 · 0 · m 75 | **4.21** [4.09, 4.36] · **0.96** · m 69 | 4.10 · 0.04 · m 69 | 4.02 · 0 · m 69 | 4.33 · thin 10 |
| Latin | 4.13 · 0 · m 71 | 4.33 · 0 · m 71 | **4.63** [4.51, 4.77] · **0.96** · m 71 | 4.54 · 0.04 · m 71 | 4.47 · 0 · m 71 | 4.85 · m 20 |
| German | 4.31 · 0 · m 22 | 4.67 · 0 · m 22 | **4.88** [4.70, 5.06] · **0.75** · m 22 | 4.82 · 0.25 · m 22 | 4.67 · 0 · m 22 | 4.96 · thin 7 |
| French | 4.67 · 0 · thin 14 | 4.64 · 0 · thin 14 | **4.84** [4.63, 5.05] · **0.59** · thin 14 | 4.81 · 0.41 · thin 14 | 4.65 · 0 · thin 14 | 5.04* · thin 5 |
| Italian | 4.18 · 0 · thin 10 | 4.42 · 0 · thin 10 | **4.72** [4.43, 5.01] · **0.63** · thin 10 | 4.69 · 0.37 · thin 10 | 4.47 · 0 · thin 10 | 4.91 · pooled 4 |
| Dutch | 4.14 · 0 · thin 7 | 4.34 · 0 · thin 7 | **4.70** [4.34, 4.98] · **0.90** · thin 7 | 4.56 · 0.10 · thin 7 | 4.26 · 0 · thin 7 | 4.79 · pooled 2 |
| Spanish | 4.32 · 0 · thin 6 | 4.51 · 0 · thin 6 | **4.79** [4.43, 5.09] · **0.61** · thin 6 | 4.75 · 0.39 · thin 6 | 4.54 · 0 · thin 6 | 4.88 · pooled 2 |

\* above 5 because the likelihood is Gaussian. Read it as "at the ceiling of the scale". The ordinal likelihood
removes this.

**In plain sentences:**
- For Sanskrit, 3.8 Flash is better than Flash-Lite with more than 99% probability: +0.77 points, 90% interval
  +0.69 to +0.87, from 30 works read by both.
- For Sanskrit, 3.1 Pro is ahead of 3.8 Flash with about 77% probability, but only by +0.06 (−0.08 to +0.19). That
  is with thinking at 128. #6545 tests full thinking.
- For Persian, 3.8 Flash beats 3.1 Pro (thinking 128) with about 94% probability: +0.14 (0.00 to +0.30), from 23
  works.
- For Chinese, 3.8 Flash and 3.1 Pro are a coin flip (60 / 39). The difference is −0.04 (−0.22 to +0.13), and Pro
  was read on only 25 works.
- Sonnet is below 3.8 Flash in every language. In Sanskrit it is 0.26 below (−0.37 to −0.15), from 30 works.

### Where more data would most change a routing decision

The ranking uses the expected value of perfect information among the routable engines. The page volumes come
from `scripts/catalog-coverage/results/canon-gap-status-2026-10.json`: pages transcribed but not translated, plus
the open canon in page equivalents.

1. **Chinese: 3.8 Flash vs Pro.** P(3.8 best) = 0.60. About 1.4M classics pages are waiting, plus about 2.4M
   page-equivalents of open canon, so this is by far the largest decision. #6545 stage 2 tests it.
2. **Sanskrit: Pro vs 3.8.** P(Pro best) = 0.77, on Pro read with thinking off. About 54K pages are waiting, plus
   about 50K of open canon. #6545 stage 1 tests it.
3. **Pali: Pro vs 3.8.** P(Pro best) = 0.85. Only about 3.5K pages are waiting, but about 47K of open canon.
4. **Aramaic:** 5 pages per engine, so every cell is thin. The volume is small (it sits in the Kabbalah row).
5. **French, Italian and Spanish: 3.8 vs Pro.** P ≈ 0.6 each, but on 6 to 14 pages, and the volume is not broken
   out in canon-gap-status. The routing question there is really Flash-Lite vs 3.8, and that one is settled
   (P > 0.99).

Two more gaps are not routing cells, but every claim above depends on them:
- **Self-preference:** no Gemini judge has ever read our translations.
- **Opus:** 5 to 7 pages per language outside Latin and the Tengyur.

### Limits

- **Every judge is Claude.** The "Pro judge" numbers are priors, not estimates.
- **Gaussian, not ordinal.** It ignores the ceiling at 5, so the means near 5 are biased upward.
- **One chain.** Divergences and R-hat were not checked; the next run should use four chains.
- **Pro's thinking prior comes from Flash.** The thinking effect for Pro (+0.10 ± 0.10) is borrowed from
  xlref-t5's Flash measurement (+0.12 [−0.01, 0.25]).
- **The table holds what the scorers emitted.** canon-ref-6331 stores only the mean of its two judges.

### Verdict

**TRUST ENOUGH TO EXTEND, to OCR first.**
- **Why:** inside one instrument it predicts held-out rounds at the target coverage and picks the right model 61 of
  66 times, at an average cost of 0.02 points when it is wrong.
- **What must change first:**
  - instrument-level round variance;
  - "measured" defined per script family;
  - an ordinal likelihood.
- **The planner** waits for #6545 to score the preregistered prediction.

Artifacts:
- `scripts/eval/estimator/` (`build-table.py`, `model.py`, `loo.py`, `predict-6545.py`, `report.py`,
  `manifest.json`, `predictions/`, `results/report-2026-10-12.json`).
- The bulk table and posteriors are on the job box: `/data/scratch/sl/jobs/estimator-core-6557/`.
