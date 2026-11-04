---
stage: ocr
measure: [judged]
languages: [la, de, fr, en, it, es, pt, da, enm, gmh, fro, tr, bo, zh, ar, ota, he, grc, sa, hi, ko, ru, ta]
scripts: [Latn, Tibt, Hani, Arab, Hebr, Grek, Deva, Kore, Cyrl, Taml]
canons: []
n_books: null
n_pages: 11334
verdict: "Yes, it can share strength. A partially pooled logit model of acceptance (engine + draft + language + writing system + print/manuscript) predicts routes in cells it has not seen. Leaving one base cell out, it scores -528.5 held-out log density against -622.8 for the flat Beta(1,1), -581.6 for one grand Beta and -614.6 for the table's prior. Calibration error is 0.014 against 0.126 (grand mean) and 0.249 (table prior). It also holds leaving a whole language out (-539.7; ECE 0.031). The engine x script interactions shrink to zero and add nothing. Held out, the hierarchical mean is worth 5.2 pages [4.3, 6.4] for an unseen language, 5.5 [4.5, 6.7] for an unseen base cell and 6.4 [5.2, 7.8] for an unseen script split. The v1/v2 means the table uses today are worth 5.5 [3.3, 9.0] on the 24 routes they cover. On those same routes the hierarchical mean is worth 12.8 [6.1, 28.5]."
status: undecided
decision: "Recommended, not applied (rules.json moves cells and is Derek's): set the prior's worth to 5 book-scaled pages (rules.json has 7, not the 5 the brief quoted), and take its MEAN from the hierarchical fit for every route, not v1/v2 for 24 of them and flat for the rest. Drop the engine x script interaction. Code and results: scripts/eval/estimator/heldout/."
superseded_by: null
issue: [7263, 7393, 6740]
router_evidence: "none — re-fits the evidence already in the 2026-10-31 correction-pass table; adds no judged pages and moves no cell"
defect_rates: "none — acceptance k/n only; no page was judged for defects"
---
## 2026-11-01 · Does a hierarchical fit of acceptance predict router cells it has not seen, and how many pages is it worth? (#7263)

PRIOR ART:
- `router-table/fit_prior.py` (#7263 backfill-all, router-next) fits ONE weight W and a calibration slope for the v1/v2 prior means. It uses the 15 (now 24) routes those models cover, and its leave-one-cell-out check rejected the calibration (rules.json `prior.calibration.in_force = false`). It never asks whether one cell's acceptance predicts another's, and it cannot score the 230 routes with a flat prior. Its beta-binomial likelihood, its W grid and its profile interval are reused here.
- `router-table/build.py` supplies the outcome unchanged: `eff` is the accepted and judged pages after book scaling, the same numbers the posterior uses. Its per-route `prior` (a, b) is model (b) below.
- `2026-10-28-router-backfill-all-and-prior-weight-7263.md` is the 7-page weight in force today.
- `loo_v1.py` / `loo_v2.py` score v1/v2 against their own references (CER, 1–5), not against acceptance, so they cannot answer this.
- Nothing in `scripts/eval/INDEX.md` or `EXPERIMENTS.md` does a held-out test across cells.

**Why.** This is step 1 of the 2026-11-01 R&D plan on #7263. The router has to find optima across 109 cells, where the median route has n = 8. It can only do that if one cell's evidence informs another's (hierarchical Bayesian bandits, Hong et al., AISTATS 2022). The v1 hierarchical prior failed a held-out check and sits behind a fixed page weight, so first: does a hierarchical fit predict cells it has not seen?

### Design

- **Data.** Every TESTED route in `router-table/2026-10-31-correction-pass-7818.json`:
  - 254 routes, in 93 cell × script rows, 46 base cells and 23 languages;
  - 11,334 judged pages, which become 5,403.5 book-scaled units.
  - **The outcome is build.py's book-scaled `eff` k of n**, so a book counts once whatever its pages. That is the "weighted by books" the brief asks for, and it is the unit `rules.json prior.pages_*` is applied in.
- **Factors** (`heldout/factors.py`):
  - engine: the stage that wrote the text, with 15 levels, translation engines included;
  - draft: what a corrector corrected, or none;
  - language;
  - writing system;
  - script type: print, manuscript or unknown;
  - engine × writing system, and engine × script type.
- **Models**, each scored on routes it did not see:

| | model |
|---|---|
| (a) flat | Beta(1, 1), what an untested route gets today |
| (a′) grand | one Beta(m W, (1 − m) W) for every route, fitted on the training folds |
| (b) table | the table's own prior: the v1/v2 mean worth 7 pages on 24 routes, flat on the rest. Not refitted per fold, and its 7 was fitted on these routes, so it is flattered |
| (c-eng) | engine + draft, partially pooled |
| (c-add) | + language + writing system + script type |
| **(c) hier** | (c-add) + engine × writing system + engine × script type |

- **How (c) works.**
  - logit p = μ + Σ effects. Each group is N(0, s_g²); the engine s is fixed at 2.5, nearly a fixed effect.
  - The route's p is beta-binomial around that mean, with concentration W.
  - The s_g and W come from the Laplace-approximate marginal likelihood (coordinate ascent on log grids), refitted in every fold.
  - A level that no training route has keeps its prior. An unseen language therefore widens the prediction by s_lang² instead of guessing.
- **Folds.**
  - Leave one ROW out (cell × script, the 109-cell grain).
  - Leave one BASE out: print, manuscript and unknown share books, so they leave together, and the `german-blank*` cells are one base.
  - Leave one LANGUAGE out.
- **Scores.**
  - Held-out log predictive density of the book-scaled k of n, binomial coefficient included.
  - Calibration: predicted against observed acceptance, binned and book-weighted, with the expected calibration error (ECE).
  - The prior's worth: the W that maximises the held-out beta-binomial likelihood around each model's held-out mean, with a profile 90% interval.
- Stdlib only. About 20 minutes on 8 processes. No model calls, no DB.

### Result

Held-out log predictive density (higher is better), MAE and ECE, both book-weighted:

| model | leave one row out | leave one base out | leave one language out |
|---|---|---|---|
| (a) flat | −622.8 · 0.333 · 0.281 | −622.8 · 0.333 · 0.281 | −622.8 · 0.333 · 0.281 |
| (a′) grand | −580.7 · 0.216 · 0.098 | −581.6 · 0.219 · 0.126 | −581.8 · 0.223 · 0.155 |
| (b) table | −614.6 · 0.302 · 0.249 | −614.6 · 0.302 · 0.249 | −614.6 · 0.302 · 0.249 |
| (c-eng) | −540.1 · 0.152 · 0.055 | −549.5 · 0.154 · 0.052 | −555.1 · 0.154 · 0.050 |
| (c-add) | **−507.7** · 0.116 · 0.020 | **−528.1** · 0.124 · 0.014 | **−538.3** · 0.129 · 0.027 |
| **(c) hier** | −510.7 · 0.117 · 0.020 | −528.5 · 0.124 · 0.014 | −539.7 · 0.128 · 0.031 |

- **It shares strength.** Leaving one base out, (c) beats flat by 94 nats, the grand mean by 53 and the table's prior by 86. Per route, (c) is better than flat on 180 of 254, and than the table on 173.
  - The gain holds where it matters, on small routes (n_eff < 10, 123 routes): +12.9 nats over flat and +10.9 over the grand mean, leaving one base out.
  - Leaving a whole language out, it shrinks to +5.0 and +3.1.
- **Which factors matter.**
  - Engine and draft carry most of it: (c-eng) gains 73 nats over flat, leaving one base out.
  - Language, writing system and print/manuscript add another 21.
  - **The engine × script interaction adds nothing.** Its scale goes to the grid floor (s = 0.05) in every fold, and (c) ≈ (c-add). "Lite fails on non-Latin" is a writing-system effect common to every engine in this evidence, not one engine's weakness.
  - Fitted effects on the full data (logit):
    - engine: Opus correction +2.0, agy translation +1.6, agy correction +0.85, agy read +0.76, Flash 3 +0.36, Flash-Lite −0.21, GPU −0.70, PERO −1.23, kraken −3.7;
    - writing system: Latin +1.09, Cyrillic +1.16, Han −0.48, Hebrew −1.09, Greek −1.14;
    - print +0.18, manuscript −0.12;
    - language s = 0.5, writing system s = 1.0. The residual spread between routes is W = 13.
- **Calibration** (leave one base out, book-weighted), predicted → observed by bin: 0.39 → 0.42 | 0.59 → 0.60 | 0.74 → 0.77 | 0.85 → 0.87 | 0.93 → 0.94 | 0.95 → 0.94.
  - The model is slightly pessimistic everywhere, by at most 0.03.
  - Leaving one language out, the bottom bin misses most: 0.44 → 0.55, on 405 books.
- **Where it misses.** These are cells whose language defies its writing system, and the misses are visible in `breakdown.py`:
  - higher than predicted: Hindi (0.87 against 0.48) and Russian (0.89 against 0.53);
  - lower than predicted: Greek (0.27 against 0.62), Hebrew (0.24 against 0.57), Chinese 3 Flash (0.22 against 0.68) and MHG (0.10 against 0.66).
  - A prior worth 5 pages is overturned by about 10 books of evidence, so these misses are recoverable. They are also the argument against a larger weight.

### What the prior is worth (the cap)

The fitted W is the number of pages (book-scaled) that a Beta prior centred on the held-out mean is worth. Δ is the log likelihood at W = 5 and W = 7 against the best W.

| prior mean | held out by | W (pages) | profile 90% | Δ at W = 5 | Δ at W = 7 |
|---|---|---|---|---|---|
| hierarchical (c), all 254 routes | row | 6.4 | [5.2, 7.8] | −1.5 | −0.2 |
| hierarchical (c), all 254 routes | base | **5.5** | [4.5, 6.7] | −0.2 | −1.6 |
| hierarchical (c), all 254 routes | language | **5.2** | [4.3, 6.4] | 0.0 | −2.6 |
| grand mean | base | 2.2 | [1.9, 2.7] | −25 | −51 |
| table's v1/v2 mean, its 24 routes | (not refitted) | 5.5 | [3.3, 9.0] | −0.05 | −0.3 |
| hierarchical (c), the same 24 routes | base | 12.8 | [6.1, 28.5] | −2.1 | −0.8 |

The model's own predictive spread agrees: a moment-matched W with a median of 8.8 (leave one base out) and 6.3 (leave one language out).

**Recommendation.**
1. **The cap is 5 pages** for a prior centred on the hierarchical mean.
   - It sits inside the 90% interval for a new base cell and for a new language.
   - It costs at most 1.5 nats against the best W under every fold scheme.
   - 7, the value in `rules.json` today (`prior.pages_measured = pages_pooled = 7`; the brief's "5" is not what is in force), lies above the upper bound for new languages and costs 2.6 nats there.
   - For a new script split of a known cell, 6 would be justified. One number is simpler and the difference is under 1.5 nats.
2. **Take the prior's mean from the hierarchical fit for every route.** Today the table uses v1/v2 for 24 routes and a flat prior for the rest.
   - On the 24 routes v1/v2 cover, the hierarchical mean scores −60.5 held out against −66.7 for the table prior.
   - It extends an informative prior to the 230 routes, and to every untested route of a known engine, that get Beta(1, 1) today.
3. **Drop the engine × script interaction.** Keep engine + draft + language + writing system + script type.

### Caveats

- **The outcome is Opus's acceptance**, pooled across four verdict scales (the 11-01 audit on #7263). This model predicts the judge. Step 2 (CHURRO-DS calibration) decides whether the judge is right.
- **Book scaling treats the correlation within a book as 1** (`eff`; ICC 0.38 in #7866). W is in book-scaled units because that is how build.py applies it. If the scaling changes, refit W with `heldout.py`.
- **(b) is flattered.** It is not refitted per fold, and its 7 came from these routes.
- **Engines with few routes have imprecise effects**, so their place in the ranking above is not established: kraken and agy-flash-high have 1 route each, PERO and Paddle 3.
- No decision moves in this PR: `rules.json` is unchanged.

### Artifacts

- `scripts/eval/estimator/heldout/heldout.py`: the three fold schemes, all six models, worth and calibration.
- `factors.py`: route → factors.
- `breakdown.py`: per-language and per-base gains, and the gain by route size.
- `results/2026-11-01-correction-pass-7818.json`: per route, every model's held-out mean and log density under each scheme; the full-data effects; the hyperparameters by fold.
- Reproduce: `python3 scripts/eval/estimator/heldout/heldout.py --out <file>` (repo root, HELDOUT_PROCS=8).

*Replicated?* No. The next table build can rerun it unchanged.
