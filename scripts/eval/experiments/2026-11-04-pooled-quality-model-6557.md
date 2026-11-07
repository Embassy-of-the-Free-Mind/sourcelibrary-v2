---
stage: ocr
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 170
n_pages: 830
verdict: "FAIL by the preregistered rule. The pooled model beats a grand mean and the per-method rate on held-out log density for the 7866 draw (−228.2 vs −242.5 vs −286.0) and on the r6 OCR stage, but its book intervals cover 100% (too wide, target 90%) on every held-out set, and on r6 translation it loses to the grand mean by 0.06 nats."
status: rejected
decision: "Not adopted as a level estimator: no methods entry, no /quality change. Kept as a refittable eval tool; next test is differences within a round, not levels (#6557)."
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

### 1. The table (built 2026-11-04T11:13Z, read only)

Builder: `scripts/eval/estimator/pooled-quality/build-table.mjs` (projected reads of `book_checks`, `lane_judge_verdicts`, the ocr-convergence `decisions.jsonl.gz` files and the 7866 result files; writes `$JOB_SCRATCH/pooled-quality/*.json.gz`). Nothing is written to Mongo.

**Clean pages are recoverable.** For the REVIEWER.md methods, clean = `pages_read` minus `page_findings`. Checked against the evidence files: 924 of 924 pages agree (fortnightly 180, served-audit 200, shelf-overview 544). One shelf-overview run (28 rows, 112 Tibetan BL pages) had no `page_findings`; its pages were recovered from the evidence file by the same rule.

**Outcome mapping, per stage.** y = 1 when the method's own reader called the page serious at that stage. REVIEWER.md methods: the page's serious finding at that stage. judged-pages (lane verdicts): fidelity ≤ 3, the bar in `judge-verdicts-to-book-checks.mjs`. ocr-convergence: agree → 0 (two model families agree; no Opus read), keep / residual / write / defer → the adjudicator's stored serious call, contain → 1. Convergence has no translation stage. The serious bars differ by method; the method term is there to absorb that, and its offsets below are the size of the difference.

**Deduplication.** `judged-pages` rows in `book_checks` (1,070) and `ocr-convergence` rows (3,820) are copies; both are read at the source instead. This also drops the 789 `judged-pages` copies of the 7866 draw from training. Pages read by two methods in training after this: 1 (OCR), 1 (translation). The page effect is in the model but has almost nothing to fit.

**Exclusions (pages).**

| what | pages | why |
|---|---:|---|
| curation-check | 125 | hand-picked; 106 of 107 rows have no page findings |
| hide-broken-text | 78 | selected on the outcome |
| retranslation-gate | 21 | blind A/B of retranslation arms, Tibetan only |
| shelf-overview S1/S2 re-reads | 192 | same pages, same method (κ 0.9, #6174) |
| ocr-convergence q400–q1000 | 4,915 | disagreements decided without an Opus page verdict |
| ocr-convergence, no second read / pending | 89 | no outcome |
| lane_judge_verdicts drafts / wrong_page controls | 38 / 28 | not served text |
| lane_judge_verdicts without an Opus verdict | 3 | other reader |

**Training table.** OCR: 4,125 pages, 799 books — convergence 2,738 (943 serious), shelf-overview 656 (79), judged-pages lane runs 306 (45), fortnightly 225 (26), served-audit 200 (44). Translation: 1,111 pages, 458 books — shelf-overview 656 (109), fortnightly 225 (52), served-audit 200 (53), judged-pages siku 30 (10). Held out: H1 = `sprint-2026-10-25-r6`, 10 books, 30 pages (OCR 5 serious, translation 6). H2 = 7866, 160 books, 800 pages (208 serious OCR, fidelity ≤ 3).

**Staleness.** Text hash still matching the live text: OCR 3,918 fresh / 1,037 stale (convergence writes are stale by construction: the verdict caused the write); translation 1,020 / 121. Rows without a hash are counted stale. The primary fit uses the text as it was read; a fresh-only fit is the sensitivity (§3).

**Coverage.** Reads per language × print/manuscript against live pages are in the results JSON (`stages.*.coverage`, top 60 cells). The biggest cell, Chinese manuscript (1.59M live OCR pages), has 357 reads. Cells with live pages and no reads at all include Dutch print (64.8K OCR pages), Syriac print (29.6K), Spanish print (21.3K), Armenian (21.9K), Persian (7.1K), Ge'ez (10.8K), Nahuatl (12.1K), Danish print (5.8K). Their estimates are the writing-system and engine pooling alone.

### 2. The model

Per stage (OCR, translation), page outcome y = 1 when the method's reader called the page serious at that stage, else 0:

logit P(y) = μ + method (fixed, N(0, 1.5²)) + print/manuscript/unknown (fixed, N(0, 1.5²)) + writing system + language + engine + round + book + page

- Every term after the fixed ones is a Gaussian random effect N(0, s²) with its own s. Language is nested in its writing system. Round is nested in method. The page effect applies only to pages read more than once (two methods, or one method twice).
- The s's come from the Laplace marginal likelihood, as heldout.py does; the effects at those s's are the MAP with a Gaussian posterior. Hyperparameter uncertainty is not propagated. Stated beside every interval.
- **Anchor.** The reported level is the mean of the methods drawn at random from a frame and read with REVIEWER.md: shelf-overview, served-audit and fortnightly-spot-check, at a new round and a new book. Every other method's offset is reported against that anchor, with a 90% interval.
- **Poststratification.** Cells are language × print/manuscript × engine family. Each cell is weighted by its live pages (books `visible`, `pages_count > 0`, pages with OCR for the OCR stage, pages with an English for translation), counted on the frame date.

Fit: `scripts/eval/estimator/pooled-quality/fit.py` (numpy + scipy; sparse design, Laplace marginal likelihood over a log grid of the s's, MAP effects with a Gaussian posterior). Hyperparameter uncertainty is not propagated.

### 3. Results

**Every figure here is the Opus reading of quality.** Nearly every reader in the pool is Opus (the REVIEWER.md methods, the lane judge, the convergence adjudicator). Pooling narrows sampling error; it cannot see what Opus does not. Judge bias runs both ways, and nothing here measures it.

**Recovery check (run before the real fit).** 3 replicates × 2 stages on the real design, known effects: 27 of 27 method offsets inside their 90% interval; book and round scales back within ×2 in every replicate. The page scale is not identifiable (it falls to the grid floor: almost no page is read twice). Language and writing-system scales split poorly between themselves; their sum is recovered. `results/2026-11-04-recovery-sim.json`.

**Scales (OCR):** writing system 0.75, language 0.75, engine 2.0, round 0.75, book 2.0, page 0.05 (floor). A book scale of 2.0 on the logit is large: book is the dominant source of variation, as the 7866 ICC (0.38) said.

**Method offsets vs the anchor** (logit, 90% interval; anchor = mean of shelf-overview, served-audit, fortnightly):

| method | OCR | translation |
|---|---|---|
| shelf-overview | +0.04 [−0.65, 0.73] | −0.04 |
| fortnightly-spot-check | −0.48 [−1.17, 0.21] | +0.08 |
| served-audit | +0.44 [−0.42, 1.29] | −0.04 |
| judged-pages (lane runs) | +0.58 [−1.61, 2.77] | +1.82 [0.57, 3.08] |
| ocr-convergence | +1.34 [0.52, 2.17] | — |

The three REVIEWER.md methods agree with each other within their intervals once book, language and engine are accounted for. Convergence reads higher (it is drawn from disagreements; fresh-only: +0.71). judged-pages translation is +1.82 on 30 siku pages from one lane: a different bar (fidelity ≤ 3) on a hard shelf, not a measured reader difference.

**The held-out test** (summed log predictive density by book; book coverage of the 90% interval):

| set | n | P lpd | G lpd | M lpd | P cov | M cov | P passes? |
|---|---|---:|---:|---:|---:|---:|---|
| H2 7866, OCR | 160 books / 800 pp | **−228.16** | −242.53 | −286.04 | 1.00 | 0.844 | no: coverage |
| H1 r6, OCR | 10 / 30 | **−8.67** | −9.43 | −9.37 | 1.00 | 0.90 | no: coverage |
| H1 r6, translation | 10 / 30 | −9.81 | **−9.75** | −10.03 | 1.00 | 1.00 | no: lpd and coverage |

Set-level rate: H2 observed 0.26, P 90% [0.065, 0.596]; H1 OCR 0.167, P [0.033, 0.433]; H1 translation 0.20, P [0.10, 0.53]. All inside, all wide.

**Why it failed.** The coverage clause fails everywhere because P's book intervals are the whole range [0, n] for 141 of 160 H2 books, 6 of 10 H1 OCR and 8 of 10 H1 translation. Two things make them that wide: the book scale (2.0) and a new round (round scale 0.75, unknown sign). With n = 3 to 5 pages a book, an interval that holds 90% often has to span everything, so this clause partly measures n, not only the model; that was knowable before the fit and is a weakness of the criterion as written, not a reason to relax it after. M covers 0.844 on H2 by being narrow and wrong in a specific way: it misses the 25 books with 4 or 5 serious pages of 5 (H2 k: 0:71, 1:42, 2:12, 3:10, 4:13, 5:12). P's density gain there (+14.4 nats over G, +57.9 over M) is real: it knows which languages and engines run bad.

**By language, H2 OCR** (observed / P mean / M mean): Chinese 0.23 / 0.26 / 0.11; Latin 0.31 / 0.30 / 0.11; English 0.05 / 0.25 / 0.11; German 0.19 / 0.24 / 0.11; Tibetan 0.22 / 0.20 / 0.11; Greek 0.70 / 0.41 / 0.11. P is right on Chinese, Latin, Tibetan; it overstates English and understates Greek.

**Sensitivity, fresh text only.** OCR level 0.188 [0.10, 0.34] (all text 0.185). H2: P −230.4, G −251.2, M −295.2; coverage P 1.00, M 0.781. H1 translation: P −9.54 now beats G −9.75; still fails coverage. Same verdict.

**Poststratified levels (not licensed by the test; recorded so the next run can compare).** All-data fit, anchor methods, a new round and a new book, weighted by live pages on 2026-11-04T11:13Z (8,532,609 OCR pages, 5,760,372 translated; books `visible`, `pages_count > 0`). Share of pages an Opus reader would call serious under the REVIEWER.md bar, not a pass rate:
- OCR 0.185 [0.101, 0.316]; translation 0.275 [0.191, 0.382].
- Chinese OCR 0.082 [0.017, 0.637] (Paddle, 1.60M pages: 0.061 [0.003, 0.658]; Flash 3: 0.215; Lite: 0.307). Chinese translation 0.264 [0.098, 0.511] (Flash 3 0.319, Lite 0.371, agy 0.054 [0.005, 0.383]).
- Other languages: `stages.*.all_data.poststrat.lang` in the results JSON. The intervals are too wide for any public figure.

**Planted rows (n = 18; lanes agy-correct, pero, 7866).** The Opus lane judge rejected or flagged all 18, but scored only 9 of 18 at fidelity ≤ 3 (the serious bar): dropped line 4 of 4, wrong number 3 of 7, wrong noun 3 of 7. So the lane judge notices plants but under-grades about half of them below the serious bar; the pooled serious rate for judged-pages is, if anything, low. It says nothing about the REVIEWER.md methods (no plants there) or about errors every Opus reader shares.

### 4. Verdict and what would change it

**FAIL** on all three held-out sets by the coverage clause, and on H1 translation by density too (by 0.06 nats on 10 books; caveated as preregistered). The pooled model is the best predictor of WHICH books will run bad (H2 density), and its levels are not usable: a new round's level is too uncertain for a book-level or shelf-level interval anyone could act on.

What would change it:
1. **Report differences within a round, not levels across rounds.** The v1 report reached the same place: "ready on differences, not levels." A within-round contrast (language A vs B, engine X vs Y, read in the same round) cancels the round effect that makes these intervals wide.
2. **More rounds per method.** The round scale rests on a few rounds per method (the judged-pages offset on 5 lane runs). Each new round narrows it.
3. **Condition on the round when predicting books.** Given a few pages of the round itself (its realized rate), book intervals shrink to the book scale alone. A rerun of this test should preregister that variant.
4. **More pages per book where a shelf figure is wanted** (n = 3 cannot give a 90% interval narrower than everything at these rates).

**Proposed, not applied** (no public surface changed here): /quality could show, per language, the pooled ranking of languages and engines with the Opus caveat, once a within-round test passes. Not levels.

### 5. Refit

```
node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/estimator/pooled-quality/build-table.mjs
python3 scripts/eval/estimator/pooled-quality/fit.py --out <file>   # needs numpy + scipy; --fresh-only, --sim-only
```

New `book_checks` runs of an existing method are picked up (zh-held-quality-8053's shelf-overview rows, run `overview-2026-11-04-zh-held`, 48 rows, are already in). A NEW `method_id` (check-recorder-8069's lane rows) shows in the exclusions as "not mapped yet" until a mapping line is added in `fit.py` `build_table`; its serious bar must be stated there.

Artifacts: `scripts/eval/estimator/pooled-quality/results/2026-11-04-fit.json.gz`, `2026-11-04-fit-fresh-only.json.gz`, `2026-11-04-recovery-sim.json`. Opus reading throughout; frame 2026-11-04.
