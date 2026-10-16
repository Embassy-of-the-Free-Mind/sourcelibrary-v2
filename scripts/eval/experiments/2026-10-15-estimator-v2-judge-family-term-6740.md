---
stage: translation
measure: judged_vs_reference
languages: [la, grc, de, fr, it, nl, es, he, ar, arc, fa, sa, pi, lzh, bo, nah]
scripts: [Latn, Grek, Hebr, Arab, Deva, Hani, Tibt]
canons: []
n_books: null
n_pages: 715
verdict: "Estimator v2 adds the first non-Claude judges (Gemini 3.1 Pro and 3.8 Flash High, from #6545, #6559 and #6690) and a judge-family term. Held out, it covers 0.92 of 305 cells on the v1 experiments (v1: 0.92 of 330) and 0.89 of 98 cells on the new ones. xlref-t4 rises from 9 of 16 to 12 of 16, but because of #6545's new Persian data, not the judge term: xlref-t4 had only Opus judges, and with the round × arm-maker term removed it is still 12 of 16. The misses that remain are language-specific (Arabic and Persian in xlref-t4; Hebrew in #6545 stage 2). No Claude self-preference shows: the Gemini 3.1 Pro judge puts Opus further ahead of 3.8 Flash than the Opus judge does."
status: informational
decision: "The planner (#6740 part 3) reads v2 for differences inside one judging round, as v1 allowed; levels across rounds and the router stay out (#6740)"
superseded_by: null
issue: [6740, 6557, 6553]
---
## 2026-10-15 · Estimator v2: does a judge-family term, and the evidence scored since 12 October, fix v1's misses? (#6740)

PRIOR ART: `2026-10-12-estimator-v1-ordinal-instrument-rounds-6557.md` (v1: ordinal likelihood, round spread per
instrument class; xlref-t4 covered 9 of 16; it names a round × language term and does not add it). The v0 and v1
code and results in `scripts/eval/estimator/` are untouched; v2 sits beside them (`build-table-v2.py`,
`model_v2.py`, `loo_v2.py`, `report_v2.py`). No model calls; $0; CPU only.

### What went in

| experiment | judges | form | arms fitted |
|---|---|---|---|
| v1's 14 experiments (19,271 scores) | Opus, Sonnet | page-level, byte-identical to v1 | unchanged |
| **#6545** r1s1, r1s2, r2s1 (Persian, Sanskrit; Chinese, Greek, Hebrew) | Opus, **Gemini 3.1 Pro**, Fable (subsample) | **cell means**: 96 (language × arm × judge) means with by-work intervals, about 2,000 scores | stored 3 Flash, 3.8 Flash CLI (stored C38 and the fresh C38S, C38S2), 3.1 Pro high CLI, Opus |
| **#6559** Nahuatl | **Gemini 3.8 Flash High**, both A/B orders | page-level, 120 scores | Opus, 3.8 Flash low CLI |
| **#6690** O1 (PR #6700 at `a6cafd0b`) | Gemini 3.8 Flash High | cell means, 5 languages | Opus at 1 page per call |

- **Cell means.** #6545 and #6690 committed only their panel means; the per-item verdicts are not in the repo. A mean
  enters as a Normal observation of the average over its own pages of E[score]. A page the fit holds brings its own
  page and work effect; an unseen page is integrated over the spread.
  - The standard error is the by-work interval's half-width divided by 1.96, floored at 0.6/√n, because a
    [5.0, 5.0] interval is not certainty.
- **Not added:**
  - #6667 is OCR correction (it went to the OCR estimator, #6770).
  - #6361 is serious-error counts, not the 1–5 scale.
  - #6729 had not landed.
  - #6690's O10 and #6545's correction arms are levers, not engines as routed.
- **Instrument class, fixed by rule before any holdout:** only the #6182 harness is a panel. Every round with its own
  prompt is a packet: #6545's three rounds, #6559 and #6690.

**The new terms** (logit scale; one score point is about 5.3 logits at a typical cell):
- a judge offset per judge model;
- **Gemini judge × arm model family**, N(0, τ_jf);
- **Gemini judge × arm maker × language**, N(0, τ_jfl);
- **round × Gemini-made arm**, one spread per instrument class. It can be switched off, for the ablation.

Only differences between judge families are identified; Claude judges are the reference.

### Leave one experiment out, v1 → v2

3 chains × 400 kept draws per fit. 17 fits: 6 divergences in all, largest R-hat 1.04, smallest effective sample 91.
Each fit took 35–80 min on 3 cores.

| held out | class | cells | 90% coverage v1 → v2 | MAE v1 → v2 | width v1 → v2 | measured: v2 | pooled: v2 | best model v1 → v2 | contrasts v1 → v2 | v2 without round×maker |
|---|---|---|---|---|---|---|---|---|---|---|
| 6182-xl | panel | 138 | 0.95 → 0.95 | 0.12 → 0.13 | 0.60 → 0.62 | 68: 0.94 | 70: 0.96 | 12/14 → 13/14 | 0.94 → 0.95 | |
| 6182-claude-xl | panel | 58 | 0.83 → 0.83 | 0.21 → 0.22 | 0.65 → 0.66 | 33: 0.97 | 25: 0.64 | 12/14 → 12/14 | 0.67 → 0.67 | |
| 6331-cli38-xl | panel | 44 | 1.00 → 1.00 | 0.08 → 0.08 | 0.47 → 0.52 | 44: 1.00 | | 4/14 → 4/14 | 0.85 → 0.83 | |
| 6331-cli38-tib58 | panel | 3 | 0.33 → 0.67 | 0.13 → 0.12 | 0.20 → 0.25 | 3: 0.67 | | 1/1 → 1/1 | 0.33 → 0.33 | |
| xlref-t1 | packet | 5 | 1.00 → 1.00 | 0.10 → 0.07 | 0.55 → 0.64 | 5: 1.00 | | 1/1 → 1/1 | 1.00 → 1.00 | |
| xlref-t2 | packet | 5 | 0.80 → 0.80 | 0.20 → 0.19 | 0.68 → 0.71 | 5: 0.80 | | 1/1 → 1/1 | 0.40 → 0.50 | |
| xlref-t3 | packet | 17 | 0.94 → 1.00 | 0.13 → 0.13 | 0.56 → 0.64 | 17: 1.00 | | 5/5 → 5/5 | 0.70 → 0.70 | |
| **xlref-t4** | packet | 16 | **0.56 → 0.75** | 0.28 → 0.26 | 0.73 → 0.81 | 16: 0.75 | | 4/4 → 4/4 | 0.70 → 0.70 | **0.75** |
| xlref-t5 | packet | 13 | 1.00 → 1.00 | 0.14 → 0.15 | 0.68 → 0.77 | 13: 1.00 | | 3/3 → 3/3 | 0.82 → 0.77 | |
| 5606-ab | packet | 6 | 1.00 → 1.00 | 0.22 → 0.24 | 0.93 → 1.00 | 6: 1.00 | | 3/3 → 3/3 | 1.00 → 1.00 | |
| #6545 r1s1 | packet, cell means | 30 | — → 0.90 | 0.23 | 0.86 | 24: 0.88 | 6: 1.00 | 6/6 | 0.91 | 0.90 |
| #6545 r1s2 | packet, cell means | 45 | — → 0.87 | 0.19 | 0.74 | 45: 0.87 | | 9/9 | 0.84 | |
| #6545 r2s1 | packet, cell means | 16 | — → 0.94 | 0.20 | 0.80 | 16: 0.94 | | 4/4 | 0.80 | |
| #6690 O1 | packet, cell means | 5 | — → 1.00 | 0.28 | **1.24** | 5: 1.00 | | | | |
| #6559 Nahuatl | packet | 2 | — → 0.50 | 0.73 | 1.36 | | 2: 0.50 | **0/1** | 1.00 | |
| **v1 experiments** | | 305 | **0.92 → 0.92** (v1 on its 330) | 0.14 → 0.15 | 0.60 → 0.64 | | | | | |
| **new experiments** | | 98 | 0.89 | 0.22 | 0.82 | | | | | |
| **all** | | 403 | 0.92 | 0.17 | 0.68 | 300: 0.93 | 103: 0.87 | 66/80 | 0.89 (990 pairs) | |

- **Not re-run:** 6182-tib, 6182-claude-tib, 6331-canon-ref and 6331-cli38-tib113. Four fits were dropped to keep
  within the job's 6-core cap. None of those languages gained data, and none has a non-Claude judge, so v1's coverage
  (1.00, 1.00, 1.00, 1.00) stands for them.
- **By judge family:** Claude-judged cells are covered 0.92 (363 cells); Gemini-judged cells 0.85 (40).
- **By arm maker:** Claude-made cells are covered 0.81 (73 cells), Gemini-made cells 0.94 (330).
  - Nine of the Claude-cell misses are Haiku in 6182-claude-xl. This is v1's rule-2 case, unchanged: Haiku had been
    read only on the Tengyur.

### Did the judge term fix xlref-t4?

**No, and it could not.** xlref-t4 was judged only by Opus, so no judge-family term acts on its cells.

- **Coverage rose from 9/16 to 12/16 because of new data.** #6545's Persian rounds put the Gemini arms lower in Persian,
  and the full posterior moved with them.
- **Ablation:** without the round × arm-maker term, xlref-t4 is 12/16 and #6545 r1s1 is 27/30. Those are the same
  figures as with the term.
- **The four misses that remain:** Arabic 3 Flash (one of two runs), Arabic Flash-Lite (one of two), Persian Flash-Lite
  (one of two), and Persian Opus at 5.0 on 5 pages. All four are Arabic and Persian, as in v1.
- **#6545 stage 2's six misses are all Hebrew.** That round scored Hebrew 0.3 to 0.6 below the prediction, under both
  judges.
- **What the data show is a round × language shift.** v2, like v1, does not model it. It is not added here for the same
  reason v1 gave: it would be chosen after seeing the misses. The next pinned test (#6729) is the clean place to try it.
- **"#6545's Gemini cells all came in low" holds out of sample, and the term does not fix it.** Held out under the Opus
  judge, Gemini-made cells came in 0.21 below their prediction in both stage rounds; the Opus cells 0.00 to 0.05 below.
  The round × maker spread (packet: 0.57 logit [0.21, 0.95]) widens the intervals and does not move their centre.

### What the first non-Claude judges taught the fit

In score points at a typical cell, median [90%]:
- **Judge offsets against Opus:** Sonnet −0.03 [−0.11, +0.04]; Fable −0.08 [−0.13, −0.02]; Gemini 3.1 Pro −0.07
  [−0.24, +0.14]; Gemini 3.8 Flash High −0.02 [−0.30, +0.26].
- **A Gemini judge on its own family's Pro arm: +0.15 [−0.02, +0.40]** relative to other arms. This is self-preference
  for its own model, the largest judge × family term. The Gemini judge on Flash arms is −0.09 and on Opus −0.09: about
  the same.
- **Claude self-preference, as the design doc defines it** ((Opus − 3.8 Flash) under the Opus judge minus the same under
  the 3.1 Pro judge):
  - −0.12 in Sanskrit, −0.13 in Hebrew, −0.11 in Persian and Pali.
  - Every language's interval includes zero, and most medians are negative.
  - So the Pro judge puts Opus **further** ahead than the Opus judge does. There is no sign that Opus's lead in #6545 is
    its own judge flattering it.
- **Instrument agreement** (eval-design §2): Opus–Pro α was 0.60–0.63 in #6545, so not settled.
  - Levels are therefore quoted per judge.
  - The estimator pools judges through their fitted offsets, and the planner uses a two-family mean of differences.

### What we know (full fit, Opus judge, no round effect, average page)

Expected score [90%] and P(best of the seven).

| lang | Flash-Lite 3.1 | 3 Flash | 3.8 Flash CLI | 3.1 Pro high CLI | Sonnet 5.5 | Opus 5.5 |
|---|---|---|---|---|---|---|
| Persian | 3.17 [2.95, 3.37] | 3.83 [3.63, 4.03] | 4.19 [4.01, 4.37] | 4.17 [3.94, 4.41] | 3.73 | **4.71 [4.57, 4.83] · 1.00** |
| Sanskrit | 3.45 | 3.85 | 4.28 [4.15, 4.42] | 4.39 [4.21, 4.57] | 4.00 | **4.77 [4.66, 4.86] · 1.00** |
| Chinese | 3.53 | 4.02 | 4.35 [4.23, 4.48] | 4.39 (pooled) | 4.22 | **4.79 [4.69, 4.87] · 1.00** |
| Greek | 3.53 | 3.86 | 4.26 [4.13, 4.37] | 4.24 (pooled) | 4.09 | **4.57 [4.43, 4.70] · 0.99** |
| Hebrew | 3.89 | 4.28 | 4.54 [4.40, 4.67] | 4.51 (pooled) | 4.27 | **4.78 [4.67, 4.88] · 0.99** |
| Tibetan | 3.92 | 4.37 | 4.67 [4.51, 4.81] · 0.06 | 4.54 (pooled) | 4.32 | **4.74 [4.59, 4.85] · 0.91** |
| Latin | 4.12 | 4.31 | 4.62 [4.52, 4.71] | 4.61 (pooled) | 4.48 | **4.83 [4.74, 4.90] · 0.99** |
| Nahuatl | 3.08 (untested) | 3.69 (pooled) | **4.09 [3.49, 4.62] · 0.43** | (untested) | (untested) | 4.08 [3.49, 4.60] · 0.40 |

- **Opus leads in every language with a reference panel.** In Persian, Sanskrit, Chinese, Greek, Hebrew and Latin,
  P(best) is 0.99–1.00; in Tibetan it is 0.91. Nahuatl is the exception (below).
- **3.1 Pro high CLI is no longer offered by the CLI** (#6688). It is listed and not routable.
- **Nahuatl is a coin toss between Opus and 3.8 Flash**, on one Gemini judge with a ±0.6 position bias. Held out, the
  model predicted Opus at 4.68 and observed was 3.58: Nahuatl's script family had never been read. That is rule 2 again.

### Limits

- **#6545 and #6690 enter as cell means.** The pages' own scores would carry the A-vs-A noise and the judge × page
  agreement, which a mean cannot.
- **The judge-family terms rest on four non-Claude rounds.** τ_jf and τ_jfl stay close to their priors. #6729's
  two-family panels will move them.
- **The capacity question is not in this model.** Opus leads, but at 4,250 page-calls per account-week (#6561) it cannot
  carry Latin or Chinese. The planner (part 3) handles that.
- **Four v1 holdouts were not re-run** (above).

Artifacts:
- `scripts/eval/estimator/`: `build-table-v2.py`, `model_v2.py`, `loo_v2.py`, `report_v2.py`, `manifest-v2.json`,
  `results/report-v2-2026-10-15.json` (every held-out cell and miss, the judge terms, "what we know").
- The tables, the fitted posterior, the 17 holdout files and the draws for the planner are on cloudlayer:
  `/data/scratch/sl/jobs/qloop-6740/`.
- To rerun: `build-table-v2.py`, then `loo_v2.py --holdout <exp|none>`, then `report_v2.py`, in a venv with numpyro,
  jax and pandas.
