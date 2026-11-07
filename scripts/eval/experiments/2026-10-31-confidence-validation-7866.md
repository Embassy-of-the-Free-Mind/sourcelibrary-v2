---
stage: ocr
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 160
n_pages: 800
verdict: "Our cheap signals do not predict which books are bad. On 110 measured books (5 pages each, blind Opus, judge valid: 8/8 wrong-page, 12/12 plants), the confidence score's AUC for a bad book is 0.66 (95% CI 0.55 to 0.76) and Spearman against the defect rate is -0.26 (-0.44 to -0.06), under the 0.75 bar. Bad books: high-confidence 7/30, middle 18/30, low 26/50, unmeasured 20/50. Reweighted, 43% of live OCR'd books are bad (36 to 51%), about 20,600 of 47,435 (2026-10-31). The low stratum is miscalibrated (predicted 0.45, observed 0.58). Within one cell the flags add nothing (AUC 0.57). Book quality is clustered (ICC 0.38), so 5 pages a book give reliability 0.75. Gemini 3.8 Flash as a second judge: kappa 0.34 with Opus, and it misses 28% of Opus-bad pages when the text is Gemini-written against 5% otherwise; as a screen it clears 11% of books."
status: informational
decision: "By the preregistered rule: MORE TESTING, not a triage sweep by confidence (AUC 0.66 < 0.75; low stratum not calibrated). A sweep of low and unmeasured books only would miss ~9,500 of the ~20,600 estimated bad books (the high and middle strata). Not applied: the sweep, any re-read, and any rules.json entry are Derek's (#7809). 6 wrong-leaf pages in 2 books were contained."
superseded_by: null
issue: [7866, 6740, 7611, 7824, 7809]
router_evidence: "none — the export is router-table/evidence/confidence-validation-7866.score.json and rules.json does not name it (a stratified draw of stored text; adding it moves cells such as zh-paddle-dice-lt090, which is Derek's call, #7809). The store copies carry the cell namespaced study-7866/<cell>, so the nightly sampler export does not pool them."
defect_rates: "scripts/eval/confidence-7866/results/defect-rates.json"
---
## 2026-10-31 · Do our cheap quality signals predict a book's real quality? 160 books, 5 judged pages each, stratified by confidence (#7866)

PRIOR ART:
- `scripts/eval/route-judge-6740/judge.mjs`: `judgePrompt`, `opusCall`, `parseVerdict`, unchanged, through `correction-pass-7818/lib.mjs` `judgeAbsolute` (the image in the workspace, Opus `claude -p --model opus` on this box's subscription) and `judgeAgy` (the secondary judge).
- `scripts/eval/fraktur-paired-7835/judge.mjs`: the judge driver (pace guard, call budget, resume, wrong-page and planted controls), restated in `confidence-7866/judge.mjs` because its items come from its own frame.
- `scripts/eval/route-judge-6740/defect-rate.mjs` `words()` (#7824's word count) and `correction-pass-7818/lib.mjs` `SEVERITY_WEIGHTS.main` (MQM 1 / 5 / 25): imported.
- `scripts/eval/estimator/router-table/current.json` → `2026-10-31-correction-pass-7818.json`: the cell posteriors (`routes[].mean`, `k/n`, `defects.*_per_1k`) and decisions, read through `scripts/lib/router-binding.mjs` `loadCurrentTable`.
- `scripts/eval/lane-judge-sampler.mjs`: the `lane_judge_verdicts` schema (`validRecord`), `exportScore` (the router evidence format), the lane stamps a page's route is read from (`LANES`, `FIRST_READ_CELLS`).
- `scripts/eval/lib/agreement-stats.mjs` (`wilson`, `aucLowerIsPositive`, `binaryAgreement`), `scripts/eval/lib/plant-ocr-errors.mjs` (`plantError`, `scorePlant`): imported.
- `.claude/docs/data-provenance.md` §2: `page_revisions` segmented by `source`; only `batch_api`, `ai` and `pipeline_preview` rows are re-reads.
- Searched `scripts/eval/INDEX.md`, `gh issue list --search "confidence score"`: no book-level confidence score, and no test of whether the stored signals predict judged quality, existed.

Code: `scripts/eval/confidence-7866/` (`lib.mjs`, `frame.mjs`, `judge.mjs`, `analyze.mjs`). The analysis, `analyze.mjs score`, is committed in this PR, before any judge call.

**Question (Derek, 2026-10-31).** "Focus on books where we have less confidence, to understand whether we need more testing, and whether our current measures work." If the stored signals predict what a careful reader finds, the corpus can be triaged by them; if not, no book-level claim can rest on them.

### 1. Signals: what exists, and on how many books

**Frame.** Live books with OCR: `visible: true`, `pages_count > 0`, `pages_ocr > 0`: **47,435 books** (2026-10-31). Signals are read once by `frame.mjs signals` (one aggregation per 250 books over `pages` with `ocr.data`) and written to `$JOB_SCRATCH/confidence-7866/signals.json.gz`.

Coverage (share of frame books on which the signal is present; `frame.mjs score`, `results/frame-summary.json`):

| signal | source | books with it |
|---|---|---|
| router cell + served route measured (n ≥ 10) | `current.json` table × page stamps | 34,693 (73.1%) |
| cell decision known (keep / switch / HOLD / UNTESTED) | the same | 38,074 (80.3%) |
| route wrong-text per 1,000 words (#7824) | `routes[].defects` | 33,901 (71.5%) |
| any score flag | pages | 26,228 (55.3%) |
| `ocr.has_warning` | pages | 5,081 (10.7%) |
| `<scan-quality>poor` (self-reported) | `ocr.data` | 9,085 (19.2%) |
| `<scan-quality>` fair or poor | `ocr.data` | 15,331 (32.3%) |
| any `<scan-quality>` tag | `ocr.data` | 36,092 (76.1%) |
| model chatter in the text | `ocr.data` | 1,813 (3.8%) |
| near-empty text page | `ocr.data` | 11,151 (23.5%) |
| `translation_withheld` | pages | 4,432 (9.3%) |
| `needs_reocr` / `ocr.unreadable` / `ocr.verdict` ≠ SERVE | pages | 305 / 203 / 190 (0.6 / 0.4 / 0.4%) |
| page `scan_quality.scan_score` | pages | 22,442 (47.3%) |
| book `scan_quality` | books | 23,314 (49.1%) |
| `<language>` tag | `ocr.data` | 44,723 (94.3%); disagrees with `books.language` on > 10% of pages: 9,690 (20.4%) |
| `page_revisions` re-read row | `page_revisions` (seeded 1,000-book sample) | 313/1,000 (31.3%) |

Read off it:
- The router posterior covers 73.1% of books. That share is enough to rank the corpus, so it is the backbone of the score.
- The page flags are present on enough books to enter as a share (most books carry none).
- `page_revisions` re-read disagreement: 313 of a seeded 1,000-book sample (31.3%, `frame.mjs revisions`, seed 78667) have at least one re-read row; the other sources on those books are sweeps (`longs-pass-5924` on 194 books, `loop-guard-refused-2026-09` 35, `bdrc` 25 …), which are not disagreement. It is too thin to rank the corpus, so it is evaluated as a standalone signal on the drawn books only (`frame.mjs book-revisions`).
- Not used, and why:
  - `books.quality_score` / `quality_assessment` (55%) score historical significance and visual appeal, not text.
  - `ocr.verdict` and `ocr.qa_screen` are Tibetan- and Kanripo-specific (< 1% of books flagged).
  - Book and page `scan_quality` scores (49% / 47%) are image-quality rollups. They are evaluated on their own but kept out of the score, because they cover half the frame.

**The served route per page (`lib.mjs routeOf`)**, from the page's own stamps, the way `lane-judge-sampler.mjs` credits a write:
- Flash-Lite with no lane stamp: `lite`;
- `gemini-3-flash-preview`: `3flash`;
- `ocr.pipeline = agy-correct-lite-7558`: `lite>agy-flash-low`;
- the #7701 first-read lanes: their `-written` routes;
- `reocr_bdrc_4523` / `tib-correct-6560`: `yigdzin` / `yigdzin>agy-flash-low`;
- the Paddle lanes: `zh-paddle-dice-lt090` / `zh-6561-served` / `zh-frame-6871`;
- `gpu-print-en-2026-10`: `english-blank-pre1800 lighton-written`;
- held-book agy reads with no stamp: `agy-flash-low-read`.

The cell is `<language prefix>-<engine>/<script>`, with the script from `pages.script_type` (printed → print, handwritten → manuscript, else unknown). IA, corpus and e-text imports have no cell, and neither does any engine the router never tested. A route counts as **measured** in its cell from **10 judged pages** (the table's HOLD floor).

Approximations, declared:
- The Paddle and English GPU cells are study frames (dice < 0.90; pre-1800), applied to every page of that lane.
- A page's script comes from the field alone, not from the `<script>` tag.

### 2. The confidence score (fixed here)

Over a book's OCR'd pages:
- **p_route** is the page-weighted mean, over the routes that served the book, of the router's posterior acceptance (`mean`) for that route in that cell. Only pages on a measured route enter it.
- **flag_share** is the share of the book's OCR'd pages carrying any of these flags:
  - `ocr.has_warning`;
  - a self-reported `<scan-quality>poor`;
  - model chatter in the first 400 characters (`I cannot`, `I'm sorry`, `Here is the transcription`, `<<<BEGIN` …);
  - near-empty: under 120 characters, on a page neither its `page_type` nor its own `<page-type>` tag marks as blank, plate or front matter;
  - `translation_withheld`, `needs_reocr`, `ocr.unreadable`;
  - an `ocr.verdict` other than SERVE.
- **confidence = p_route × (1 − flag_share)**: the expected share of the book's pages that are accepted and unflagged.
- A book is **unmeasured** when fewer than half of its OCR'd pages sit on a measured route. It gets no score.

**Strata.** Cut points are the terciles of the measured books' scores in this frame:
- **low** < 0.4636;
- **middle** from 0.4636 up to 0.7345;
- **high** ≥ 0.7345;
- **unmeasured**.

Frame sizes: high 11,967, middle 11,181, low 11,545, unmeasured 12,742. Score quantiles: p10 0.362, p25 0.458, p50 0.650, p75 0.737, p90 0.765.

### 3. Draw (`frame.mjs draw`, seed 78661; pages 78662)

- Books per stratum, sorted by id and shuffled (`makeRng(78661)`), taken in order until **high 30, middle 30, low 50, unmeasured 50**.
- A book is skipped (and logged) when any fifth of its page sequence holds no eligible page.
- **Eligible page:**
  - stored OCR text (a string);
  - an image, by `scripts/lib/page-image-url.mjs` `getPageSource` (split-aware: a page split from a spread keeps the whole spread in `archived_photo`);
  - not hidden and not a split parent;
  - neither its `page_type` nor its own `<page-type>` tag is one of blank, illustration, frontispiece, map, diagram, plate, title-page, toc, dedication, preface, digitizer-insert, archived-spread, colophon, cover.
- **Pages:** one eligible page drawn uniformly (`makeRng(78662)`) from each fifth of the book's page sequence (by position among all its pages), so 5 pages a book.
- The stored text is copied at draw time; that copy is what is judged.
- **Weights:** a book's design weight is its stratum's frame size divided by the stratum's allocation (`draw.json`).
- Realised draw: 160 books, 800 pages (`results/draw.json`). Skipped for a fifth with no eligible page: high 47, middle 14, low 10, unmeasured 17.
  - **high (30):** Latin 17, German 12, Latin-English 1. Cells: latin-flash3 18, german-lite/print `lite` 7, german-flash3/print 5.
  - **middle (30):** Chinese Paddle manuscripts 17, latin-lite and latin-flash3 print 8, English GPU 2, German 1, French 1.
  - **low (50):** Chinese Paddle manuscripts 41, Korean 3, Tibetan Yigdzin 3, Arabic 1, French 1, Sanskrit 1.
  - **unmeasured (50):** English 17, Tibetan 7, Greek 6, Russian 3, other 17. Cells: greek-flash3 6, english-lite 6, IA OCR 5, english-flash3 5, Derge e-text 3 ….
  - **The score is close to a cell label.** p_route is constant within a cell, and the cells sort by language and script: high is Latin and German print, low is Chinese manuscripts. Between-strata contrasts therefore also compare languages and scripts. One within-cell test is preregistered for that reason: in every cell with ≥ 20 classified drawn books (here zh-paddle-dice-lt090/manuscript, 58 books), Spearman and AUC of the score, which there varies only by flag share..

### 4. Judge

- **Image.** The page image is fetched once (`judge.mjs images`) and the same bytes go to both judges. A file over 4 MB is resized with `sharp` to a long edge of 3,000 px, JPEG q90. 4 of the 800 are (5–11 MB), and the original is kept beside it.
- **Primary: Opus.** One call per page, the stored text and the page image, `judgePrompt` (task ocr, `lang` = the book's `language`) unchanged.
  - The judge is blind to stratum, score and route.
  - Queue order `makeRng(78663)`, 3 at a time.
  - An unparsed reply is judged again, at most 3 times in all.
  - Records: accept, fidelity, and defects with class and severity.
- **Noise floor: not rerun.** #7818's test-retest on the same judge and prompt (30 items twice): accept κ 0.87, 29/30. It is reused as the A-vs-A floor; its pages were German and French print, and that limit is declared.
- **Controls.**
  - Wrong-page: 2 per stratum (`mulberry32(78664)`). A page's image with another book's text in the same language; passes when not accepted at fidelity ≤ 2.
  - Planted: 3 per stratum on accepted texts, kinds B / C / D / E rotating (`plantError`, `makeRng(78665 + stratum index)`), scored by `scorePlant`. The planter covers Latin, German and French only, so plants are drawn from those books.
  - **The judge is valid for this study** when every wrong-page control passes and at least 0.80 of plants are caught. If not, the outcomes are reported as invalid, not as results.
- **Secondary: agy Gemini 3.8 Flash** (Derek, inbox note 2026-10-31 18:16Z; model id `gemini-3.8-flash-low`, agy's default and the Flash judge #7611 compared).
  - The same `judgePrompt` with the image (`correction-pass-7818/lib.mjs judgeAgy`: the image as `@./page.jpg`, the marker-line output instruction, one retry on an unparsed reply). Blind.
  - Every text Opus judged, controls included. agy concurrency 2. Stops when the agy Gemini pool reads empty on `/quota`. No Argon, no Pro, no paid API.
  - Account: the second agy login (`AGY_HOME=/root/.agy-james`, held to `gemini-3.8-flash-low` by its `allowed-model`), because this box's default agy login is not signed in. At 19:25Z its Gemini pool read weekly 30% and 5-hour 99% remaining; ~830 calls is about 1% of a week (#6740's ~100K Flash-low calls a week).
  - **Gemini never changes a primary outcome, a bad-book call or containment.**
- **Budget.** At most **900** Opus calls (800 pages, 20 controls, re-asks), counted from the verdict file.
  - Pace: model-limits' local stop, then the meter. Stop at weekly ≥ 85% or 5-hour ≥ 95%; never probe after a limit.
  - If the plan will not fit, pages are judged in queue order as far as they go, and the cut is reported.
- **CER.** #7835's DTA pages and #7818's Wikisource pages are single-page references for other frames. A drawn book is scored against one only where it is in those sets. The overlap is counted after the draw: 1 drawn book (`699389a6ce15387065947dc0`, high) is in #6012's typed references, but its reference is an independent English translation (EEBO A43737), not the same text. So no drawn page has a usable reference, and no CER is reported.

### 5. Outcomes (`analyze.mjs score`)

**Per page:**
- bad = not accepted, or any `wrong_text` defect;
- MQM points = 1 · cosmetic + 5 · misleads + 25 · wrong_text;
- words by #7824 `words()`.

**Per book:**
- defect rate = Σ points / Σ words × 1,000, pooled over its judged pages;
- **bad book** = at least 2 of its judged pages bad (a book needs ≥ 4 judged pages to be classified).

**Primary.** On measured books, does confidence rank books by observed defect rate, and find the bad ones?
- Spearman ρ of score against defect rate.
- AUC of the score for bad book (P(a bad book scores lower)), each pair weighted by the two books' design weights. This one carries the decision; the unweighted AUC is reported beside it.
- Book-cluster bootstrap 95% intervals: 4,000 resamples, seed 78666+.

**Secondary:**
- **Calibration.** Per measured stratum, the mean predicted acceptance (p_route) against the observed page acceptance with a book-bootstrap 95% CI. A stratum is calibrated when the prediction lies inside the interval.
- **Unmeasured books.** Bad share and acceptance against the measured strata: is "no measurement" itself a risk signal?
- **Each signal on its own.** Spearman against defect rate and AUC for bad book, over the books that carry it:
  - p_route and flag share;
  - each flag;
  - the route's wrong-text per 1,000 words;
  - served = decided, and whether the cell is decided (keep / switch) or not;
  - page and book scan score;
  - the `<scan-quality>` tags;
  - the `<language>` tag agreeing with `books.language`;
  - re-read disagreement from `page_revisions` (sources `batch_api` / `ai` / `pipeline_preview` only): the book's median over its pages, 1 − word-multiset Dice between the latest re-read row and the current text;
  - `human_read_count`.
- **Within one cell.** Per cell with ≥ 20 classified drawn books: Spearman of score against defect rate, and AUC for bad book. p_route is constant there, so this tests the flags alone.
- **ICC.** One-way random-effects ICC(1) (ANOVA, unequal group sizes) of bad page (0/1) and of log1p(points per 1,000 words), with book-bootstrap CIs.
  - Spearman-Brown reliability of a book's mean at 3, 5 and 8 pages.
  - **Rule:** pages per book for a future sweep = the smallest of 3 / 5 / 8 with reliability ≥ 0.70 on bad page. If none reaches it, 8 pages, and a book cannot be called good from a sample of that size.
- **Re-read queue.** Bad-book share per stratum, reweighted to the corpus (Σ N_s · p_s / Σ N_s, stratified bootstrap CI), times the frame's books.
- **Gemini against Opus (secondary judge):**
  - Cohen κ on accept (#7807: 0.44) and on wrong-text pages;
  - Spearman of the two judges' points per word;
  - Gemini's catch rate on the planted and wrong-page controls;
  - **self-preference**: agreement and Gemini's miss rate on Opus-bad pages, split by whether the stored text came from a Gemini model (`ocr.model` /^gemini/) or another engine;
  - AUC for the Opus bad-book call of Gemini's bad-page share, of the confidence score, and of score × (1 − Gemini bad share). This answers whether Gemini adds to the score.
  - **Screen bar:** a book is flagged when Gemini calls ≥ 1 of its pages bad. Gemini is good enough as a cheap first screen when it flags ≥ 0.90 of the Opus-bad books and clears ≥ 30% of books.

### 6. Decision rule

- **Invalid** if the judge fails its controls (§4).
- **Triage:** if the weighted AUC is ≥ 0.75 and all three measured strata are calibrated, propose a triage sweep that judges only low-confidence (and unmeasured, if they are worse) books and re-reads those found bad. Size it from the corpus re-read queue and the ICC's pages per book.
- **More testing:** otherwise. Name the signals that failed, and the test each needs.

### 7. Write-back

- **Verdicts.** Opus verdicts (items and controls) go to `lane_judge_verdicts` in the sampler's schema: lane `confidence-7866`, run `confidence-validation-7866`, the draw block with stratum, score, weight and fifth.
  - The **cell is namespaced `study-7866/<cell>`**, and the real cell is in `cell_real`.
  - Why: the nightly `lane-judge-sampler.mjs export` pools every record in the store by (cell, route). Under real cell names, a stratified non-random draw would move router posteriors with no decision (CLAUDE.md, writing to a store a job reads is actuation).
- **Router evidence.** The same records under their real cell names are exported through `exportScore` to `scripts/eval/estimator/router-table/evidence/confidence-validation-7866.score.json`, as #7835 did. **No rules.json entry.**
- **Bad books** are listed in `results/bad-books.json` and on #7866 (book, pages, top defects). No re-read and no text write.
- **Containment.** A page whose Opus verdict carries a `wrong_text` defect of class O1, O2, O3, I1 or T17 is checked by eye (the image and the text read in this session). A page confirmed as not this leaf's text follows `containment-on-finding.md`: hold the book, withhold the confirmed pages' English, label the issue `contained`.

### Seeds

| purpose | seed |
|---|---|
| book draw / page draw | 78661 / 78662 |
| judge queue (Opus / Gemini) | 78663 / 78668 |
| wrong-page | 78664 |
| planted | 78665 (+ stratum index) |
| bootstrap | 78666+ |
| page_revisions coverage sample | 78667 |

### Declared deviations from the issue

- Strata are terciles of the measured books plus an unmeasured stratum. The issue named the four strata but not the cuts.
- `quality_score` is not used: it scores significance, not text.
- `page_revisions` disagreement covers about 31% of books, so it is evaluated on the drawn books rather than built into the score.
- CER only where a drawn book is in an existing reference set (see §4).
- The Gemini secondary judge was added by Derek's inbox note before any judge call.
- Limits: Claude only via `claude -p` on this box's subscription; Gemini only through agy; no paid API call; no cron or routing change; read-only on page text (containment excepted, as the issue says).

## Results (run 2026-10-31 19:58Z – 21:45Z)

**Run.**
- Preregistration merged in #7868 at 19:58:37Z. Every judge call came after it.
- **Opus** (`claude-opus-5-5`, `claude -p` on this box's subscription): 821 calls (800 pages + 1 re-ask of an unparsed reply + 20 controls), against the cap of 900.
  - Meter: weekly 31% → 33%, 5-hour not reported. The account is shared, so this is an upper bound.
  - List-price equivalent $52.73, not billed.
- **Gemini** (`gemini-3.8-flash-low`, agy, `AGY_HOME=/root/.agy-james`): 820 texts, 1 unparsed.
- **Paid API: $0.**
- **Code fixed after the preregistration, method unchanged:**
  - the judge queue could index past its last job when several workers waited on the meter (crash on the one re-ask);
  - the Gemini stage skipped 4 pages whose stored text is empty; Opus had judged those, so Gemini now does too;
  - the router-evidence export attaches the controls to every (cell, route) and takes the hand from the cell's script, as #7835 did.
- Artifacts:
  - `scripts/eval/confidence-7866/results/`: `score.json`, `defect-rates.json`, `bad-books.json`, `draw.json`, `frame-summary.json`.
  - Texts, images and both verdict files: `$JOB_SCRATCH/confidence-7866/` (archived to R2).

### Instrument: valid

- Wrong-page controls: 8/8 rejected at fidelity ≤ 2 (2 per stratum).
- Planted errors: 12/12 caught (3 per stratum).
- Noise floor: #7818's κ 0.87, reused.

### Primary: does the confidence score rank books by what the judge finds?

On the 110 measured books (each classified on 5 judged pages):

| outcome | value (95% CI, book bootstrap) |
|---|---|
| Spearman ρ, score vs defect rate | **−0.26** (−0.44 to −0.06) |
| AUC for a bad book, design-weighted (primary) | **0.66** (0.55 to 0.76) |
| AUC, unweighted | 0.65 (0.54 to 0.75) |
| bad books | 51/110 |

The score carries some signal but **fails the 0.75 bar**. Even the upper end of its interval only touches it.

### By stratum

| stratum | frame books | bad books | bad share (Wilson 95%) | page accept observed (95%) | predicted (p_route) | wrong-text pages | MQM pts / 1k words (pooled; median book) |
|---|---|---|---|---|---|---|---|
| high | 11,967 | 7/30 | 23% (12–41) | 0.73 (0.63–0.83) | 0.79 | 30/150 | 53; 37 |
| middle | 11,181 | 18/30 | 60% (42–75) | 0.59 (0.48–0.69) | 0.56 | 37/150 | 89; 78 |
| low | 11,545 | 26/50 | 52% (39–65) | 0.58 (0.49–0.68) | 0.45 | 79/250 | 153; 81 |
| unmeasured | 12,742 | 20/50 | 40% (28–54) | 0.67 (0.56–0.76) | — | 60/250 | 90; 17 |

- **Calibration.** High and middle are calibrated. **Low is not**: the router predicts 0.45 and the judge accepts 0.58. Most low books are Paddle Chinese manuscripts, whose cell posterior (14/30) is too pessimistic: here 181/278 pages were accepted.
- **Middle and low do not separate** (60% and 52% bad).
- **Unmeasured books are not worse than measured ones.** "No measurement" is not a risk signal: their median book is the cleanest of the four strata. The other English, IA OCR and e-text imports are mostly sound, while Greek and Sanskrit Flash text is poor.
- **Within one cell** (zh-paddle-dice-lt090 / paddle, 58 books, where only the flag share varies): ρ −0.20 (−0.45 to +0.08), AUC 0.57. The page flags add nothing there.

### Each signal on its own (all classified books that carry it)

| signal | books | ρ vs defect rate | AUC for a bad book (95%) |
|---|---|---|---|
| confidence score | 110 | −0.26 | 0.65 (0.55–0.75) |
| p_route (router posterior) | 110 | −0.27 | 0.62 (0.52–0.72) |
| re-read disagreement (`page_revisions`, re-read sources) | 75 | −0.26 | 0.62 (0.49–0.74) |
| route wrong-text per 1k words | 105 | −0.21 | 0.61 (0.51–0.71) |
| 1 − flag share | 160 | −0.10 | 0.59 (0.51–0.68) |
| no fair / poor `<scan-quality>` tag | 160 | −0.17 | 0.57 (0.51–0.63) |
| served route = decided route | 110 | −0.19 | 0.56 (0.51–0.62) |
| `<language>` tag agrees | 148 | 0.01 | 0.55 (0.46–0.65) |
| no near-empty pages | 160 | −0.15 | 0.53 (0.46–0.61) |
| `human_read_count` | 160 | −0.06 | 0.53 (0.47–0.58) |
| no withheld translation | 160 | 0.02 | 0.52 (0.47–0.57) |
| no `ocr.has_warning` | 160 | 0.12 | 0.50 (0.45–0.55) |
| cell decided (keep / switch) | 126 | 0.00 | 0.49 (0.43–0.55) |
| route measured at all | 160 | 0.22 | 0.47 (0.40–0.54) |
| book scan score | 93 | 0.16 | 0.39 (0.29–0.50) |
| page scan score | 87 | 0.15 | 0.38 (0.27–0.50) |

AUC here is P(a bad book scores lower). Below 0.5 means the signal points the wrong way.

What carries the prediction:
- **The router posterior.** It is the backbone, and it is about as good as the whole score.
- **Re-read disagreement**, on the 75 drawn books that have a re-read row.

What is noise or worse:
- `has_warning`, withheld translations, near-empty pages, the language tag and reader counts.
- The scan-quality scores, which point the **wrong way**: better-scanned books were worse here. Language confounds this, since the manuscripts with good photographs are the hardest to read.

### How many pages a book needs (ICC)

| | ICC(1) (95%) | reliability of the book mean: 3 / 5 / 8 pages |
|---|---|---|
| bad page (0/1) | **0.38** (0.29–0.46) | 0.65 / **0.75** / 0.83 |
| log MQM points per 1k words | 0.50 (0.41–0.58) | 0.75 / 0.83 / 0.89 |

- Quality is largely a property of the book. By the preregistered rule, **5 pages a book** (reliability 0.75 ≥ 0.70) is enough to call a book from a sample.
- 3 pages is not (0.65), and 8 buys little more.

### The re-read queue, reweighted to the corpus

- Bad share of live OCR'd books: **43.4% (95% CI 36.1–50.8%)**, about **20,600 of 47,435 books** (2026-10-31).
- By stratum: high ~2,800, middle ~6,700, low ~6,000, unmeasured ~5,100.
- A sweep of the low and unmeasured strata only would reach ~11,100 of them and **miss ~9,500 (46%)**.

### Secondary judge: Gemini 3.8 Flash against Opus

| | pages | accept κ | accept, Opus / Gemini | wrong-text κ | Gemini misses of Opus-bad pages | ρ of points per word |
|---|---|---|---|---|---|---|
| all | 800 | **0.34** | 0.64 / 0.43 | 0.31 | 54/289 (19%) | 0.50 |
| stored text by a Gemini model | 434 | 0.46 | 0.61 / 0.57 | 0.43 | **48/170 (28%)** | 0.57 |
| stored text by another engine | 366 | 0.25 | 0.68 / 0.27 | 0.23 | **6/119 (5%)** | 0.50 |

- **Controls:** Gemini passed 8/8 wrong-page and caught 12/12 plants.
- **Self-preference, as #7611 found.**
  - On Gemini-written text it lets through 28% of the pages Opus calls bad; on other engines' text, 5%.
  - On other engines' text it is far harsher than Opus (it accepts 27% where Opus accepts 68%).
  - Its overall κ is 0.34 (#7807: 0.44).
- **As a cheap first screen** (a book flagged when Gemini calls ≥ 1 of 5 pages bad):
  - it catches 70/71 Opus-bad books (Wilson 0.92–1.00);
  - but it flags 143/160, clearing only **11%** of books against the 30% bar. **Not good enough.**
- **Does Gemini add to the score?** On measured books the AUC rises from 0.65 (score alone) to 0.68 (Gemini's bad-page share) and 0.69 (score × (1 − Gemini bad share)). Over all books, Gemini's bad share alone reaches 0.73. Neither reaches 0.75, and Gemini changes no primary outcome here.

### CER

No drawn page has a same-text reference (§4), so no CER is reported.

### Decision (preregistered rule)

**MORE TESTING.** The AUC is 0.66 (< 0.75), and the low stratum is not calibrated. What failed, and the test each needs:

- **The router posterior is the only strong signal, but it is a cell average.** It cannot see a bad book inside a good cell: 7 of 30 high-confidence books are bad, two of them whole-book wrong-leaf.
  - Test: a book-level detector that does not need a judge. Leaf alignment, i.e. whether a page's text belongs to the leaf, as #3368 / #4790's leaf-drift check does for IA books, run over every book. The two contained books are both of that kind.
- **The page flags and scan scores carry no signal.** They should not be used to rank books until a detector is validated against judged pages.
- **The zh-paddle cell posterior is too low** (14/30 in the table; 181/278 here).
  - Test: none needed. The evidence is exported; whether rules.json takes it is Derek's call.
- **Neither judge can screen cheaply.** Gemini Flash clears 11% of books.
  - Test: Argon (#7611: Argon ≈ Opus, 143/144 plants) as the screen on these same 820 texts. That measures the clear rate at ≥ 0.90 sensitivity before any sweep.

### Containment (by eye, this session)

The judge gave 38 pages a wrong-text defect of a containment class. I opened the images of every whole-page case (fidelity 1, I1). Confirmed as another leaf's text:
- **`69af48642a821385be062737`** (*Arati Phaenomena, Geographia, Ora Maritima*, high stratum), pp. **77, 127, 188, 206**.
  - p77's leaf is the Danube/Thrace verse, and that text is stored on p74: the text is shifted three or more leaves off its images through the book.
  - The book was already held (an IA wrong-leaf hold). The 4 pages' English is withheld.
- **`6a4cb63519ae103166961ce4`** (*De Rebus Fatisque Huius Seculi…*, high stratum), pp. **2, 10**.
  - p2 is a blank leaf carrying a full page of text; p10's leaf is the opening, but it carries the closing page.
  - The same opening text is stored on pp. 2, 8, 12 and 14.
  - Held now (`wrong-leaf-confidence-7866`). The 2 pages' English is withheld.

The other 32 are invented spans inside otherwise-right pages (Paddle Chinese, Korean and Greek manuscripts): quality findings, listed as bad books, not containments. That includes the two Korean pages whose lower halves are filler syllables (`69f3296eaeeee0fa38c658ea` pp. 27, 36). Cursive Hangul could not be confirmed by eye in this session.

### Write-back

- `lane_judge_verdicts`: 820 Opus records (lane `confidence-7866`, run `confidence-validation-7866`, cells namespaced `study-7866/<cell>`, the real cell in `cell_real`).
  - The nightly sampler export pools none of them into a router cell.
  - Its rebuild will post the 38 containment candidates on #7611 once. Noted there, with the triage above.
- `scripts/eval/estimator/router-table/evidence/confidence-validation-7866.score.json`: 1,552 records under real cell names (751 items + the 20 controls attached per route). **Not named in rules.json.**
- Bad books (71): `results/bad-books.json` and the #7866 comment.

## Amendment 1 (2026-11-01, before any Argon call): Gemini 4 Argon as a cheap screen on the same texts

**Why.** Derek took the #7866 default on 2026-11-01: test agy Argon as a cheap first screen, on the same 820 texts, with about 820 Argon calls approved. 3.8 Flash cleared only 11% of books at the bar (above).

**Instrument, unchanged except the model.**
- `judge.mjs argon`: the `gemini` stage with `gemini-4-argon-low` and output `verdicts-argon.jsonl`.
- Same `judgePrompt`, same image bytes (`OUT/img`), same marker-line suffix and one retry on an unparsed reply (`correction-pass-7818/lib.mjs judgeAgy`).
- Blind to stratum, score, route and every other verdict.
- Same texts: the 800 items and the 20 controls Opus judged, in queue order `makeRng(78668)`.
- Concurrency 2. Stops when the account's Gemini pool reads empty on `/quota` (`AGY_GEMINI_EMPTY`), and on any agy quota refusal. At most 2 tries per text.

**Permissions and placement.**
- `AGY_ALLOW_HEAVY=7866` for this job only.
- Box and job heavy caps raised for this job only (`AGY_HEAVY_BOX_CAP=900`, `AGY_HEAVY_DAILY_CAP=900`).
- The run needs an agy login that may run Argon. The second account (`/root/.agy-james`) is held to 3.8 Flash low, and the stage refuses it.
- On the box where job `leaf-screen-7866` ran (earthai-l7a), the default agy login is not signed in (checked 2026-11-01 01:00Z). So the run goes to a box with the main login, with the inputs below.
- **Inputs:** the exact texts, controls, images and Opus verdicts of this study, tarred from `$JOB_SCRATCH/confidence-7866/` to R2:
  - key `cold/l7a/leaf-screen-7866/confidence-7866-argon-inputs.tar.zst` (bucket `sl-corpus-snapshots`, 539,287,227 bytes, sha256 `915cc6d854aa033d54094b0dc90055c17bce4d82aad2e0b189f322b19a83bec3`).
  - Restore on the running box:
    ```
    mkdir -p $JOB_SCRATCH && node scripts/workers/cold-r2.mjs get <key> | zstd -d | tar -C $JOB_SCRATCH -xf -
    ```
  - Then run:
    ```
    AGY_ALLOW_HEAVY=7866 AGY_HEAVY_BOX_CAP=900 AGY_HEAVY_DAILY_CAP=900 node scripts/eval/confidence-7866/judge.mjs argon
    node scripts/eval/confidence-7866/analyze.mjs score
    ```

**Outcomes (`analyze.mjs score` → `score.json` `argon_secondary`: `geminiBlock`, unchanged, on the Argon file).**
- **Sensitivity:** of the Opus-bad books (≥ 2 of 5 judged pages bad; 71 of 160), the share Argon flags (Argon calls ≥ 1 of the book's pages bad), with Wilson 95% CI.
- **Clears:** the share of the 160 classified books Argon does not flag.
- **Bar (preregistered):** Argon is good enough as a cheap first screen when sensitivity ≥ 0.90 **and** clears ≥ 30%.
- **Self-preference:** κ, agreement, and Argon's miss rate on Opus-bad pages, split by stored text written by a Gemini model (`ocr.model` /^gemini/) against any other engine.
- **Agreement with Opus:** Cohen κ on accept and on wrong-text pages, over all 800 pages; Spearman of points per word.
- **Controls:** wrong-page rejected (8) and planted errors caught (12), as for Flash.
- **Secondary, exploratory (not the bar):** the same screen with the Opus bad-book rule (Argon calls ≥ 2 of 5 bad), and the AUC of Argon's bad-page share for the Opus bad-book call.

**What Argon cannot change.** Opus stays the reference. Argon changes no primary outcome, bad-book call or containment, and writes nothing to Mongo.
