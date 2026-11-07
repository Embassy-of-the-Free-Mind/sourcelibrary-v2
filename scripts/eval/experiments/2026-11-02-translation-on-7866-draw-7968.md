---
stage: translation
measure: [judged]
languages: [la, zh, de, en, bo, grc, sa, fr, ru, ko, ar, hy, it, da, egy, yua, nl]
scripts: []
canons: []
n_books: 102
n_pages: 481
verdict: "On the 481 of #7866's 800 pages that carry English (102 books), the Opus translation judge with the page image found a major English defect on 15.3% of pages [11.1–19.8] (0.52 per 1,000 English words [0.37–0.69]); counting a transcription misread too, 34.4% [28.8–40.1] of pages are wrong for a reader. Of the 77 pages with a major English defect, 56 sit on a transcription #7866 graded search_only or worse (71.8% weighted [59.9–82.7]), but 52.1% of pages with clean English do too; a major defect is 2.07× as likely on a bad transcription [1.29–3.76], so the transcription accounts for about 37% [13–61] of major-defect pages and the translator for the rest. Gate passed: swap 15/15, drop 15/15, repeat 15/15 within one."
status: informational
decision: "No route, prompt or page changed (eval only). Both fixes are needed and neither alone clears most major English defects: re-read then re-translate where the transcription is bad (Chinese on Paddle, Korean, Sanskrit, manuscripts), and a translation-side check for whole-passage errors (wrong page, imported or dropped passages), which occur on clean transcriptions. One wrong-passage English page found by eye is listed for containment on #7968; this run made no production writes."
superseded_by: null
issue: [7968, 7866, 5274, 7933]
router_evidence: "none — joins two verdicts on #7866's stratified draw of stored text; translation models and transcription routes were not randomly assigned to books, so no route k/n is added"
defect_rates: "none — this judge grades English defects minor/major, not misleads/wrong_text; major English defects per 1,000 English words by translation.model and by transcription route are in scripts/eval/results/translation-on-7866-draw/summary.json"
---
## 2026-11-02 · Translation grades on the #7866 draw: how much English error is inherited? (#7968)

PRIOR ART:
- `2026-11-02-ocr-error-to-translation-7611.md` (#7929): at the level of single errors, of 109 transcription errors confirmed against the image the English repairs 65% (56–73%) and carries 27% (19–36%). That entry follows each error into the English. This one is the page-level complement, weighted to the library: it starts from the English, finds the major defects and asks whether the page's transcription was bad.
- `2026-11-02-latin-strata-why-latin-struggles-7947.md` (#7947): Latin transcription weakness tracks the hand, not the age (manuscript 4.4 vs print 1.15 misleads + wrong_text per 1k). So the cuts below include hand as its own dimension, not only age band. Hand comes from #7866's `script_type` tags, which #7947 found unreliable (8 of 109 books reclassified on the image). These are tags, not readings of the hand.
- `2026-10-30-tca-wave2-dual-judge-5274.md`: the judge used here (JUDGE-PROMPT.md + IMAGE-ADDENDUM.md, Opus, 15-item packets) and its gate. On a fresh random draw it found 86.3% fidelity ≥ 4 and 13.6% of pages with a major defect.
- `2026-10-31-confidence-validation-7866.md` and `scripts/eval/confidence-7866/regrade.mjs`: the 800 transcription verdicts, the grade ladder and the book weights.

**Question.** Readers read the English. When the English on a page is wrong, how often was the transcription already wrong? The answer decides the fix: re-read and re-translate, or re-translate only.

### Method

- **Frame.** These are the 800 pages in `lane_judge_verdicts` (lane `confidence-7866`, run `confidence-validation-7866`). 481 pages carry live `translation.data` longer than 20 characters. The other 319 have no English and are logged one by one in `draw-log.json`, so all 800 are accounted for. The 481 pages come from 102 books and hold 182,241 English words. On all 481 pages the live transcription is the text #7866 judged (same `text_sha`). On 13 pages the English is older than the current transcription.
  English-language books are included: their "translation" is a modernisation.
- **Draw** (`draw-from-7866.mjs`). Each item is `{id, language, source = ocr.data, translation = translation.data}`, which is draw.mjs's item shape. Provenance, the #7866 grade, stratum and weight go in `manifest.jsonl`, never in the packet. Controls were built as draw.mjs builds them. Their pool is one other interior page from each of 60 books in the draw (never one of the 800), with ocr ≥ 200 and English ≥ 100 characters. There are 15 swaps (another page's English in the same language), 15 drops (the middle ~35% of units removed) and 15 repeats (a main item under a new id). draw.mjs takes one swap pair per language in one pass. This run needed three passes to reach 15, because the #7866 draw has fewer languages.
- **Judge.** `claude -p --model opus` on the box's subscription. The prompt is JUDGE-PROMPT.md + IMAGE-ADDENDUM.md (leading comments dropped) plus the two file lines, and nothing else. There were 36 packets of ≤ 15 items, 4 running at once. Each item has the served page image (`getPageSource`, ≤ 1800 px). All 526 verdicts parsed, and the judge reported every image as seen. $0 API.
- **Join** (`analyze-7866-join.mjs`). Definitions:
  - *major*: the English verdict carries a defect of severity major.
  - *misread*: the same judge set `ocr_misread` or `ocr_wrong_leaf` from the image.
  - *wrong end to end*: major OR misread.
  - *bad transcription*: #7866's grade (regrade.mjs `gradeOf`) is search_only or worse.
  - *inherited*: a major defect on a bad transcription.

  The headlines are weighted by the #7866 book weights, with regrade.mjs's stratified book-cluster bootstrap (4,000 draws; `shares` and `bootstrap` are imported). Cells are unweighted.

### Gate

| control | caught | need |
|---|---:|---:|
| swap (fidelity ≤ 2) | 15/15 | 14/15 |
| drop (omission flagged) | 15/15 | 13/15 |
| repeat (within one point) | 15/15 (13 exact) | 14/15 |

**PASS.** The two repeats that were not exact were a Chinese page (5 → 4) and a Latin page (2 → 3).

### Results (weighted to the #7866 frame, 95% book-cluster intervals)

**Translator** (English judged against the stored transcription):

| measure | value |
|---|---|
| fidelity distribution (pages, unweighted) | 1: 2 · 2: 21 · 3: 55 · 4: 220 · 5: 183 |
| fidelity ≥ 4 | 84.8% [80.3–89.0] |
| fidelity ≤ 2 | 4.5% [2.6–6.6] |
| pages with a major English defect | 15.3% [11.1–19.8] (77 pages) |
| major English defects per 1,000 English words | 0.52 [0.37–0.69] (102 defects; 0.56 unweighted) |

**End to end** (a reader's view):

| measure | value |
|---|---|
| wrong end to end (major OR the judge saw a misread) | 34.4% [28.8–40.1] (174 pages) |
| the judge saw a misread or wrong leaf | 25.3% [20.1–31.2] (130 pages) |
| major OR #7866 search_only or worse | 59.5% [53.5–65.6] (288 pages) |

**Agreement: this judge's `ocr_misread` against #7866's grade on the same page** (481 pages):

| | #7866 search_only or worse | #7866 fit to read or quote |
|---|---:|---:|
| ocr_misread true | 126 | 4 |
| ocr_misread false | 141 | 210 |

The observed agreement is 69.9%, Cohen's κ 0.43. When this judge flags a misread, #7866 agrees on 126 of 130 pages. It flags only 126 of the 267 pages #7866 graded bad. Against #7866's stricter class (wrong_span or worse) the agreement is κ 0.62 (97 both, 33 judge only, 41 #7866 only). The two instruments set different bars. #7866 read the whole page for any reading that changes the sense. The addendum asks for a misreading visible at this resolution, and to leave the flag false when unsure. So the misread flag is a floor, not a second full transcription grade.

**The inherited share.**

| measure | value |
|---|---|
| of 77 pages with a major English defect, #7866 bad | 56 — 71.8% [59.9–82.7] |
| the same, on pages with NO major English defect (base rate) | 211/404 — 52.1% [45.5–59.2] |
| P(major English defect \| bad transcription) | 20.0% [14.1–26.4] |
| P(major English defect \| good transcription) | 9.6% [5.2–14.5] |
| risk ratio | 2.07 [1.29–3.76] |
| share of major-defect pages the bad transcription accounts for (attributable fraction) | 37.1% [13.1–60.8] |
| inherited share using this judge's own misread flag instead of #7866 | 33/77 — 40.9% [28.0–55.0] |
| inherited share excluding the 13 pages whose English predates the transcription | 55/71 — 76.9% [66.3–87.1] |

The raw inherited share (72%) overstates what the transcription causes. Half the frame sits on a transcription #7866 graded search_only or worse, so a major English defect lands on such a page half the time by chance alone. The transcription doubles the risk of a major English defect: about 37% of major-defect pages are attributable to it, with a wide interval (13–61%). Of the two inherited-by-definition cases opened by eye below, one was made by the translator. This is an observational join. Books with bad transcriptions also differ in language, hand and route (Chinese on Paddle, Korean, Sanskrit, manuscripts), so the risk ratio is not a controlled effect of the transcription.

### Cuts
**By language** (unweighted; cells under 3 books listed, not rated)

| language | books | pages | fidelity ≥ 4 | pages with a major English defect | major per 1k English words | judge saw a misread | wrong end to end | #7866 search_only or worse | inherited (major on a bad transcription) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Latin | 27 | 125 | 91% | 10% (12) | 0.28 | 23% | 30% (37) | 58% | 8/12 |
| Chinese | 14 | 66 | 71% | 29% (19) | 0.89 | 47% | 58% (38) | 77% | 16/19 |
| German | 13 | 64 | 89% | 13% (8) | 0.49 | 19% | 28% (18) | 50% | 5/8 |
| English | 10 | 46 | 96% | 4% (2) | 0.29 | 9% | 13% (6) | 20% | 0/2 |
| Tibetan | 9 | 37 | 95% | 5% (2) | 0.14 | 5% | 8% (3) | 24% | 1/2 |
| Greek | 6 | 30 | 80% | 17% (5) | 0.58 | 50% | 57% (17) | 80% | 4/5 |
| Sanskrit | 3 | 15 | 27% | 73% (11) | 1.95 | 40% | 93% (14) | 100% | 11/11 |
| French | 3 | 15 | 100% | 0% (0) | 0 | 13% | 13% (2) | 33% | 0/0 |
| Russian | 3 | 15 | 87% | 27% (4) | 0.53 | 0% | 27% (4) | 7% | 0/4 |
| Korean | 3 | 13 | 38% | 62% (8) | 8.28 | 77% | 85% (11) | 100% | 8/8 |
| Arabic | 2 | 10 | not rated | (1) | | | (7) | | 1/1 |
| Armenian | 2 | 10 | not rated | (4) | | | (5) | | 1/4 |
| Italian | 2 | 10 | not rated | (0) | | | (6) | | 0/0 |
| Danish | 1 | 5 | not rated | (0) | | | (1) | | 0/0 |
| Demotic | 1 | 5 | not rated | (0) | | | (1) | | 0/0 |
| Yucatec Maya | 1 | 5 | not rated | (1) | | | (1) | | 1/1 |
| Latin-English | 1 | 5 | not rated | (0) | | | (0) | | 0/0 |
| Dutch | 1 | 5 | not rated | (0) | | | (3) | | 0/0 |

**By translation.model** (unweighted; cells under 3 books listed, not rated)

| translation.model | books | pages | fidelity ≥ 4 | pages with a major English defect | major per 1k English words | judge saw a misread | wrong end to end | #7866 search_only or worse | inherited (major on a bad transcription) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gemini-3-flash-preview | 47 | 218 | 81% | 18% (40) | 0.61 | 27% | 34% (74) | 52% | 35/40 |
| gemini-3.1-flash-lite-preview | 29 | 128 | 84% | 17% (22) | 0.72 | 25% | 38% (49) | 56% | 11/22 |
| gemini-3.1-flash-lite | 22 | 100 | 89% | 13% (13) | 0.37 | 28% | 38% (38) | 61% | 9/13 |
| gemini-3.8-flash-low | 8 | 25 | 96% | 4% (1) | 0.13 | 32% | 36% (9) | 60% | 0/1 |
| claude-opus-5-5 | 1 | 5 | not rated | (0) | | | (3) | | 0/0 |
| gemini-4-argon-low | 1 | 5 | not rated | (1) | | | (1) | | 1/1 |

**By transcription route (#7866 routeOf)** (unweighted; cells under 3 books listed, not rated)

| transcription | books | pages | fidelity ≥ 4 | pages with a major English defect | major per 1k English words | judge saw a misread | wrong end to end | #7866 search_only or worse | inherited (major on a bad transcription) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 3flash | 63 | 261 | 88% | 13% (33) | 0.35 | 23% | 32% (83) | 52% | 21/33 |
| lite | 30 | 117 | 81% | 19% (22) | 1.15 | 35% | 44% (51) | 65% | 18/22 |
| paddle | 13 | 58 | 69% | 31% (18) | 1.03 | 47% | 59% (34) | 76% | 15/18 |
| yigdzin | 6 | 18 | 94% | 6% (1) | 0.15 | 6% | 11% (2) | 33% | 1/1 |
| pipeline:derge-tengyur-import-5497 | 3 | 15 | 100% | 0% (0) | 0 | 0% | 0% (0) | 20% | 0/0 |
| model:claude-opus-5-5 | 2 | 6 | not rated | (1) | | | (1) | | 1/1 |
| yigdzin>agy-flash-low | 1 | 4 | not rated | (1) | | | (1) | | 0/1 |
| model:gemini-2.5-flash | 1 | 1 | not rated | (0) | | | (1) | | 0/0 |
| pero>agy-flash-low | 1 | 1 | not rated | (1) | | | (1) | | 0/1 |

**By hand (script_type tag)** (unweighted; cells under 3 books listed, not rated)

| hand | books | pages | fidelity ≥ 4 | pages with a major English defect | major per 1k English words | judge saw a misread | wrong end to end | #7866 search_only or worse | inherited (major on a bad transcription) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| print | 48 | 220 | 88% | 15% (32) | 0.45 | 23% | 34% (74) | 53% | 18/32 |
| unknown | 28 | 136 | 90% | 10% (13) | 0.31 | 22% | 27% (37) | 47% | 10/13 |
| manuscript | 30 | 119 | 69% | 26% (31) | 1.09 | 42% | 52% (62) | 71% | 27/31 |
| mixed | 5 | 6 | 83% | 17% (1) | 0.83 | 0% | 17% (1) | 50% | 1/1 |

**By hand tag × age band** (unweighted; cells under 3 books listed, not rated)

| hand | books | pages | fidelity ≥ 4 | pages with a major English defect | major per 1k English words | judge saw a misread | wrong end to end | #7866 search_only or worse | inherited (major on a bad transcription) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| manuscript · no date | 23 | 99 | 70% | 28% (28) | 1.11 | 44% | 54% (53) | 72% | 25/28 |
| print · 1501–1700 | 19 | 89 | 92% | 9% (8) | 0.2 | 24% | 29% (26) | 63% | 6/8 |
| print · 1701–1900 | 12 | 58 | 81% | 22% (13) | 0.9 | 12% | 33% (19) | 34% | 6/13 |
| unknown · 1501–1700 | 9 | 45 | 98% | 2% (1) | 0.07 | 24% | 24% (11) | 42% | 1/1 |
| unknown · 1701–1900 | 7 | 35 | 83% | 20% (7) | 0.78 | 6% | 23% (8) | 29% | 5/7 |
| unknown · after 1900 | 6 | 30 | 97% | 3% (1) | 0.16 | 7% | 10% (3) | 43% | 0/1 |
| print · before 1501 | 6 | 30 | 90% | 10% (3) | 0.39 | 43% | 47% (14) | 73% | 2/3 |
| print · after 1900 | 5 | 25 | 80% | 24% (6) | 0.8 | 28% | 44% (11) | 32% | 2/6 |
| print · no date | 6 | 18 | 94% | 11% (2) | 0.28 | 11% | 22% (4) | 56% | 2/2 |
| unknown · before 1501 | 4 | 16 | 81% | 13% (2) | 0.26 | 63% | 63% (10) | 100% | 2/2 |
| unknown · no date | 2 | 10 | not rated | (2) | | | (5) | | 2/2 |
| manuscript · 1501–1700 | 3 | 7 | 57% | 0% (0) | 0 | 0% | 0% (0) | 43% | 0/0 |
| manuscript · 1701–1900 | 2 | 7 | not rated | (3) | | | (4) | | 2/3 |
| manuscript · before 1501 | 2 | 6 | not rated | (0) | | | (5) | | 0/0 |
| mixed · 1501–1700 | 3 | 3 | 67% | 33% (1) | 0.88 | 0% | 33% (1) | 67% | 1/1 |
| mixed · no date | 1 | 2 | not rated | (0) | | | (0) | | 0/0 |
| mixed · 1701–1900 | 1 | 1 | not rated | (0) | | | (0) | | 0/0 |

**By age band (books.published)** (unweighted; cells under 3 books listed, not rated)

| age | books | pages | fidelity ≥ 4 | pages with a major English defect | major per 1k English words | judge saw a misread | wrong end to end | #7866 search_only or worse | inherited (major on a bad transcription) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1501–1700 | 29 | 144 | 92% | 7% (10) | 0.18 | 22% | 26% (38) | 56% | 8/10 |
| no date | 29 | 129 | 74% | 25% (32) | 0.92 | 40% | 48% (62) | 68% | 29/32 |
| 1701–1900 | 21 | 101 | 80% | 23% (23) | 0.94 | 10% | 31% (31) | 35% | 13/23 |
| after 1900 | 11 | 55 | 89% | 13% (7) | 0.44 | 16% | 25% (14) | 38% | 2/7 |
| before 1501 | 12 | 52 | 87% | 10% (5) | 0.32 | 54% | 56% (29) | 83% | 4/5 |

**By #7866 grade** (unweighted; cells under 3 books listed, not rated)

| #7866 | books | pages | fidelity ≥ 4 | pages with a major English defect | major per 1k English words | judge saw a misread | wrong end to end | #7866 search_only or worse | inherited (major on a bad transcription) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| fit_to_quote | 67 | 175 | 91% | 9% (16) | 0.36 | 1% | 9% (16) | 0% | 0/16 |
| search_only | 71 | 129 | 85% | 16% (20) | 0.48 | 22% | 33% (42) | 100% | 20/20 |
| wrong_span | 53 | 108 | 77% | 22% (24) | 0.64 | 69% | 75% (81) | 100% | 24/24 |
| fit_to_read | 30 | 39 | 87% | 13% (5) | 0.39 | 8% | 21% (8) | 0% | 0/5 |
| mostly_wrong | 12 | 22 | 50% | 50% (11) | 2.05 | 77% | 95% (21) | 100% | 11/11 |
| from_elsewhere | 7 | 8 | 75% | 13% (1) | 0.68 | 75% | 75% (6) | 100% | 1/1 |


Only the language, route and hand cells with enough books say anything. Sanskrit (3 books, 11 of 15 pages major, all on bad transcriptions), Korean (3 books, 8 of 13) and Chinese (14 books, 19 of 66, 16 of them inherited) carry most major defects per word, and nearly all of them sit on bad transcriptions. Latin (27 books, 12 of 125 pages, 0.28 per 1k) and German (13 books, 8 of 64) are lower, and there a larger part is translator-made. Pages whose hand is tagged manuscript have 1.09 major per 1k against 0.45 for print. 27 of their 31 majors are on bad transcriptions, which is the same direction as #7947. The age bands cannot be separated from hand and language: "no date" is mostly manuscripts. On the 175 pages #7866 graded fit_to_quote, 16 still carry a major English defect (9.1%). These are translator-made by construction.

By translation model, the cells differ in language mix and are not comparable as models. Gemini 3 Flash has 18% of pages major (218 pages, 47 books), Flash-Lite preview 17%, Flash-Lite 13% and Gemini 3.8 Flash-low 4% (25 pages, 8 books).

### By eye (the page image opened for each)

1. **Counted as inherited, made by the translator.** Arati Phaenomena (incunable), `69af48642a821385be062737` p. 19. #7866 grade wrong_span. *By eye:* the leaf reads `circūflagratibus astris`, `Fluxat pilæ`, `ob res at mobile`, and the transcription has `circūfusa grādibus`, `pepli`, `ac`: the judge's misread note is right. Those misreadings reach the English only as minor slips ("surrounded by stars in degrees", a garbled "slippery age of footprints"). The one major defect is on a line the transcription has right. `Sponte sua` (of their own accord) is printed clearly and transcribed correctly, and the English renders it "Without their own will". This page counts as inherited under the definition, but its major error is the translator's.
2. **Inherited.** Aristophanes, Comoediae (Vat. gr. 2181, manuscript), `69a5e3d7006a4098422165d4` p. 126. #7866 grade wrong_span. *By eye:* the first line of the left page reads `τί φέρεις; βοιω. ὅσ᾽ ἐστὶν ἀγαθὰ βοιωτοῖς ἁπλῶς` (Acharnians 873, "What are you bringing? — All the good things of Boeotia"). The transcription has `τί φέρεσ βοῦ; οὐκέτι λησθῆ βοιωτοῖσι καλῶς`. The English builds "What are you carrying there, you great ox? … Put down your burden gently, Boeotians!" on the garble, and adds a note inventing an ox comparison for the Boeotian dialect. The major defect comes from the misread.
3. **Translator-made, on a clean transcription.** Corpus Medicorum Latinorum V (Marcellus), `69af49c4d6be7ec9cc3246fd` p. 83. #7866 grade fit_to_quote. *By eye:* the leaf is p. 41, `IIII 28—62`, ulcer remedies (`Radix peponis … sanat ulcera`, `Carcinomata curantur coagulo leporis`), and the transcription matches it line for line. The stored English is a different passage: dandruff and lice remedies, then "CHAPTER V ON CATARRHS OF THE HEAD". None of the page's ulcer remedies appear. A reader sees English that is not this leaf's text.
4. **Clean.** Laurentii Medicis Magnifici Vita (1784), `6991fb158ffe22e92ae4e615` p. 101. #7866 fit_to_quote, fidelity 5. *By eye:* notes 58–60 and Pandolfini's Italian letter of 1 March 1478 match the leaf. The English follows them clause by clause: the Pisa Studio moving to Pistoia because of plague, the bishop's request for a papal brief, Hody's *De Graecis illustribus*.

Case 3 is wrong-leaf English seen with the image open. The containment rule (`.claude/docs/invariants/containment-on-finding.md`) says to hold the book and withhold the page in the same run. This job's brief forbids production writes, so it is reported on #7968 for a session to contain. It is not withheld here.

### Limits

- One judge, no person has checked these verdicts beyond the four pages above. Wave 2 measured this judge's major-defect rate on a fresh draw (13.6%). Here it is 15.3% on a frame that over-weights low-confidence books.
- The frame is #7866's: 5 pages a book, stratified by a confidence score, then cut to the 60% of pages that have English. Pages without English are not missing at random (319 of 800; 290 of them from 58 books with no English on any of their judged pages). The weighted figures describe translated pages of the #7866 frame, not the whole library.
- `bad transcription` is #7866's judgment. Its judge misses errors (sensitivity 0.42 on print at a 1% CER bar, `2026-11-01-judge-calibration-7866-bar-7263.md`), so some majors counted translator-made may sit on transcriptions that are bad but not flagged.
- `score.mjs`'s `corpus_estimate` in `report.json` weights languages by the summed #7866 book weights of kept pages, not by live translated pages. Use `summary.json` for the headline.

Artifacts: `scripts/eval/translation-corpus-audit/{draw-from-7866,analyze-7866-join}.mjs`; `scripts/eval/results/translation-on-7866-draw/` (`manifest.jsonl`, `items.jsonl.gz`, `draw-log.json`, `images.json`, `verdicts/opus/`, `report.{json,md}`, `summary.json`). `regrade.mjs` now exports `shares`, `bootstrap`, `STRATA`, `eraOf`, `LANE`, `RUN` (no behaviour change).
