---
stage: ocr
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 1084
n_pages: 1724
verdict: "FAIL on the preregistered rule. Lockbox AUC for a bad book 0.824 (bar 0.75) passes, but calibration slope 0.58 (bar 0.8–1.2) and interval coverage 97% (bar 85–95%) fail. On the later judged-expand test (864 one-page books) the model does no better than route + language (AUC 0.732 vs 0.732), and 46% of the books it calls good are judged C or D."
status: informational
decision: "Estimated grades: NO. Book grades stay measured-only. The model may be used only to ORDER which books to judge first; it never stands in for a grade."
feeds: figure
superseded_by: null
issue: [7263]
router_evidence: "none — no route compared; the router table is read for a feature (p_route) and never written"
defect_rates: "none — sense errors per 1,000 units are the TARGET, from verdicts already recorded by #7866, severity-cal-7263 and judged-expand-7263"
---
## 2026-11-04 · Can a small model predict a book's grade? Results (#7263)

Preregistration: `2026-11-04-book-grade-model-prereg-7263.md` (commit bfee08777, written before any feature). Code: `scripts/eval/book-grade-7263/`. Aggregates: `book-grade-7263/results/` (`dev.json`, `final-config.json`, `lockbox.json`, `expand.json`, `sensitivity.json`). Per-page features and predictions stay in `$JOB_SCRATCH/bgm` and are never committed (Derek, 2026-11-04).

PRIOR ART: same list as the preregistration. Extends `2026-10-31-confidence-validation-7866.md` (signal AUC 0.66; within one cell 0.57) and `2026-11-04-pooled-quality-model-6557.md` (failed on coverage).

**Short answer.** Text features predict a book's grade better than route and language do, and the model ranks books well inside the set it was built on. Its probabilities are not calibrated, though, and on books from a later, wider draw it is no better than route + language and calls too many bad books good. An estimated grade would mislead readers in the cases that matter most. **NO estimated grades.** The model is still useful for deciding which books to judge first.

### Labels

- Dev: 176 books (126 with five judged pages, 59 of them bad = C or D; 50 one-page severity-cal books). Lockbox: 44 books (34 five-page, 17 bad; 10 one-page, 9 bad), sealed by sha256 rank before any feature and opened once (commit abe40bfc3, after the freeze in 9d2b4709f).
- Later test: judged-expand-7263, 864 books × 1 page, 633 bad (73%). None of these books is in the labels. It was drawn by cell across 18 languages, many of them absent from training.
- Step T never enters. Units carry a script term throughout, so Han characters and words never pool.

### What each feature family added (dev, out-of-fold, 126 five-page books)

| model | AUC (bad) | 95% CI | log loss |
|---|---|---|---|
| B: route + language + unit + print/MS | 0.687 | 0.589–0.779 | 0.595 |
| B + T (text of the stored read) | **0.791** | 0.710–0.864 | 0.538 |
| B + I (image) | 0.669 | 0.565–0.767 | 0.641 |
| B + M (metadata) | 0.772 | 0.686–0.849 | 0.531 |
| B + R (re-reads + fresh agy read) | 0.788 | 0.706–0.860 | 0.549 |
| all | 0.829 | 0.757–0.894 | 0.490 |
| all − T | 0.783 | | 0.548 |
| all − I | 0.826 | | **0.486** |
| all − M | 0.812 | | 0.514 |
| all − R | 0.817 | | 0.512 |

- **Text (T) carries the most**, and it is free to compute. **Image (I) adds nothing**: on its own it is worse than the baseline, and dropping it improves log loss. **R's signal is mostly the fresh agy read** (`agy_ned`, the largest coefficient, +0.68), and that read costs a call per page.
- Largest standardized coefficients in the final model: agy disagreement +0.68, line count +0.62, year −0.52 (older books score worse), share of characters inside tags +0.52, route = lite +0.45.
- Final rule (prereg §4): B+T+M+R, logistic. HGB reached AUC 0.832 but its log loss was worse (0.525 vs 0.486), so the logistic model was kept. Dev: AUC 0.826 [0.755, 0.892], slope 1.05, NB dispersion α 1.05.
- Page level, AUC for a page with "many" errors: B 0.62 → B+T 0.748 → B+T+I+R 0.78 (680 pages).

### Bars

| bar | dev OOF | **lockbox (n=34)** | judged-expand (n=864, 1 page) |
|---|---|---|---|
| AUC bad ≥ 0.75 | 0.826 | **0.824 [0.671, 0.952] PASS** | 0.732 [0.693, 0.769] (baseline 0.732) |
| calibration slope 0.8–1.2 | 1.05 | **0.578 [0.29, 1.58] FAIL** | 0.52 [0.41, 0.63] |
| 90% interval coverage 85–95% | 0.921 | **0.971 [0.91, 1.0] FAIL (too wide)** | 0.968 |
| baseline (B) AUC | 0.687 | 0.754 | 0.732 |
| within cell: zh Paddle MSS | 0.667 (baseline 0.118; 7866 0.57) | 0.914 (12 books) | — |
| within cell: Latin | 0.865 (25 books) | 1.0 (4 books) | — |
| leave-one-language-out, pooled | 0.761 (baseline 0.488) | — | unseen languages 0.606 (baseline 0.600) |

- The interval coverage fails because the intervals are too wide, not too narrow. In 94% of dev books the lower bound is 0, so the interval cannot tell "fine" from "bad". This is the same failure pooled-quality-6557 had, only milder.
- Lockbox one-page books: AUC 0.556 (10 books, 9 bad).
- LOLO by language: Chinese 0.654, Sanskrit 0.643, Latin 0.885, German 0.80. On judged-expand: German 0.91, Dutch 0.84, Italian 0.80; Hebrew 0.52, Korean 0.54, Sanskrit 0.46 (`expand.json`).

### False reassurance (books the model calls good, P(bad) < t, that are judged C or D)

| t | dev: called good / FR | lockbox: called good / FR | expand: called good / FR (D among them) |
|---|---|---|---|
| 0.15 | 20% / 8% | 24% / 13% | 7% / 27% (6) |
| 0.20 | 23% / 7% | 24% / 13% | 11% / 39% (17) |
| 0.25 | 29% / 11% | 26% / 11% | 13% / 42% (23) |
| 0.30 | 31% / 13% | 29% / 20% | 16% / 46% (34) |

- On dev, a threshold with FR ≤ 15% exists (t = 0.25: 29% of books called good, FR 10.8%). On the later draw it does not exist at any t. The best case there is the B+T+M variant at t = 0.15: 4.4% of books called good, FR 16%.
- **The D grades among the called-good books are failures the model cannot see**: one-off loops, wrong leaves, a single page with fidelity ≤ 2. At t = 0.3 on expand there are 34 such books. Those failures stay with the detectors (`ocr-loop-guard`, leaf alignment); no book-level average catches them.

### Page-count curve (dev five-page books; two pages held out as the target, prior + k of the other three)

| k judged pages | AUC "any sense error on the held-out pair" | agreement with the 5-page bad/good call |
|---|---|---|
| 0 (model only) | 0.659 | 0.651 |
| 1 | 0.706 | 0.794 |
| 2 | 0.703 | 0.873 |
| 3 | 0.681 | 0.881 |

- One judged page is worth more than the model. With a flat prior, agreement is 0.468 / 0.817 / 0.897 / 0.889 at k = 0/1/2/3. The model prior helps only at k = 0; from one page on it is no better than a flat prior or the route + language baseline (0.556 / 0.833 / 0.905 / 0.897). The agreement column is partly circular, since the conditioning pages are among the five.
- **Held-out log predictive density falls as k rises** (−2.33, −2.36, −2.48, −2.56). The preregistered gamma–Poisson update treats a book's pages as Poisson draws from one rate. Pages vary within a book (#7866 ICC 0.38), so the update overreacts. As a result, the "value of the next page by uncertainty" tercile split (+0.000, +0.044, −0.118) cannot be read. A page-level dispersion term is needed before that question can be answered. Reported as found.
- Practical reading: **two judged pages buy about 87–90% agreement with a five-page grade, whatever the prior.** The allowance is better spent on one or two pages for many books than on a model estimate for all of them.

### Sensitivity (labelled, never in a bar)

- Adding 50 `served` books from zh-gemini-reocr-7263 (their text matched by hash; 40 bad) raises dev AUC 0.826 → 0.831 (B+T+M 0.817 → 0.822). router-v4-latin `served` rows carry no text hash, so they were not used. correct-vs-reread-7568 is Step T and was excluded.

### Deviations from the preregistration

- The NB regularisation λ was chosen by inner CV. The prereg named only the logistic C grid.
- The secondary variant B+T+M was added at the freeze (9d2b4709f), before the lockbox, because it needs no agy read and is the only variant that could score the whole corpus. It is labelled and is never the bar model. On the lockbox it did better (AUC 0.862, slope 0.96, coverage 0.971) but still fails coverage.
- judged-expand was scored by a model trained on all 220 label books (dev + lockbox, after the lockbox was read), with no agy feature for any expand book (imputed as missing). Its one-page label is noisier than a five-page grade.
- The page-count update is misspecified (above).

### Leakage and provenance

- Text features read the text the judge saw: the draw-time copy whose hash matches the verdict's (7 pages since rewritten are read as judged). The 20 sample pages per book use their text as of the book's `judged_at`, rebuilt from `page_revisions`.
- `page_revisions` re-reads come only from `batch_api`, `ai` and `pipeline_preview`, created before `judged_at`. Leaf-shift pairs (word-Dice < 0.2) are dropped.
- agy reads were made after the verdicts but never saw them. 319 of 320 succeeded (cap 400).
- Router `p_route` comes from today's table, which pools no verdict of #7866 or severity-cal. No hold, `hidden_reason`, containment or withheld-translation field was used.

### Cost of scoring all 71,228 live books (measured here)

- Mongo: about 1.7 s per book paced (864 books × ~21 pages in ~25 min), so about 34 h in a single paced stream on Hetzner. Not run through Vercel.
- CPU for text features: 26 s per 5.1K pages, so about 2 h for about 1.5M pages. Image features (0.16 s per page plus R2 bytes) are not in B+T+M and not needed.
- R needs about 2 agy reads per book = 142K reads, about 20 days at the observed ~5 per minute. Not practical. **B+T+M is the variant that could score everything, at $0 API.**

### What would change the answer

- Five-page judged books in the languages the model has not seen (Hebrew, Korean, Arabic, Japanese, Sanskrit print), so that calibration is fitted where the later draw found it broken.
- A page-level dispersion term (a beta-binomial or NB per page with a book random effect) before the page-count curve and the value of the next page are reread.
- A 3+-page subset of judged-expand books, to give a second lockbox with five-page grades rather than one-page labels.
- Even then, D grades from one-off failures stay with detectors. A model can lower the D rate among called-good books only if a detector feature covers that failure.

### Recommendation

**Estimated grades: NO** (prereg §7: slope and coverage fail on the lockbox, and false reassurance on the later test is 27–46%). Use B+T+M only to order the judging queue: judge first the books it is least sure of, or most expects to be bad. Spend the allowance on one or two pages for many books rather than five pages for a few.
