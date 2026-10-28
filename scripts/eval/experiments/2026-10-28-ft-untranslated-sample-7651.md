---
stage: metadata
measure: [judged, agreement]
languages: [la, lzh, de, fr, it, es, nl, grc, he, ar, fa, syr, sa, bo, ja, ko]
scripts: []
canons: []
n_books: 350
n_pages: null
verdict: "About 75% of untranslated live non-English works (23,700, 95% CI 21,300–26,100; ≈33,100 books) have no English translation known to an unprimed search. The share runs from 86% for Chinese and 82% for Latin down to 30% for Greek."
status: informational
decision: null
superseded_by: null
issue: [7651]
---
PRIOR ART: round 5 (`scripts/eval/results/ft-pilot-round-5.md`) and the #4617 excluded stratum measured
the TRANSLATED pool and an unsplit tail. Neither broke the result down by language or period, and neither sampled the untranslated pool one book per work.

## 2026-10-28 · How many untranslated books would be FIRST English translations, by language group and period?

**Who this is for.** Anyone choosing what to translate next. It also answers anyone asking "how many first English translations does Source Library hold, or could it hold?"

**Design (pre-registered in commit 7450dd67e, before any search).**
- **Frame:** live books (`visible && pages_count>0`) with no translated page and a language that is not English. That is 43,608 books in 31,645 works. A book with no `work_id` counts as its own work. 2,940 English-language books are excluded.
- **Strata:** seven language groups. We drew 50 works per group with seed 7651 and took one random book from each work.
- **Search:** one unprimed `claude -p` Sonnet per book, run on the subscription. The brief is `results/ft-untranslated-7651-brief.md`, adapted from `r5-oracle-brief.md`. Each searcher first identified the work from OUR scan (OCR text of the first pages, or the page images). It then searched for a published English translation. A 6-search floor was added after a 2-book pilot. A positive-control query was required before any `no_prior_known`. The searcher never saw our cards, attempts or badges.
- **Verdicts:** `no_prior_known` / `prior_exists` / `partial_only` / `not_a_single_work` / `identity_unresolved` / `already_english` / `could_not_search`. The last one, "could not ask", stays out of the rate denominator. It occurred 0 times.
- **Controls:** 10 books from reviewed `prior_exists` cards, mixed blind into the run order.
- **Re-judge:** 20 random sample books, re-run by Opus in fresh processes that never saw the first verdict.
- **Estimator:** stratum rate × stratum frame. Wilson CIs per stratum. Works use a normal CI with finite-population correction. Books use a ratio estimator (each work weighted by its books in the frame) with a stratified bootstrap (2,000 reps). Period rates are post-stratified on the drawn book's edition year.
- **Cost:** $43.77 API-equivalent for the first pass (360 calls), $6.21 for the re-judge (20 Opus calls). Subscription only; the box account's week went 79% → 81%.

### Untranslated pool — by language group (measured, n=50 each)

| group | no prior known (works) | works | books (ratio est.) | prior exists | partial | not a single work | identity unresolved |
|---|---|---|---|---|---|---|---|
| Latin | **82%** [69–90] | 17,347 of 21,155 | 17,935 of 22,747 | 4% | 4% | 8% | 2% |
| Chinese | **86%** [74–93] | 740 of 860 | 9,015 of 10,450 | 8% | 6% | 0% | 0% |
| German | **66%** [52–78] | 3,784 of 5,733 | 4,129 of 6,079 | 6% | 2% | 26% | 0% |
| French/Italian/Spanish/Dutch | **56%** [42–69] | 1,030 of 1,839 | 1,042 of 1,935 | 28% | 6% | 10% | 0% |
| Greek | **30%** [19–44] | 106 of 352 | 112 of 414 | 52% | 0% | 12% | 4% |
| Hebrew/Arabic/Persian/Syriac | **40%** [28–54] | 415 of 1,038 | 415 of 1,078 | 24% | 14% | 12% | 10% |
| Sanskrit/Tibetan/Japanese/Korean/other | **38%** [26–52] | 283 of 746 | 437 of 905 | 26% | 10% | 16% | 4% |
| **Corpus** | **75%** | **23,705** [21,312–26,097] of 31,645 | **33,085** [28,821–36,328] of 43,608 | 8% | 4% | 12% | 2% |

Among single, identified works only (no_prior / (no_prior + prior + partial)), the no-prior share is: Latin 91%, Chinese 86%, German 89%, Fr/It/Es/Nl 62%, Greek 37%, Hebrew/Arabic/Persian/Syriac 51%, other 51%.

### Untranslated pool — by period of the edition (post-stratified)

| period | n | no prior known (works) | books |
|---|---|---|---|
| <1500 | 19 (thin) | 48% [6–80] | ≈670 of 1,389 |
| 1500s | 72 | 75% [60–88] | ≈7,750 of 10,324 |
| 1600s | 46 | 84% [69–96] | ≈8,600 of 11,182 |
| 1700s | 88 | 74% [54–89] | ≈5,060 of 6,815 |
| 1800s | 24 (thin) | 9% [1–33] | ≈110 of 662 |
| 1900+ | 12 (thin) | 6% [0–24] | ≈15 of 246 |
| unknown year | 89 | 82% [66–90] | ≈11,070 of 12,990 |

The period CIs are wide because a Latin draw carries ~420 works of weight and a Greek draw carries ~7. Read the period rows for direction only. The 1800s and 1900+ untranslated books are mostly editions of classics (Greek, Sanskrit, Persian) whose works are already in English.

### Instrument checks

- **Controls (blind, n=10):** 7 `prior_exists`, 1 `partial_only` (Paracelsus → Waite 1894), 1 `already_english`, 1 `identity_unresolved`. The `already_english` control was a 1920 Herodotus that is a Loeb Greek–English edition, so that control was mis-chosen. The `identity_unresolved` control (*Das Buch der Weisheit Salomonis*) failed because its six scanned images were all binding and flyleaves. **No control came back `no_prior_known`.** Strict recall on the 9 valid controls is 7/9, or 8/9 counting partial.
- **Re-judge (Opus vs Sonnet, n=20):** 18/20 exact agreement and 19/20 on the first / not-first call (κ 0.83). One disagreement is partial vs complete; the other is identity_unresolved vs no_prior_known.
- **"Could not ask" vs "asked, none found":** all 199 `no_prior_known` verdicts record a passing control query and `search_worked: true`. The median is 7 queries; 6 verdicts fell below the 6-search floor.
- **Identity source:** 142 books were identified from title-page text and 111 from page images. 97 were identified from the catalogue alone, mostly because the first six scanned pages were binding, endpapers and bookplates. The no-prior share is 63% where the scan identified the work and 40% where only the catalogue did. That gap reflects composition, not cause: catalogue-only books cluster in the Greek and other strata, where classics dominate.
- **Prior links:** 38 of 73 cited URLs answered 2xx/3xx from this box. openlibrary.org timed out throughout, and several citations are catalogue search URLs rather than item pages.

### Sensitivity

The controls missed about 1 in 5 priors, and they are famous works, which are easy to find. If the search misses priors at that rate across the sample, the true prior-plus-partial share rises from ~12% to ~15%. That takes ~1,100 works off the corpus total, about 3.5pp. Treat 23,700 works as an upper-leaning point estimate and ~22,600 as a recall-adjusted one. Both sit inside the CI.

### Translated side (no new searches; carried over and re-weighted)

The frame is today's 24,422 translated live books, minus 2,391 English-language books, which leaves 22,031. The rates come from three instruments that are never pooled. They are re-weighted to today's frame by language group × period (`results/ft-translated-side-7651.json`):

| group | books | fresh search #7598 (n) → no prior | est. books | round-5 Tier-1 (n) | reviewed cards (works) |
|---|---|---|---|---|---|
| Latin | 9,242 | 65% [62–68] (943) | 6,025 | 43% (141) | 62% (673) |
| Chinese | 2,519 | 83% [78–87] (273) | 2,031 | 30% (43) | 50% (40) |
| German | 2,684 | 69% [63–75] (212) | 1,898 | 42% (39) | 48% (165) |
| Fr/It/Es/Nl | 2,126 | 42% [36–49] (207) | 907 | 30% (46) | 45% (225) |
| Greek | 1,094 | 15% [9–22] (124) | 168 | 33% (24) | 62% (216) |
| He/Ar/Fa/Syr | 679 | 54% [42–66] (61) | 359 | 45% (22) | 29% (56) |
| other | 3,687 | 34% [29–40] (262) | 1,682 | 49% (175) | 71% (422) |
| **total** | **22,031** | **58%** [56–61] (2,082) | **13,071** | 41% (490) | 62% (1,699) |

| period | books | fresh search → no prior | est. books |
|---|---|---|---|
| <1500 | 2,402 | 37% (237) | 900 |
| 1500s | 4,051 | 51% (396) | 2,090 |
| 1600s | 5,489 | 65% (535) | 3,677 |
| 1700s | 3,906 | 66% (239) | 2,604 |
| 1800s | 2,200 | 36% (232) | 811 |
| 1900+ | 1,242 | 30% (123) | 442 |
| unknown | 2,741 | 94% (320) | 2,546 |

**Measured vs carried.** Of the 49 group × period cells, 17 are measured (≥30 fresh searches, 17,774 books). 17 are thin (10–29 searches, 3,345 books). 15 have fewer than 10 searches (912 books) and carry their group's rate.

The fresh search drew books by priority tier (never-searched first), not uniformly, and it has no `not_a_single_work` class, so its rate is not exactly comparable with the untranslated table. Round 5's oracle figure (8,565 of 16,151, 53%) applied to today's 22,031 gives ≈11,700. The fresh-search re-weight gives ≈13,100. Round-5 Tier-1 rows survive for only 490 of 1,165 books.

### Result

If everything in the untranslated pool were translated, ≈33,000 more books (≈23,700 works) would carry no English translation known to us. That is on top of ≈11,700–13,100 translated books that already do. Latin and Chinese hold about 80% of those books (26,950 of 33,085). Greek, the Near-Eastern languages and "other" are mostly works that are already in English. The Latin rate (82%) agrees with the #4617 excluded tail (76.7% ±7.6pp, n=120).

**Replicated?** In part. The Latin rate is consistent with #4617, and the re-judge agrees on the first / not-first call 19 times in 20. The language split itself is new.

**Artifacts:** `scripts/eval/ft-untranslated-sample-7651.mjs` (draw), `ft-untranslated-7651-prompts.mjs`, `ft-untranslated-7651-search.sh`, `ft-untranslated-7651-score.mjs`, `ft-translated-side-7651.mjs`. Results: `results/ft-untranslated-sample-7651-manifest.json`, `ft-untranslated-7651-verdicts.jsonl` (370 rows), `ft-untranslated-7651-scores.json`, `ft-translated-side-7651.json`. Measure-only: no book, card or badge writes.
