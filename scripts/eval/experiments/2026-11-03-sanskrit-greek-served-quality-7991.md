---
stage: ocr
measure: [judged]
languages: [sa, grc]
scripts: [Deva, Newa, Gran, Beng, Taml, Grek]
canons: [sanskrit]
n_books: 70
n_pages: 70
verdict: "On 30 live Sanskrit and 40 live Greek books, one served page each, judged with #7866's judge as on /quality: Sanskrit 26.7 sense errors per 1,000 words [17.4–38.2], 6% of pages clean; Greek 13.0 [9.8–16.9], 29% clean. After a second reader checked each of the 848 serious calls, the figures fall to 11.3 [6.4–17.3] and 8.0 [5.5–11.0], and 32% and 36% of pages are clean. Manuscripts carry most of the error in both languages (Greek manuscripts before 1600: 9 of 10 pages substantially wrong). Printed Greek from 1600 on is good (2.1 per 1,000; English clean on 9 of 10). Seven pages whose text is not their leaf's were contained."
status: informational
decision: "No route, prompt or /quality copy changed (eval only). Seven pages in seven books were held and their English withheld (containment rule, #7991). The figures are offered for /quality's Sanskrit and Greek rows in place of the 3- and 6-book #7866 figures; wiring them in is a separate PR."
superseded_by: null
issue: [7991, 7866, 7933, 5813]
router_evidence: "none — a stratified draw of stored text; OCR engines were not randomly assigned (Greek and Sanskrit are mostly 3 Flash), so no route k/n is added"
defect_rates: "scripts/eval/sa-gr-served-7991/results/defect-rates.json"
---
## 2026-11-03 · How good is the Sanskrit and Greek a reader is served, on enough books to quote? (#7991)

PRIOR ART:
- `2026-10-31-confidence-validation-7866.md` and `scripts/eval/confidence-7866/regrade.mjs`. /quality's Sanskrit row (30.9 sense errors per 1,000 words, 0% clean) and Greek row (19.3, 20% clean) come from this study's 800 pages. But those pages fall in only 3 Sanskrit and 6 Greek books, 5 pages a book. This run uses the same judge prompt (`judgePrompt`, task `ocr`, via `judgeAbsolute`), the same `gradeOf()` and `bucketOf()`, and the same `by_language` row shape. It draws one page from each of 70 books.
- `2026-11-02-latin-strata-why-latin-struggles-7947.md` (`scripts/eval/latin-strata-7947/`). From it come the judged vs confirmed modes, `kindOf()` for the error kinds, and `run-reviews.sh` for the second reader. That study is Latin, uses REVIEWER.md and draws 3 pages a book. This one keeps #7866's judge so the figures stand beside /quality's other languages.
- `2026-11-02-translation-on-7866-draw-7968.md`. That entry judged the English on #7866's pages with a different rubric. Here the English is judged with the same `judgePrompt` in its translation form, so both lanes use one severity scale.
- `scripts/eval/spot-check/SECOND-READER.md`, unchanged. `redact-rights.mjs` was not needed: no output here carries a `rights_flag`.

**Question.** /quality's Sanskrit and Greek figures each rest on a handful of books, and pages within one book are close to a single observation. What are the served rates for live books with a by-book interval, which strata carry the error, and is it the transcription or the English?

### Method

- **Frame** (`sa-gr-served-7991/draw.mjs`, read-only). Live books (`visible`, `pages_count > 0`, `pages_translated > 0`) in Sanskrit (331) and Greek (1,119), minus the 9 books #7866 drew.
  - Strata come from the catalogue: form = `book_class.class` (handwritten → manuscript; printed, mixed or none → print), and for Greek also the year (< 1600 | ≥ 1600). 18 undated Greek books (2,389 translated pages) fall outside the era cells and were not drawn.
  - Frame translated pages by stratum: Sanskrit manuscript 4,706 (83 books), print 76,450 (245); Greek manuscript < 1600 103,376 (273), manuscript ≥ 1600 4,249 (12), print < 1600 101,425 (251), print ≥ 1600 229,106 (559).
- **Draw.** Seed 7991. 15 + 15 Sanskrit books and 4 × 10 Greek books.
  - Within a stratum, books were drawn with probability ∝ `pages_translated` (Efraimidis–Spirakis keys), then one page uniformly from the book's eligible pages. Eligible means #7866's `eligiblePage()`, English longer than 20 characters, at least 40 OCR words, and served (`isVisiblePage`).
  - **Amendment (same day, before any rate was read).** The first draw used `eligiblePage()` alone, which admits soft-hidden pages (negative `page_number`) that no reader sees. It took three of them. Each was replaced by a uniform redraw from the same book's served pages (`draw.mjs --replace`). Rejection inside a book keeps the draw uniform over served pages.
  - The same gap is in #7866's draw: 7 of its 800 pages have `page_number ≤ 0`.
- **Weights.** A page stands for its catalogue stratum's translated pages divided by the pages drawn in it. The language rows are weighted; the cuts are unweighted. Sanskrit print carries 94% of the Sanskrit weight.
- **Judges.** All are Opus 5.5 via `claude -p` on the subscription ($0 API), and all are blind: a call sees the language, one text and the image, never the stratum, the engine or the other lane's verdict.
  - Form and script are read off the image by a separate call (`judge.mjs form`).
  - Transcription: `judgeAbsolute`, which is #7866's call unchanged (`judge.mjs ocr`).
  - English: `judgePrompt` task `tr`, with the transcription as source and the image as the authority (`judge.mjs tr`).
- **Second reader** (`second.mjs`; `run-reviews.sh` with SECOND-READER.md). The claims are every `misleads` or `wrong_text` defect from either lane, plus every fidelity ≤ 2 call: 848 claims on 67 pages, in 14 packets, all answered.
  - Verdicts: confirmed 495, misclassified but still serious 41, real but not serious 288, not an error 13, cannot tell 11.
  - CONFIRMED mode keeps confirmed and misclassified claims as serious. A real-but-not-serious claim becomes cosmetic, and a fidelity call downgraded that way becomes fidelity 3. Not-an-error and cannot-tell claims are dropped.
- **Intervals.**
  - Weighted language figures and every per-1,000 rate: a bootstrap that resamples books within strata (4,000 draws). With one page a book, the book is the cluster.
  - A page share with k < 20 or n − k < 20: Wilson on k of n, as #7991 asks.
- **Leaf shift, then containment** (`leafshift.mjs`). Each page judged "not this page's text" (fidelity 1) was set against the book's served leaves N−8 to N+8 by one more Opus call, before containment (`.claude/docs/invariants/containment-on-finding.md`).

### Results: the transcription, on the #7866 bar (weighted; 95% intervals)

| | pages | words | clean (says what the page says) | text not on the page | sense errors per 1,000 words | wrong text per 1,000 |
|---|---:|---:|---|---|---|---|
| **Sanskrit, as judged** | 30 | 5,457 | 6% [0–19] | 49% [25–74] | **26.7** [17.4–38.2] | 10.7 [4.7–18.6] |
| **Sanskrit, confirmed** | 30 | 5,457 | 32% [13–57] | 43% [23–67] | **11.3** [6.4–17.3] | 6.2 [2.8–10.4] |
| **Greek, as judged** | 40 | 13,946 | 29% [13–45] | 46% [33–62] | **13.0** [9.8–16.9] | 7.5 [5.2–10.5] |
| **Greek, confirmed** | 40 | 13,946 | 36% [18–54] | 46% [33–62] | **8.0** [5.5–11.0] | 6.4 [4.3–9.0] |
| /quality today (#7866, as judged) | Sanskrit 3 books · Greek 6 books | | Sanskrit 0% · Greek 20% | | Sanskrit 30.9 · Greek 19.3 | |

The as-judged rows are the ones comparable with /quality, whose figures were never second-read.
- Sanskrit (26.7 against 30.9) agrees within the interval.
- Greek comes out lower (13.0 [9.8–16.9] against 19.3). #7866's 6 Greek books were not a draw of Greek.
- Second reading removes more than half the Sanskrit sense errors and 40% of the Greek ones. Most of what it removed was downgraded to "real but not serious", not refuted.

**By stratum** (confirmed, unweighted, k of n pages; Wilson when k < 20):

| stratum (catalogue) | n | clean | not on the page | fidelity ≤ 2 | sense errors per 1,000 [CI] | English clean |
|---|---:|---|---|---:|---|---|
| Sanskrit manuscript | 15 | 1 [1–30%] | 13 [62–96%] | 8 | 17.3 [10.9–28.1] | 0 [0–20%] |
| Sanskrit print | 15 | 5 [15–58%] | 6 [20–64%] | 1 | 10.7 [5.5–17.1] | 5 [15–58%] |
| Greek manuscript < 1600 | 10 | 0 [0–28%] | 10 [72–100%] | 9 | 16.3 [9.7–27.0] | 0 [0–28%] |
| Greek manuscript ≥ 1600 | 10 | 3 [11–60%] | 7 [40–89%] | 5 | 17.5 [5.9–33.1] | 4 [17–69%] |
| Greek print < 1600 | 10 | 4 [17–69%] | 5 [24–76%] | 1 | 7.8 [1.8–15.5] | 2 [6–51%] |
| Greek print ≥ 1600 | 10 | 5 [24–76%] | 2 [6–51%] | 0 | **2.1** [0.8–3.8] | **9** [60–98%] |

**Form on the image.**
- 4 of 70 catalogue forms were wrong. Three Sanskrit "print" books (Saravali, Bha Vigyanam, Jyotirvidabharanam) are paper manuscripts on the image, and one Greek "manuscript" (a Codex Sinaiticus facsimile) is a printed introduction.
- By the image's form (confirmed): Sanskrit manuscript 17.7 [11.5–27.2] (n = 18) against print 8.4 [3.2–14.9] (n = 12); Greek manuscript 18.7 [12.2–27.1] (n = 19) against print 4.8 [1.6–9.0] (n = 21).
- Two Sanskrit pages are cloth wrappers with a library slip. They are served pages with OCR, so they count.

**Śāradā.** None of the 30 Sanskrit pages is in Śāradā (Wilson 0 of 30: [0–11%] of the frame's pages at most). The draw found Devanāgarī on 25 pages, Newari on 3, Bengali on 1 and a South Indian script on 1 (palm leaves read as "likely Grantha, possibly with Tamil"; the second reader read them as Tamil). Those 5 non-Devanāgarī pages: 0 of 5 clean, 20.0 sense errors per 1,000 [8.9–42.5]. A Śāradā figure needs a targeted draw (the catalogue has no script field to stratify on).

**Greek and the #5813 re-read.** 7 of the 40 Greek pages were re-read on Flash by #5813, from an earlier lite read. They show 3.1 errors per 1,000 [1.1–5.7], 3 of 7 clean. The other 33 pages show 12.4 [8.3–17.4]. This is confounded: #5813 re-read printed books only, so the gap is mostly print against manuscript. On the one stratum that has both (print), it is not separable at n = 7.

### Which lane: transcription or English (confirmed)

| | Sanskrit | Greek |
|---|---|---|
| serious transcription errors | 80 | 158 |
| serious English errors | 111 | 131 |
| … of which the English follows a bad transcription | 11 | 39 |
| … of which are the translator's own | 100 | 92 |
| pages with a bad transcription | 24 / 30 | 28 / 40 |
| pages with bad English | 25 / 30 | 25 / 40 |
| pages with bad English on a clean transcription | 1 | 3 |
| English serious errors per 1,000 source words (weighted) | 14.4 | 7.2 |
| pages right end to end (both lanes clean, weighted) | 31% | 31% |

Error kinds (confirmed; `kindOf()`, counts of errors over pages):
- **Sanskrit.**
  - English, the translator's own sense errors: 82 on 23 pages. Example: "the page says mercury with half its weight of sulfur (sūtārdhagandhakaṃ) … for one yāma". The English drops or invents a passage 17 times on 10 pages.
  - Transcription: misread words 33 on 10 pages; numerals and citations 20 on 13; invented text 16 on 10 (all manuscripts).
- **Greek.**
  - Transcription: misread words 81 on 18 pages; numerals and citations 30 on 15; invented words 30 on 14 (manuscript minuscule: "the page reads ΟΠΤΑΖΗ; ΓΙΝΩΣΚΗ is invented").
  - English: the translator's own sense errors 79 on 20 pages; garbled transcription carried into fluent English 39 on 16.

**Fix lanes.**
- **Greek manuscripts** are a transcription problem. On Flash, 14 of 20 manuscript pages are substantially wrong (fidelity ≤ 2), with invented words in the minuscule. #5813 kept manuscripts out of its Flash re-read for this reason, yet 39 of the 40 Greek pages drawn, manuscripts included, are served from a Flash read.
- **Sanskrit** needs both lanes. Manuscripts are a transcription problem, as with Greek. But on Sanskrit print the English carries more serious errors than the transcription (13.5 against 10.7 per 1,000), and they are the translator's own. A re-translation lane for Sanskrit is warranted even where the transcription stands.
- **Printed Greek from 1600 on** is fit to serve in both lanes.

### Contained (by eye, this run)

The first judge gave fidelity 1, the second reader confirmed it, and the N±8 check was run. Each book was held (`invented-page-7991`, release when the pages are re-read and re-translated and checked against the image; one book was already held for another reason) and the page's English withheld (`withhold-stale-translations.mjs --by-eye-pages`, snapshot in `page_revisions`):

| book · page | what is stored | N±8 check |
|---|---|---|
| 69dfee7ece6bb8619e07ecfa · 164 (Aṣṭasāhasrikā) | a looping "he who sees X sees Y" formula | on no leaf |
| 69dfee81ce6bb8619e07efec · 153 (Aṣṭasāhasrikā, 2nd MS) | one five-skandha formula looped a dozen times | layout fits 153, the text does not |
| 6991d8ac8c1030b12444c781 · 147 (Kriyakandakramavali) | a generic Devanāgarī dharmaśāstra passage over a Newar-script Śaiva leaf | on no leaf |
| 6a08a3cffc6cdaefe240bd2c · 27 (Anaṅgaraṅga, palm leaf) | two invented paragraphs summarising Bible stories over Tamil-script leaves | on no leaf |
| 69906d0d64d44bd0a0ef5160 · 70 (Jyotisha Grantha) | the heading is right; the 27-column tables are invented progressions | the leaf is 70; the tables are not on it |
| 69ef251c85daccce30f2b1f2 · 26 (Bhagavad Gītā, 1823) | leaf 25's text (verses 1.20–23) | **leaf shift by one** (I1): the neighbours may be shifted too |
| 69b2f4140e2f024dfbfbadd2 · 247 (Pindar) | English of the Latin on leaf 249 | **English of another leaf** |

For the first six, the transcription stays on the page; only the English is withheld. Re-reading them is a priced row, not done here.
Not contained: the 14 Greek manuscript pages at fidelity 2. Their text is this leaf's, badly misread, with invented words. That is a quality finding, not the containment bar.

### Limits

- One model reads all three seats: the judge, the second reader and the leaf check. The judge's sensitivity at a 1% CER bar is 0.42 on print (`2026-11-01-judge-calibration-7866-bar-7263.md`), so it misses errors. Its serious calls are also over-severe: a third were downgraded here.
- This run had no planted or wrong-page controls. The instrument's controls are #7866's, and the prompt is unchanged from it.
- n is 10–15 books a stratum, so the stratum intervals are wide. The language rows are the figures to quote.

Code: `scripts/eval/sa-gr-served-7991/` (`draw.mjs`, `judge.mjs`, `second.mjs`, `leafshift.mjs`, `analyze.mjs`). Results: `results/served-7991.json`, whose `modes.<judged|confirmed>.by_language` rows are in `served-grades.json`'s `by_language` shape; `results/defect-rates.json`; run files in `results/run/` (`node scripts/eval/sa-gr-served-7991/analyze.mjs --out=scripts/eval/sa-gr-served-7991/results/run` reproduces the results byte for byte, except the date). Model calls: 73 form, 73 transcription, 107 English (duplicates from a restart; the first parsed verdict counts), 14 second-reader packets, 7 leaf checks. $0 API.
