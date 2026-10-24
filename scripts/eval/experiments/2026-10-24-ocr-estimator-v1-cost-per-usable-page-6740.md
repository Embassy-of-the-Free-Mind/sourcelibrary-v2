---
stage: ocr
measure: [accuracy, none]
languages: [en, la, de, fr, grc, lzh, hy, he, syc]
scripts: [Latn, Grek, Hani, Armn, Hebr, Syrc]
canons: []
n_books: 957
n_pages: 1276
verdict: "A hurdle term for 100%-error reads cuts the OCR estimator's in-sample level bias from 0.063 to 0.007 CER (same rows, same inference). The did-not-read model reproduces the #4763 gate (agy 3.8 Flash 31/122, fitted 0.24; S4 14/34, fitted 0.39; lite S4 7/34, fitted 0.18), but held out it predicts 8/122 where 31 were observed: refusals on a new kind of page cannot be read off the other charts. On English 1880–1930 prose the Archive's text clears the bar at $0. On 1880–1930 number-dense pages no measured route clears both bars."
status: informational
decision: "Route proposals in results/ocr-v1-routes.{json,md} for #7170 to consume; nothing routes from them until a held-out check passes for the cell (#6740)"
superseded_by: null
issue: [6740, 4763, 7170, 6553]
---
## 2026-10-24 · OCR estimator v1: which route gives each kind of page a usable reading at the lowest cost? (#6740)

PRIOR ART: `2026-10-15-ocr-estimator-v0-accuracy-failure-rates-6740.md` and `scripts/eval/estimator/ocr/model_ocr_v0.py`.
v0 had no hurdle, so its levels ran 0.064 high, and its failed-read model had no era, fame or page-kind term. It
predicted about 2% failed reads for Gemini 3.8 Flash on English, where #4763 measured 25%. Another prior-art source
is the other session's branch `worktree-estimator-v1-6740` (HEAD 969dd28): `refusal-census.mjs`, `refusal_v1.py`
and `route_v1.py`. Its refusal census and its census-fitted refusal model are reused here as they are (§2b). Its
chain router with a severity proxy is not reused: this file's router follows the §3a decision rule as written.
`scripts/eval/estimator/routing/derive_routes.py` proposes routes from P(best) on CER alone, with no cost. Design:
`.claude/docs/quality-research-system.md` §3a. No model calls; $0; CPU only.

### What was built (`scripts/eval/estimator/ocr/`)

- `build-ocr-table-v1.py` joins v0's Pareto rows (rebuilt today: 11,934 rows, up from v0's 11,382) to the #4763 gate
  rows. The gate rows are 122 referenced pages × Archive text, Flash-Lite and agy Gemini 3.8 Flash low, scored by
  `scorePage`; one page per book. Every row gains:
  - an era;
  - `fame_web`: the page's text is a public web transcription (the Wikisource panels);
  - a page kind (number-dense or prose);
  - the number counts.

  The English panels become five charts: early print (EEBO-TCP, v0's chart), and pre-1880 and 1880–1930, each split
  into prose and number-dense.
- `model_ocr_v1.py` holds three models.
  - **Accuracy with a hurdle.** P(read scores 100% error) is its own Bernoulli. A beta-binomial covers the rest. The
    dispersion and the work and page spreads are by chart.
  - **Did not read.** A Bernoulli over every row, with era, fame and page-kind terms. Each term can differ by
    engine family.
  - **Number errors.** Misread, dropped and spurious numbers per number printed, Poisson with a page effect shared
    by the engines.
- `fit_ocr_v1.py` runs the fits, the posterior predictive checks and the #4763 holdout.
- `route-costs.json` and `quality-bars.json` are the inputs the router reads, kept as data. `meter_quota_share.py`
  reads the quota meters.
- `route_ocr_v1.py` writes the per-cell routing proposals.

**Inference.** The accuracy and did-not-read fits use stochastic variational inference (AutoNormal, 15,000 steps,
400 draws). The ELBO was flat over the last 10% of steps. v0's NUTS fit of the accuracy model alone took 5.9 h on 3
cores, so this is the faster, empirical-Bayes-like version the brief allows. Its intervals run narrower than NUTS
would give. The number model uses NUTS: 3 × 800 draws, R-hat ≤ 1.007, 2 divergences.

### 1. Hurdle: the level bias goes away (posterior predictive, in sample)

The rows and the inference are the same for both fits. The statistic is v0's: fitted minus observed mean CER per
chart × engine cell (156 cells with at least 5 pages).

| fit | level bias, median [p10, p90] | median abs | within-chart difference error, median abs | sign right (gap ≥ 0.01) |
|---|---|---|---|---|
| without hurdle (v0's structure) | **+0.063** [−0.000, +0.203] | 0.064 | 0.027 | 746/788 |
| with hurdle | **+0.007** [−0.020, +0.042] | 0.013 | 0.016 | 741/788 |

- The refit without the hurdle reproduces v0's figure (0.064 with NUTS, 0.063 here).
- The bias shrinks most where 100%-error reads are common. Without the hurdle against with it:
  - Armenian (34% of reads at 100%): +0.27 → −0.01.
  - Latin-script other (14%): +0.20 → +0.01.
  - Hebrew (36%): +0.20 → +0.04.
  - Syriac print (16%): +0.10 → +0.01.
  - Latin (9%): +0.10 → +0.01.
  - Greek (7%): +0.09 → +0.01.
- Two fixes beyond the hurdle were needed:
  - **Dispersion by chart (φ).** One shared φ (≈21) let the fit read the clean English 1880–1930 prose chart as the
    tail of a skewed beta. It put that chart's mean at 0.009 against 0.003 observed. With φ by chart, English
    1880–1930 prose has φ = 423 and Hebrew φ = 3.8.
  - **Stratum as the chart.** A single number-dense term beside free page effects did not carry the ~6× gap in
    median CER between prose and date-dense pages.

### 2. Did not read: era, fame, page kind

**2a. This model** (Pareto + gate rows, every engine). Terms, posterior median [90%] on the logit scale:
- **Fame**, given that the text is a public web transcription, depends on the engine family:
  - Gemini Flash-Lite +2.46 [1.88, 3.02];
  - Gemini CLI (agy) +1.42 [0.97, 1.78];
  - Gemini 3 Flash +0.97 [0.19, 1.74];
  - open VLMs −2.79 [−4.53, −1.22].

  The recitation filter is a Gemini behaviour. The open models fail for other reasons, mostly empty output.
- **Number-dense page:** +1.16 [0.77, 1.58], about the same in every family.
- **Era:** about 0 (|effect| < 0.2 in every era; τ of the family × era term 0.07). With fame and page kind in the
  model, period adds nothing it can find. The rise from early print to 1880–1930 is carried by fame and page kind.
- **Work spread** τ = 1.27: whole works refuse together.

**In sample against the #4763 gate.** The fitted value is the mean P over the gate's rows, with each page's fitted
effects.

| engine | stratum | observed | fitted |
|---|---|---|---|
| agy 3.8 Flash low | all | 31/122 (0.254) | 0.238 |
| agy 3.8 Flash low | S1 pre-1880 prose | 4/25 | 0.146 |
| agy 3.8 Flash low | S2 pre-1880 date-dense | 6/22 | 0.271 |
| agy 3.8 Flash low | S3 1880–1930 prose | 7/41 | 0.151 |
| agy 3.8 Flash low | S4 1880–1930 date-dense | **14/34 (0.412)** | **0.391** |
| Flash-Lite | all | 17/122 | 0.120 |
| Flash-Lite | S4 | **7/34 (0.206)** | **0.180** |
| Archive text | all | 0/122 | 0.004 |

For a new page of each cell (the router's quantity), the posterior predictive count holds the observed count in 12
of 12 stratum × engine cells. agy on S4: 13 of 34 predicted [6, 21], 14 observed.

**2b. The census model** (other session's `refusal_v1.py`: 2.02M Flash-Lite page attempts in 15,776 books, plus the
gate, with #4780 held out). It reproduces the gate as well as 2a does. It fails #4780 held out: 17 [3, 71] refusals
predicted against 147 observed. See "Census refit" below.

### 3. Number errors on pages that print numbers (#4763, `scorePage` num_* counts)

The fitted value is the rate per number printed over ALL of the stratum's number-bearing pages, including pages
the engine did not read: the page effect is shared by the engines. The observed value is on the pages the engine
read, as misread / dropped / spurious.

| stratum | engine | pages read / with numbers | observed misread / dropped / spurious | observed per number | fitted per number, all pages [90%] |
|---|---|---|---|---|---|
| S4 1880–1930 date-dense | Archive text | 34/34 | 34 / 25 / 43 of 599 | 0.170 | **0.180** [0.154, 0.211] |
| S4 | agy 3.8 Flash low | 20/34 | 15 / 9 / 22 of 263 | 0.175 | **0.213** [0.167, 0.267] |
| S4 | Flash-Lite | 27/34 | 29 / 53 / 80 of 534 | 0.303 | **0.291** [0.253, 0.334] |
| S2 pre-1880 date-dense | Archive text | 22/22 | 36 / 8 / 51 of 265 | 0.358 | 0.329 [0.273, 0.389] |
| S2 | agy 3.8 Flash low | 16/22 | 18 / 2 / 33 of 161 | 0.329 | 0.247 [0.198, 0.298] |
| S2 | Flash-Lite | 19/22 | 17 / 8 / 37 of 194 | 0.320 | 0.259 [0.213, 0.315] |

- Prose strata print almost no numbers: 12 numbers on 7 pages in S3, 10 on 6 pages in S1. Their rates are not
  informative.
- **Flash-Lite drops numbers.** On S4 it has 0.093 dropped per number printed, against 0.044 for the Archive and
  0.045 for agy.
- The pages agy refuses are harder. agy's observed 0.175 on the 20 pages it read becomes 0.213 over all 34.
- Spurious numbers are the largest category on date-dense pages for every engine.

### 4. English by period

| cell | best quality (P(best)) | E[CER] of that route | P(read) of agy 3.8 Flash low, new page |
|---|---|---|---|
| early print (EEBO-TCP, 1500–1699), prose | claude -p Sonnet 5.5 (0.29); 10 of 13 measured routes within 0.015 of it | 0.049 | 0.92 / 0.98 |
| pre-1880 prose (S1) | agy 3.8 Flash low (0.61) | 0.026 | 0.87 (web text) / 0.96 (not) |
| pre-1880 date-dense (S2) | agy 3.8 Flash low (0.58 on numbers) | 0.033 | 0.75 / 0.91 |
| 1880–1930 prose (S3) | agy 3.8 Flash low (0.64) | 0.004 | 0.86 / 0.95 |
| 1880–1930 date-dense (S4) | Archive text (0.81 on numbers) | 0.068 (Archive), 0.043 (agy) | 0.62 / 0.83 |

The "not a web transcription" column is extrapolated through the fame term. No such English 1880–1930 page has been
measured.

### 5. Cost per call (`route-costs.json`, read from the meters)

- **Paid API:**
  - Flash-Lite Batch $0.00148 a page (EXPERIMENTS.md 2026-09-12 via paper-corpus-certification-4916.md E1);
  - Gemini 3 Flash realtime $0.00342. Disabled: the paid Gemini API is for Flash-Lite only (#6331);
  - Mistral OCR $0.004.
- **agy subscription:** 4.36 × 10⁻⁶ of the plan's month per call.
  - Basis: `/root/agy-quota/calls.csv`, 2026-10-13 to 2026-10-24. 83,551 calls succeeded and 1,936 hit the cap, so
    the stretch used the whole allowance. That is 229,190 calls per 30 days.
  - Cross-checks: 1,578 calls per 5-hour window gives 227,232; the other session's 24-hour reading gives 173K. The
    share lies between 4.4 and 5.8 × 10⁻⁶.
- **Claude, `claude -p`:** 0.0303 weekly points per call. This comes from 66 sealed Sonnet *text* calls = +2 points
  (2026-10-14, #6721). It is **not an image-call reading**.
- **Plan fees are private.** The router reads them at run time from the private fee file. The committed results
  carry quota shares and Claude points, never dollars.
- **GPU:** $0 on an idle card (`gpu_state: idle`). The busy cost per engine is in the file.
- **Archive text:** $0. It exists only for Archive books.

### 6. Routes (`results/ocr-v1-routes.md`; dollars only in the #6740 comment)

**The rule (§3a).** The router picks the cheapest MEASURED route whose quality clears the bar with P ≥ 0.9, and
reports its cost per usable page and P(best) beside it.
- **Cost per usable page** = call cost ÷ P(read) + P(not read) × the next route's call cost ÷ P(read).
- **The bar.** A route must be within max(0.01, 15% of the best) CER of the measured route with the lowest posterior
  mean error. On number-dense pages it must also be within max(0.02, 15%) errors per number printed.
- **Pooled routes** (a family sibling measured) are listed, never routed.

| cell | route | P(read) | E[CER] | number errors / number | P(clears bar) | P(best) | best quality |
|---|---|---|---|---|---|---|---|
| English 1880–1930 prose | **Archive text** ($0) | 1.00 | 0.008 | — | 0.96 | 0.00 | agy 3.8 Flash low (0.64) |
| English 1880–1930 date-dense | **none clears both bars** | | | | | | Archive (numbers, 0.81); agy has the lower CER |
| English pre-1880 prose | **agy 3.8 Flash low** | 0.87 | 0.026 | — | 1.00 | 0.61 | itself |
| English pre-1880 date-dense | **agy 3.8 Flash low** | 0.75 | 0.033 | 0.249 | 1.00 | 0.58 | itself |
| English early print | **Chandra OCR 2** (GPU, $0) | 1.00 | 0.051 | — | 0.91 | 0.11 | claude -p Sonnet 5.5 (0.29) |
| Latin print | **claude -p Sonnet 5.5** | 1.00 | 0.109 | — | 1.00 | 0.32 | agy 3.8 Flash high (0.35) |
| German, French etc. | **claude -p Sonnet 5.5** | 1.00 | 0.019 | — | 1.00 | 0.37 | itself |
| Greek | **agy Gemini 4 Argon low** | 1.00 | 0.084 | — | 1.00 | 0.43 | itself |
| Greek manuscript | agy Gemini 4 Argon low | 1.00 | 0.227 | — | 1.00 | 1.00 | itself |
| Chinese manuscript | **PaddleOCR-VL** (GPU, $0) | 1.00 | 0.229 | — | 0.97 | 0.19 | agy Gemini 4 Argon low (0.56) |
| Chinese print | agy Gemini 4 Argon low | 1.00 | 0.204 | — | 1.00 | 0.40 | itself |
| Hebrew | claude -p Opus 5.5 | 1.00 | 0.136 | — | 1.00 | 0.79 | itself |
| Armenian | Flash-Lite Batch | 1.00 | 0.079 | — | 1.00 | 0.25 | agy 3.7 Flash low (0.30) |
| Syriac manuscript | Sophro ($0) | 1.00 | 0.419 | — | 1.00 | 1.00 | itself |
| Syriac print | Kraken OmniSyr ($0) | 1.00 | 0.172 | — | 1.00 | 1.00 | itself |

- **English 1880–1930 date-dense** is the #4763 cell, and the bars split it:
  - the Archive's text has the fewest number errors (0.180 per number);
  - agy has fewer character errors (0.043 against 0.068) but more number errors (0.213), and did not read 14 of the
    34 (fitted 0.39);
  - Flash-Lite is worst on numbers (0.291).

  A reader who cites the numbers is best served by the Archive's text. One who reads the prose of an index page
  would prefer agy where it reads. This agrees with the other session's chain router: no chain reaches 80% usable
  on date-dense pages.
- **English 1880–1930 prose:** the Archive's text is within the bar of agy (0.008 against 0.004 E[CER]) at $0. That
  is what the free lane already does (#4763, PR #7264).
- **Latin and German/French:** Flash-Lite, the reader in use, does not clear the bar, as in v0. Sonnet via
  `claude -p` is the only route that clears it with P ≥ 0.9. Its price per call is a placeholder from a text-call
  reading. Weekly capacity (about 3,300 such calls per account-week) is not modelled, and it binds before price does.
- **Sensitivity:** halving or doubling the margins changes the choice in four cells (English early print, English
  1880–1930 prose, Chinese manuscript, Chinese print). Each change is between two routes the posterior cannot
  separate.

### 7. Held out: leave out the #4763 rows, fit, predict them

Two fits (accuracy and did-not-read) used 11,934 rows without any gate row. Each gate cell is then a chart the fit
never saw: era 1880 on (157 Pareto rows), web text, number-dense from the prior.

| engine | stratum | observed did-not-read | predicted count, median [90%] | miss (pages) | observed CER | predicted E[CER] |
|---|---|---|---|---|---|---|
| agy 3.8 Flash low | **all** | **31/122** | **8 [1, 39]** | **−23** | | |
| agy 3.8 Flash low | S4 | 14/34 | 1 [0, 18] | −13 | 0.052 | 0.26 [0.02, 0.92] |
| agy 3.8 Flash low | S3 | 7/41 | 1 [0, 11] | −6 | 0.003 | 0.22 [0.04, 0.63] |
| Flash-Lite | S4 | 7/34 | 1 [0, 14] | −6 | 0.050 | 0.25 [0.02, 0.91] |
| Archive text | S4 | 0/34 | 0 [0, 11] | 0 | 0.038 | 0.34 [0.02, 0.94] |

- **The miss.** Held out, the model predicts agy refuses 6% of the gate's pages (8 of 122), where 25% were
  observed. On S4 it predicts 1 of 34, where 14 were observed.
- **Coverage is not a pass.** Every observed count falls inside its 90% interval (13/13), but only because the
  intervals are wide enough to say nothing.
- **CER fails the same way.** For a chart the fit never saw, the predicted E[CER] centres on 0.2–0.3. That is the
  average over every script chart. The observed values are 0.003–0.07; 7 of 12 cells are covered, all by width.
- **What it means for routing.** The pooled model cannot route a new kind of page from the other charts. The 122-page
  gate was what made the 1880–1930 cells routable. §3a's planner rule says the same: test a large new cell before
  routing it. v0's 2% was this failure with narrower intervals.

### Census refit (other session's model, archive-text term added)

The other session's `refusal_v1.py` at HEAD 969dd28 was run unchanged, on its own census. The run adds the
archive-text term its first fit lacked. Data:
- 15,776 books (1,743 more held out), 51,641 of 2,023,291 Flash-Lite page attempts refused;
- the 244 gate rows;
- #4780's 623 one-page-per-book Flash-Lite reads, held out.

Sampling: NUTS, 4 × 1,000 draws, R-hat ≤ 1.002, 1 divergence (10 in the first fit). It took about 2.3 h on this box.

- **In sample on the gate:**
  - agy: 31/122 observed, 31 [23, 39] predicted; on S4, 14/34 observed, 13 [8, 17] predicted.
  - Flash-Lite: 17/122 observed, 17 [11, 25] predicted; on S4, 7/34 observed, 7 [3, 11] predicted.
  - For a new page of S4, P(not read) is 0.35 [0.22, 0.48] for agy and 0.18 [0.09, 0.30] for Flash-Lite. This
    agrees with §2a (0.38 and 0.17).
- **Held out on #4780: still fails.** Observed 147/623; predicted 17 [3, 71]. The first fit predicted 13.

  | language | observed | predicted [90%] |
  |---|---|---|
  | English | 27/177 | 10 [2, 35] (inside) |
  | Latin | 34/158 | 2 [0, 13] |
  | German | 39/109 | 2 [0, 12] |
  | French | 40/131 | 2 [0, 11] |
  | Italian | 7/48 | 0 [0, 3] |

- **The archive-text term does not carry the gap.** Fitted beside language, Gutenberg and period, it is −0.09
  [−0.18, −0.01] for the pipeline's prompt (`lite+ctx`). It is unidentified for the no-context-line prompt and for
  agy, whose only rows are gate pages, all of which have Archive text. The raw split (13.7% against 1.8%) is carried
  by language (English +1.17 [0.45, 1.88]) and by a Project Gutenberg match (+0.38 [0.24, 0.51]).
- **Where the miss sits.** It is in the prompt WITHOUT the document-context line, on Latin, German and French pages:
  22–36% refused in #4780, where the census-fitted model predicts 1–2% (2 pages of 109–158). The census holds only the context-line prompt,
  and the gate only English pages, so no fitted term can carry prompt × language.

  That is a measurement gap, not a modelling one. #4780 itself recorded that a retry with the context line recovered
  24 of 193. A gate of the no-context prompt on non-English pages would identify the term. So would any lane that
  sends pages without the context line.
- **Calibration on held-out census books:** observed against predicted refusal rate by decile.
  - The bottom six deciles: 0.0003–0.002 observed against 0.006–0.012 predicted.
  - The top decile: 0.151 observed against 0.208 predicted.

  The model over-predicts at both ends.
- **For routing:** this model does not pass its held-out check, so `route_ocr_v1.py` does not use it. In English
  1880–1930 its new-page refusal rates agree with §2a's within their intervals, so the English routes would not
  change. Draws: `/mnt/HC_Volume_105839809/jobs/estimator-v1-6740/census-fit/` on the job box; its summary is `results/refusal-v1-census-refit.json`.

### Limits

- **Variational inference** (AutoNormal), not NUTS, for the accuracy and did-not-read models. Its intervals are
  narrower than the posterior's. P(clears bar) and P(best) are therefore somewhat overconfident.
- **The bar is a margin relative to the best measured route.** That route clears it by construction, so a cell with
  any measured route has a choice. On number-dense pages the two bars can disagree (S4).
- **Refusals of two Gemini routes on one page are correlated.** The cost formula ignores this: the next route is
  priced at its average P(read). The census model's shared page effect is the input for a chain that does not
  ignore it (`route_v1.py` on the other branch).
- **`fame_web` marks a Wikisource panel.** It is a proxy: every #4763 page is a Wikisource book, so fame and era are
  confounded inside the gate. The census model's archive-text term is the measured alternative.
- **The GPU arms on the 122 pages** (PaddleOCR-VL, MinerU, olmOCR, GLM-OCR) are not in this fit. Task
  `15-en-numbers-4763` is still pending in gex45's queue, and this box cannot reach gex45's scores. Every GPU route
  is untested on the 1880–1930 cells.
- **Claude's points per call** are from text calls. An Opus image call costs more of the week, and was not metered.
- **Not modelled:** subscription capacity, which caps calls before price matters; and the queue cost of a busy GPU.

Artifacts: `scripts/eval/estimator/ocr/`:
- code: `build-ocr-table-v1.py`, `model_ocr_v1.py`, `fit_ocr_v1.py`, `route_ocr_v1.py`, `meter_quota_share.py`;
- inputs: `route-costs.json`, `quality-bars.json`;
- results: `results/ocr-v1-fit.json` (every check above), `results/ocr-v1-routes.json` (every route in every cell)
  and `results/ocr-v1-routes.md`.

The posteriors and the table are on the job box at `/mnt/HC_Volume_105839809/jobs/estimator-v1-6740/`. To rebuild:
1. `node scripts/eval/build-ocr-pareto.mjs --dump-rows=R`;
2. `build-ocr-table.py`;
3. `build-ocr-table-v1.py`, with the #4763 gate files from `eng-free-lane-4763` and a books metadata pull for the
   122 pages;
4. `fit_ocr_v1.py`;
5. `route_ocr_v1.py --fees <private>`.
