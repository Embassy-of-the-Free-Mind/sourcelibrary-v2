---
stage: ocr
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 220
n_pages: 860
verdict: "Preregistration only; results land in a later commit of this PR."
status: informational
decision: "None yet. The rule in §7 decides whether unjudged books may carry an estimated grade."
feeds: figure
superseded_by: null
issue: [7263]
router_evidence: "none — no route compared; the router table is read for a feature (p_route) and never written"
defect_rates: "none — sense errors per 1,000 units are the TARGET here, from verdicts already recorded by #7866 and severity-cal-7263"
---
## 2026-11-04 · Can a small model predict a book's grade from features we already hold? Preregistration (#7263)

PRIOR ART:
- `2026-10-31-confidence-validation-7866.md`: the 800 labels; the confidence score's AUC for a bad book 0.66, within one cell 0.57; ICC 0.38, reliability 0.75 at 5 pages. Its signals (p_route, flags, re-read disagreement) are features here, not rebuilt.
- `2026-11-04-pooled-quality-model-6557.md`: failed on interval coverage (100%, intervals as wide as [0, n]). Its lesson is taken: the interval here is for a count with a measured dispersion, and coverage is scored as preregistered, not relaxed.
- `2026-11-01-hierarchical-heldout-7263.md`: route acceptance shares strength across cells. Route and language are the baseline here.
- `confidence-7866/regrade.mjs` (`gradeOf`, `bandOf`, `seriousSpans`): imported. The book grade A–D and its unit count are #7952's `book-grades.mjs` (open PR), restated unchanged in `book-grade-7263/lib.mjs`.
- `.claude/docs/ocr-difficulty-taxonomy.md`, `ocr-quality-measurement-loop.md`: stability is not accuracy, so the inconsistency family is a feature to be tested, never a label.
- Searched `scripts/eval/INDEX.md`, `EXPERIMENTS.md`, `gh issue list --search "book grade prediction"` and `"difficulty model"`: nothing predicts a judged book grade from features.

Code: `scripts/eval/book-grade-7263/`. Bulky and per-page output: `$JOB_SCRATCH/bgm` (never committed; Derek, 2026-11-04).

**Why.** Derek, 2026-11-04: a grade on every book; "machine learning can surely predict whether something will be easy to read with our data". Judging all 71,228 live books costs about 9 account-weeks at 1 page a book; the allowance is about 2 a month. **The decision this serves:** may unjudged books carry an *estimated* grade, or do book grades stay measured-only?

### 1. Labels (fixed; built by `labels.mjs` before any feature)

- **#7866**: 800 live rows, `verdictQuery({ lane: 'confidence-7866', run_id: 'confidence-validation-7866', kind: 'item' })`. 160 books × 5 pages, route judge (Opus), text as served.
- **severity-cal-7263**: the stored arm (S) of sitting 1, 60 books × 1 page (Sanskrit print, Chinese true print), same judge prompt. Read from that job's scratch (`key.json`, `route-s1.jsonl`); its rows are not in Mongo.
- **Step T never enters.** Other `origin: 'test'` rows enter only the sensitivity in §6.
- **The text the judge saw.** Every one of the 860 pages has it: the draw-time copy whose hash matches the verdict's (`texts/` from R2 `cold/l7a/leaf-screen-7866/…argon-inputs.tar.zst`; severity-cal's `sample.json`). 7 pages have been rewritten since; their features read the judged text, not today's.
- **judged-expand-7263** (864 books × 1 page, running now) is the second, later test. None of its books is in the labels (overlap 0). It is reported separately if it finishes; otherwise the check is said to be owed.

**Targets.**
- Page: sense errors = spans the judge weighed `misleads` or `wrong_text` (`seriousSpans`); rate per 1,000 units; **page "many"** = 3 or more on the page (`bandOf`'s split) or fidelity ≤ 2.
- Book: rate = Σ sense errors / Σ units × 1,000 over its judged pages. **Grade** (#7952): D if any page has fidelity ≤ 2; else A ≤ 1, B ≤ 5, C > 5 per 1,000. **Primary binary outcome "bad" = C or D.**
- Units: words for alphabetic scripts, Han/kana/Hangul characters ÷ 1.5, Tibetan syllables (#7952's `words()`). Every model carries the unit term (alphabetic / CJK / Tibetan), so rates in different units never pool without it.

### 2. Lockbox (sealed before any feature work)

- The 20% of the 220 label books with the lowest `sha256("bgm-7263-lockbox-v1:" + book_id)`: **44 books** (list sha256 `faf6e9af2c83ff1b1b487523c5568f371cd677b1b96e3155c00a530c79e57035`, `$JOB_SCRATCH/bgm/lockbox.json`).
- Its labels are not read by any fit, selection or plot until the final model is frozen in a commit. Then it is scored **once**, and the bars in §5 are read from it.
- Dev = the other 176 books. Every development number is out-of-fold on dev.

### 3. Features, by family (each family's contribution is reported)

All features come from the text as judged, the page image as judged, catalogue metadata, or reads that never saw a verdict. **Leakage rule:** no field derived from a verdict or written after the book's first `judged_at` (holds, `hidden_reason`, containment, withheld translations, router rows that pool these verdicts). Every field's date or provenance is listed in the results.

- **B: baseline**: language group, unit, served route (engine), print / manuscript / unknown. Ridge logistic, one-hot.
- **T: text of the stored read**: `<unclear>` marks per 100 units; tag mix (tags per 100 units, share of characters inside tags, distinct tag names); units, and units against the book's median page; repetition (share of repeated lines, longest repeated line run, zlib compression ratio, top-token share); characters outside the book language's scripts; character-trigram fit to the language (cross-entropy under a model built from the other books' sample pages in that language, never the book's own); word-list hit rate where a list exists in the repo; token-length mean, sd, share of 1-character and 16+-character tokens; hyphen at line end, mean line length, line count; page integrity (`<page-type>`, `<scan-quality>` value, model chatter, near-empty). Page values, and book means over the judged pages plus **20 other pages drawn from the book** (seed 72634; each page's text as it stood at the book's `judged_at`, from `page_revisions` when it has changed since).
- **I: image** (labelled pages only, the bytes the judge saw): pixel size, contrast (grey sd), blur (Laplacian variance), ink density (Otsu), skew (projection-profile peak over ±4°), line count and columns (projection profiles), gutter / spread (aspect and a central vertical valley), illustration share (dense dark blocks). Print vs manuscript is metadata.
- **M: metadata**: date (year, era), source library / provider, engine model string, p_route and the router's wrong-text rate for the route (`routerLookup` on today's table; it pools no verdict of #7866 or severity-cal), #7866's flag share, page type, pages in book.
- **R: inconsistency**:
  - `page_revisions` re-reads (sources `batch_api`, `ai`, `pipeline_preview` only; created before `judged_at`; a pair with word-Dice < 0.2 is a leaf shift and dropped): 1 − Dice to the judged text, same-model repeats reported apart; book median over judged + sample pages; an indicator for "no re-read".
  - **A fresh agy `gemini-3.8-flash-low` read** (`cli-ocr.mjs read`, kept through candidate-reads) of **2 of the 5 judged pages of each #7866 book** (seed 72632): 320 reads, cap **400** with retries. severity-cal's 60 fresh reads are reused, not repeated. Feature: 1 − word-Dice and character-level normalized edit distance, stored vs fresh. Gemini self-preference (#7866: it agrees with Gemini text) is reported by engine.

### 4. Models and validation

- **Small models only.** (a) L2 logistic for "bad", C from {0.03, 0.1, 0.3, 1} by inner grouped CV; (b) sklearn `HistGradientBoostingClassifier`, depth ≤ 3, ≤ 200 iterations, min leaf 10. **The final model is (a) unless (b) beats it by ≥ 0.02 in dev out-of-fold log loss.** Book rate: an L2 negative-binomial regression of Σ sense errors with offset log Σ units, dispersion by maximum likelihood.
- **Splits are by book, always**: 5-fold grouped CV × 5 repeats (seeds 72631+r). Also **leave-one-language-out** over languages with ≥ 5 dev books.
- **Family contribution**: B alone; B + each family; all; all minus each family. Out-of-fold AUC and log loss, with book-bootstrap 95% CIs (4,000, seed 72633).
- **Final features**: all families whose addition improves dev out-of-fold log loss; frozen in a commit before the lockbox is opened.

### 5. Bars (read from the lockbox; dev out-of-fold beside each)

| bar | pass when |
|---|---|
| book AUC for bad (C or D) | ≥ 0.75 (#7866's bar) |
| within-cell AUC | reported (7866: 0.57): zh Paddle manuscripts, and within Chinese, Sanskrit and Latin |
| calibration slope (logit of outcome on logit of prediction) | 0.8 to 1.2 |
| interval coverage: the book's observed Σ sense errors inside the NB model's central 90% predictive interval | 85% to 95% |
| false-reassurance rate: books called good (P(bad) < t) that are judged C or D | reported at every t; see §7 |

The lockbox holds about 32 #7866 books and 12 one-page books, so its AUC interval is about ±0.15. Book-level bars are scored on the books with ≥ 4 judged pages; the one-page books are scored on the page target. Both are stated with n.

### 6. Secondary analyses

- **Page-count curve.** For each dev #7866 book, two of its five pages (seed 72631) are a fixed target. The book's rate on them is predicted from the model prior plus k = 0, 1, 2, 3 of its other pages (gamma–Poisson update of the NB prior). Reported: held-out log predictive density and AUC for "a sense error on the pair", by k. Also: agreement of the grade estimated from the prior + k pages with the 5-page grade (k = 0, 1, 2, 5 = identity); and the Spearman–Brown step from #7866's ICC.
- **What a next judged page is worth, by uncertainty**: the k = 0 → 1 gain in held-out density, by tercile of the model's predictive entropy.
- **Page-level model**: AUC for page "many", out-of-fold.
- **Sensitivity (labelled, never pooled into a bar)**: other route-judge `origin: 'test'` rows with `selection: 'random'` whose judged text is the stored text, added to training; dev out-of-fold change. If no test row can be shown to be the stored text, not run, and said.
- **judged-expand-7263** (if finished): page "many" and one-page-book bad AUC, reported apart, by language seen / unseen in training.
- **What it cannot see**: one-off loops and wrong leaves (D) stay with detectors (`ocr-loop-guard`, leaf-alignment); the D share among false reassurances is reported.
- **Cost of scoring all 71,228 live books**: Mongo pages read, image bytes, CPU time per book and agy calls (if R is kept), measured on this run.

### 7. Decision rule

- **Estimated grades: YES** only if, on the lockbox, AUC ≥ 0.75, the slope is within 0.8–1.2 and coverage within 85–95%; and a threshold t exists at which dev out-of-fold false reassurance ≤ 15%. The recommendation then names t and the share of books it calls good.
- **Otherwise NO**: book grades stay measured-only. The model may still order which books to judge first (most uncertain, or most likely bad), and the record says which bar failed and what data would change it.
- No grade is shown anywhere by this job. No write to pages, books, `book_checks`, `rules.json` or `current.json`.

### Seeds

| purpose | seed |
|---|---|
| lockbox | `bgm-7263-lockbox-v1` (sha256 rank) |
| CV folds / page-count target pair | 72631 (+ repeat) |
| agy pages | 72632 |
| bootstrap | 72633 |
| book sample pages | 72634 |
