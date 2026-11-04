---
stage: ocr
measure: [judged]
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "PREREGISTERED, not yet fitted. The criterion below was committed before any fit."
status: undecided
decision: "pending the held-out test"
feeds: figure
supersedes: []
superseded_by: null
issue: [6557, 6174]
router_evidence: "none — page verdicts of the spot-check methods; no route compared and rules.json is not read"
defect_rates: "none — serious page or not, per stage; no defect classes are fitted"
---
## 2026-11-04 · Does one model pooled over all the spot checks predict a check it has not seen? (#6557)

PRIOR ART:
- `scripts/eval/estimator/heldout/heldout.py` (#7878): the partially pooled logit (Gaussian random effects, Laplace marginal likelihood, hyperparameters on log grids) and its held-out scoring. It pools ROUTE acceptance from a router table. Here the unit is a PAGE verdict from `book_checks`, with a book effect, so the model is refitted on a sparse page design (numpy/scipy). The scoring follows heldout.py: held-out log predictive density, by book.
- `router-table/pooled_prior.py`: the same model as a router prior. It is not reused: it has no page or book level.
- `scripts/maintenance/judge-verdicts-to-book-checks.mjs`: `judgedTextIsLive` (the staleness rule for lane verdicts) and the judged-pages serious bar, fidelity ≤ 3. Both imported or restated unchanged.
- `scripts/eval/methods/*.md`: each method's frame, reader and "serious". The mapping in §1 follows them.
- `2026-10-31-confidence-validation-7866.md`: ICC 0.38 for book quality. This is why the book effect is required.
- Searched `scripts/eval/INDEX.md`, `EXPERIMENTS.md` and `gh issue list --search "pooled"`. Nothing fits one model across the `book_checks` methods. `methods/README.md` says "rates are never pooled across methods" (#6174). That rule stands for adding counts. This entry tests a model with a method effect.

**Why.** Derek, 2026-11-04: "why not pool the methods? or have a method that is pooled from all our spot checks?" Today each check answers only for its own frame. A thin shelf with 16 reviewed pages ignores everything we know from its neighbours.

### Preregistration (committed before any fit)

**Held out.** Two sets, each removed from the fit and predicted:
- **H1**: the newest fortnightly-spot-check round in `book_checks` at fit time (today `sprint-2026-10-25-r6`, 10 books, 3 pages each). Both stages.
- **H2**: the `confidence-7866` draw (160 books, 5 pages each, lane `confidence-7866` in `lane_judge_verdicts`). OCR stage only. Its `judged-pages` copies in `book_checks` are dropped from training too (they are the same verdicts).

**Models compared**, each predicting every held-out book's count of serious pages k out of n:
- **(G) grand mean**: one beta-binomial over training books (mean and concentration by marginal likelihood), per stage.
- **(M) plain per-method rate**: the same beta-binomial fitted on the training books of the held-out set's own method only (fortnightly rounds before r6 for H1; the judged-pages lane runs for H2).
- **(P) pooled**: the model in §2, predicting a new round of that method for each book. A book's effect comes from training when another method read the book; otherwise it is a new draw.

**Scores.**
1. Summed held-out log predictive density of each book's k of n (book = unit), per set and stage.
2. Book-level coverage: the share of held-out books whose k falls inside the model's central 90% predictive interval (the discrete interval holding at least 90%).
3. Set-level: whether the held-out set's observed serious-page rate falls inside P's 90% interval for that set's rate.

**Pass rule.** P passes on a set when BOTH hold:
- its log density beats both G and M on that set;
- its book coverage is at least 0.80 and at least as close to 0.90 as M's.

P passes overall when it passes on H2 and on every H1 stage. H1 is 10 books, so a loss there is reported as a failure, with that caveat. A pass licenses a methods entry, a results JSON and a refit command. It licenses no change to /quality or any public surface.

**Recovery check, also before any real fit.** Simulate outcomes on the real design from known effects (method offsets, round, book, language and engine scales), refit, and report whether each known method offset lies inside its 90% interval and whether the scales come back within a factor of 2.

### 1. The table

(filled after the build)

### 2. The model

Per stage (OCR, translation), page outcome y = 1 when the method's reader called the page serious at that stage, else 0:

logit P(y) = μ + method (fixed, N(0, 1.5²)) + print/manuscript/unknown (fixed, N(0, 1.5²)) + writing system + language + engine + round + book + page

- Every term after the fixed ones is a Gaussian random effect N(0, s²) with its own s. Language is nested in its writing system. Round is nested in method. The page effect applies only to pages read more than once (two methods, or one method twice).
- The s's come from the Laplace marginal likelihood, as heldout.py does; the effects at those s's are the MAP with a Gaussian posterior. Hyperparameter uncertainty is not propagated. Stated beside every interval.
- **Anchor.** The reported level is the mean of the methods drawn at random from a frame and read with REVIEWER.md: shelf-overview, served-audit and fortnightly-spot-check, at a new round and a new book. Every other method's offset is reported against that anchor, with a 90% interval.
- **Poststratification.** Cells are language × print/manuscript × engine family. Each cell is weighted by its live pages (books `visible`, `pages_count > 0`, pages with OCR for the OCR stage, pages with an English for translation), counted on the frame date.

(results after the fit)
