---
stage: ocr
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 160
n_pages: 800
verdict: "PREREGISTERED (2026-10-31): no result yet. Does a book-level confidence score built from stored signals (router posterior of the served route × the share of unflagged pages) rank live OCR'd books by what a blind Opus judge finds on 5 pages spread through each book?"
status: undecided
decision: "none yet: the preregistered rule (AUC >= 0.75 and calibrated → triage sweep of low-confidence books; else more testing) is applied in the results section"
superseded_by: null
issue: [7866, 6740, 7611, 7824, 7809]
router_evidence: "none — the export goes to router-table/evidence/confidence-validation-7866.score.json and rules.json does not name it; the store copies carry the cell namespaced study-7866/<cell> so the nightly sampler export does not pool them"
defect_rates: null
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
  - an image (`archived_photo`, else `display_photo`, else `photo`);
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
