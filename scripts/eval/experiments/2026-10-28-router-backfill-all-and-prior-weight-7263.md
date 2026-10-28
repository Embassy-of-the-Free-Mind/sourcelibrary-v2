---
stage: ocr
measure: [judged]
languages: [la, bo, lzh, ar, it, es, ko, ru, pt, da, hi, enm, gmh, fro, ota, ta, tr]
scripts: [Latn, Tibt, Hani, Arab, Kore, Cyrl, Deva, Taml]
canons: []
n_books: 280
n_pages: 599
verdict: "Bookkeeping plus one fit, no model calls. Of 214 judged OCR and translation write-ups: 32 are (a) per-page accept and wrong-text calls against the image; 69 are (b) CER or 1-5 scores, 20 of which already feed v1 or v2; 61 are (c) other judged kinds; 52 are (d) not route tests. Of the 32 (a) files, 7 were already in the router table. Nine more go in now, six sources oldest first. Sixteen cannot go in, each for a stated reason. Two decisions change. Latin Flash-Lite goes from keep lite>opus to HOLD → lite>opus; one wrong-leaf book drives this, and without it the Opus correction is 0.98. Arabic Flash-Lite goes from HOLD → lite>opus to switch → opus-read; Opus judges its own read there, on other books. There are 15 new cells. The prior's weight, learned by empirical Bayes over the 15 routes that have both a v1/v2 prior and judged pages, is 7.0 pages, 90% [3.5, 14.5] (was 4 measured / 2 pooled by hand). Calibration slope 0.40 [0.20, 0.60]: the prior predicts the order of the routes but is too extreme. The weight alone changes no decision."
status: undecided
decision: "Router table rebuilt as scripts/eval/estimator/router-table/2026-10-28-backfill-all.md/.json (before: 2026-10-28-backfill). rules.json prior.pages_measured = pages_pooled = 7 (fit_prior.py). It is a proposal: ocr-routing-table.json and translation-routing-table.json are untouched (hold list). Next: the Latin wrong-leaf book is a containment case, not a corrector failure; the Arabic opus-read switch needs the two Opus routes on the same books before anyone routes on it."
superseded_by: null
issue: [7263, 6740, 5924, 6553, 7341, 6567, 6361]
router_evidence: [latin-lite, latin-flash3, arabic-lite, tengyur-tr, zh-siku-tr, italian-lite, spanish-lite, korean-lite, russian-lite, portuguese-lite, danish-lite, hindi-lite, middle-english-lite, mhg-lite, old-french-lite, ottoman-lite, tamil-lite, turkish-lite]
---
## 2026-10-28 · Every earlier image-judged route test into the router table, and a learned prior weight (#7263)

PRIOR ART: `2026-10-28-router-table-backfill-7263.md` (#7606) ingested the 10-27/28 tests and set the conventions kept here unchanged: the score.json schema, per-source book weighting, wrong text = misleading, and the shape of a new cell. `router-table/evidence/derive_backfill.py` is its derive script; `derive_backfill_all.py` is the same job for the earlier tests. `scripts/eval/estimator/ocr/failure-observations.jsonl` holds some of these k/n as hand-copied rate rows for the failure model. It is not router evidence. The prior's 4 / 2 pages were set by hand in #7417; `loo_v1.py` / `loo_v2.py` score v1/v2 against their own references, not against acceptance.

**Why.** Derek, 2026-10-28: "we've run hundreds of tests and they aren't part of the estimates?" and "I'm surprised that the previous findings wouldn't update the priors".

### Part 1: the gap

There are 472 dated write-ups. 214 have stage ocr or translation and a judged measure (`experiment-header.mjs needsRouterEvidence`, #7609); that is the brief's 213 plus #7606's own entry. Four readers classified a quarter each, and every (a) was checked by hand against its stored verdict files. The per-file table is on #7263.

| class | files | what happens |
|---|---|---|
| (a) per-page accept / wrong text against the image, by route | 32 | 9 ingested now (6 sources), 7 already in the table, 16 not ingestable |
| (b) typed-reference CER / accuracy, or a 1-5 / 0-5 score | 69 | not acceptance. 18 feed the v2 translation model (xlref t1-t5, 5606, 6182, 6331, 6545, 6690, 6729); 2 feed the v1 OCR model; 49 feed nothing |
| (c) other judged kinds (better / same / worse, prompt-only, judge calibration, catch rates) | 61 | not ingested |
| (d) not a route test | 52 | count only |

- #6545 and #6729, named in the brief as candidates, are (b): 1-5 fidelity against source and reference. Both already feed v2 translation.
- #6865 is (b) and feeds nothing.
- The #6561 candidate is (a) by shape but is not ingested: it has a Gemini judge, and 5 of the 5 "invented" calls checked by eye were printed text.
- #6560 is (b) or (c), except the flash-pass production audit, whose pages were drawn only from those the correction changed.

### Part 2: ingested, oldest first (one commit each)

The rules are in `rules.json evidence_rules`:
- An Opus judge, against the image, with accept and wrong text split.
- The lane's frame, not a set selected for difficulty.
- Stored per-page verdicts.
- Another prompt or model enters as its own route.
- The same route under another prompt or model vintage enters at weight 0.5. Here that means a fresh Flash-Lite read standing in for the stored drafts (#6553, #7341).
- Sources drawn from the same books form one `book_group`, scaled together.
- Every judged reading counts once; a reading a packet copied from an earlier step does not count again.

Before the rules.json changes, `build.py` with the two new options reproduces 2026-10-28-backfill on every row.

| source | cells, routes | accepted (book weight) |
|---|---|---|
| #6361 Tengyur CLI gate (10-10) | new tengyur-tr (nothing waits) | agy Flash-low v13 16/21, stored 3 Flash 11/21 (7 volumes) |
| #6567 Siku retranslation pilot (10-12) | new zh-siku-tr (50,676 pages, the 10-12 census) | agy Flash-low v13 26/30, stored English 12/30 |
| #5924 served Latin pages (10-22) | latin-lite lite, latin-flash3 3flash | 9/12 (4 books), 22/24 (8 books) |
| #5924 Latin 250, Step C / C2-C5 (10-23/24) | latin-lite, all 4 routes incl. a new agy-flash-low-read; book group 5924-latin with the pilot and router-test reads (the same 10 books) | readings: lite 421/690, Opus correction 659/750, agy correction 405/500, agy read 448/500 |
| #6553 untested cells (10-25) | 13 new language cells (lite at weight 0.5; agy read where measured) | see below |
| #7341 Jabir MSS + Kraus (10-25/26) | arabic-lite: lite (weight 0.5), new agy-flash-low-read-diplomatic and opus-read (#6544 READ prompt) | MSS (13 books): lite 17/26, agy 8/26 (16 reads never came), Opus 26/26; Kraus (1 book): 28, 27, 29 of 29 |

**Decisions that change** (against 2026-10-28-backfill):

1. **Latin Flash-Lite: keep lite>opus ⇒ HOLD → lite>opus.** The Opus correction falls to 0.85 [0.69, 0.96]. One of the 10 books is another leaf's text on all 25 pages. The correctors CONTAIN it, so lite is served, and every reading of those pages is misleading. Without that book the Opus correction is 659/675 (0.98). This is a containment case (`containment-on-finding.md`), not a corrector failure. The agy correction is 0.80 and the agy read 0.83.
2. **Arabic Flash-Lite: HOLD → lite>opus ⇒ switch → opus-read.** opus-read is 55/55 (14 books), 0.94 [0.82, 1.00], against the correction's 0.77. Opus judges its own read there, and the two Opus routes were measured on different books (held Jabir manuscripts against #7568's terminal books). Measure both on the same pages before routing on it.

**New cells.** All 13 language cells come from #6553 (one page a book; the lite reads at weight 0.5). The other two are tengyur-tr and zh-siku-tr.

| cell | pages waiting | routes (judged) | decision |
|---|---|---|---|
| tengyur-tr | 0 | agy@1 16/21, 3flash 11/21 | HOLD → agy@1 |
| zh-siku-tr | 50,676 | agy@1 26/30, stored 12/30 | HOLD → agy@1 |
| russian-lite | 18,952 | lite 23/28, agy read 26/28 | **switch → agy-flash-low-read** |
| korean-lite | 16,580 | lite 4/28, agy read 16/28 | HOLD → agy read |
| ottoman-lite / tamil-lite | 131 / 225 | lite 3/10, 6/10; agy read 8/10, 9/10 | HOLD → agy read |
| italian, spanish, portuguese, danish, hindi, middle-english, mhg, old-french, turkish | 50 – 46,950 | lite only (lowest: MHG 1/10, Turkish 4/9; highest: Hindi 10/10, Danish 9/10) | HOLD → lite |

**Not ingested (a).**
- Already in the table: the route-judge pilot, router tests, Tibetan 30, Tibetan translation router, #7517, and #7568 waves 1 and 2.
- Kept out under #7606's convention: #7567 (its own job), #7522, #7503, #6740 pages-per-call, #7558 ("usable" with neighbour images, no wrong-text count), and #6560 flash-pass production (changed pages only).
- Verdicts not in the repo: the three #6948 audits, and #5100 NDL (which also had one unblinded reader).
- Selected frame: #5313 (disagreement pages, a retired prompt) and #6567's English gate (CER bins).
- Gemini judge: #6388 tables and #6561 gate.
- #6388 random QA: two-family adjudication, any-span "material", and no cell has its frame.
- #5664 Mongolian: a probe, nothing accepted, no cell.

### Part 3: the prior's weight

`fit_prior.py` takes the 15 tested routes whose prior comes from v1/v2, with the book-scaled k of n the posterior uses. It models p_i ~ Beta(m_i W, (1 − m_i) W) and k_i ~ Bin(n_i, p_i), and finds W by maximum marginal likelihood.

| fit | routes | W (pages) | profile 90% | bootstrap 90% |
|---|---|---|---|---|
| **all (used)** | 15 | **7.0** | [3.5, 14.5] | [3.4, 25.8] |
| measured inputs | 5 | 4.3 | [1.4, 12.5] | [1.7, ∞] |
| pooled inputs | 10 | 10.5 | [4.1, 29.2] | [5.3, 25.8] |

- **One weight for both.** Splitting by input type gains 0.52 log-likelihood for one more parameter, so the data do not support the hand-set rule that pooled priors are worth half.
- **Calibration.** logit(acceptance) = 1.2 + 0.40 [0.20, 0.60] × logit(prior mean). The prior predicts the order of the routes, but its means are too extreme and too low. It is not a zero-information prior.
- **One misfire dominates.** v1 gives Latin Flash-Lite 0.035, its P(passes the absolute CER floors), against 0.65 judged. That is a different quantity from acceptance. Without that route W = 14.9; leaving out any other route moves W between 6.5 and 8.2.

Posterior mean [90%], old weight (4 / 2) → new (7 / 7), same evidence. This shows every route with a model prior that moved by more than 0.005; the rest are unchanged.

| route | prior | judged | old | new |
|---|---|---|---|---|
| latin-lite / lite | 0.04 | 447/732 | 0.51 [0.32, 0.70] | 0.44 [0.27, 0.62] |
| latin-lite / lite>opus | 0.80 | 689/780 | 0.86 [0.69, 0.97] | 0.85 [0.69, 0.96] |
| latin-flash3 / 3flash>agy | 0.94 | 23/30 | 0.78 [0.65, 0.89] | 0.80 [0.68, 0.90] |
| german-lite / lite>opus | 0.89 | 272/280 | 0.94 [0.87, 0.99] | 0.94 [0.87, 0.98] |
| german-flash3 / 3flash>opus | 0.87 | 29/29 | 0.99 [0.96, 1.00] | 0.98 [0.93, 1.00] |
| french-lite / lite>agy | 0.86 | 27/29 | 0.93 [0.84, 0.98] | 0.92 [0.83, 0.98] |
| tibetan-yigdzin / >agy, >opus | 0.78, 0.72 | 53/60, 52/60 | 0.88, 0.86 | 0.87, 0.85 |
| zh-paddle-dice / paddle>opus | 0.64 | 26/30 | 0.85 [0.74, 0.94] | 0.82 [0.71, 0.91] |
| untested: chinese-flash3 / 3flash>opus | 0.76 | — | 0.76 [0.23, 1.00] | 0.76 [0.47, 0.96] |

**Flips from the weight alone: none.** The weight narrows the untested routes most (they carry only the prior), which moves the test-next scores. The proposed tests are now latin-lite agy-flash-low-read (every route there is now tested, so the table names the one with the largest share × variance), latin-flash3 3flash>opus, and chinese-flash3.

**Files.**
- `scripts/eval/estimator/router-table/evidence/`: `derive_backfill_all.py` and the eight new score.json files.
- `rules.json`: evidence_rules, two stages (agy-text@1, opus-read@1), 15 cells, evidence on latin-lite, latin-flash3 and arabic-lite, and the prior's `_learned` note.
- `build.py`: book_group, weight, and prior_model / eff in the JSON.
- `fit_prior.py`.
- `2026-10-28-backfill-all.{md,json}`.
