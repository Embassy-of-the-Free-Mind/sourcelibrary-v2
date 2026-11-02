---
stage: ocr
measure: [judged]
languages: [zh, la, en, de, bo, grc, fr, ko, ru, sa, ar]
scripts: [Latn, Hani, Tibt, Grek, Cyrl, Deva, Arab, Hang]
canons: []
n_books: 160
n_pages: 800
verdict: "#7866's 800 verdicts re-graded on the rubric's own four grades instead of its 2-of-5 pass/fail. Design-weighted, 43% of pages are fit to quote (38-51% CI), 8% fit to read, 24% carry a reading that changes the sense, 18% a span the page does not carry, 2.2% a span from somewhere else, 3.6% are substantially wrong and 1.5% are not this page at all. So half the pages say what the page says, a quarter mislead on a word, a quarter carry something the page does not have, and 1 in 60 is another page. Resampling every misleads/wrong_text tag from #6740's blind re-read matrix moves 'says what the page says' to 58% (56-60). By language: English 83% clean (0.9 severe defects per 1k words), Russian 93%, Tibetan 62%, Chinese 52%, German 51%, Latin 41%, Greek 20% (19.3 per 1k), Sanskrit and Korean 0% of 15 pages each. By reading method: LightOnOCR 10/10, Esukhia e-text 80%, IA djvu 65%, Paddle 55%, 3 Flash 48%, Flash-Lite 41%. 1,227 of 2,747 defects are one class, O6 (a word read as another word that exists); invention (O1+O4) is 97, concentrated in Greek, Korean and Sanskrit."
status: informational
decision: "/quality now leads with the distribution and reconciles the old 57% in prose; the rubric doc and content.ts no longer say section 5 has never been run. No routing change, no rules.json entry, no re-read, no model call: a re-score of stored verdicts."
superseded_by: null
issue: [7933, 7866, 7263, 6740, 5984]
router_evidence: "none — a re-grading of verdicts already exported as confidence-validation-7866.score.json; it adds no judged page and changes no k/n"
defect_rates: "scripts/eval/confidence-7866/results/served-grades.json"
---
## 2026-11-02 · Half the pages, not 57% of the books: #7866's draw re-graded on the published ladder, by language, with the defects named (#7933)

PRIOR ART:
- `scripts/eval/confidence-7866/analyze.mjs` and `results/score.json`: the **same 800 verdicts**. They answer #7866's question — does our stored confidence score predict a bad book — and report one binary per book (bad = ≥ 2 of 5 pages bad). Neither the page distribution nor any language cut is in them.
- `scripts/eval/confidence-7866/results/defect-rates.json` (#7824 weights): severity rates per 1,000 words by **stratum and study cell**, never by language, and never as a page grade.
- `scripts/eval/route-judge-6740/defect-rate.mjs` `words()` and the MQM 1/5/25 weights: imported, not restated.
- `scripts/eval/lane-judge-sampler.mjs` `exportScore`: pools the same records by (cell, route) for the router, which is a different unit from a reader-facing grade.
- `.claude/docs/quality-rubric-and-sampling.md` §5: defines the four grades, their severities and their rules. Defined since #5984, **computed on no sample until now**.
- Searched `scripts/eval/INDEX.md`, `gh issue list --search "grade ladder"`, `git grep fit_to_quote`: nothing grades a drawn sample on the published ladder.

Code: `scripts/eval/confidence-7866/regrade.mjs`. One model call: none. Reads `lane_judge_verdicts` and each page's stored text (word counts only), writes `results/served-grades.json`.

**Question (Derek, 2026-11-02).** "The quality center says that 57% of the books are ok and 43% are bad. That's misleading. Also, let's show the results by language, etc. and qualitatively understand what isn't right, if anything."

### 1. Why the one number misled

`/quality` led with *57% of the books you can read here passed a check of their transcription against the page images*, from #7866. That figure is two binarisations of a rich verdict:

- a **page** is bad if the judge did not accept it **or** tagged any `wrong_text` defect;
- a **book** is bad if ≥ 2 of its 5 drawn pages are bad.

Both thresholds are defensible and neither was stated on the page. Their joint effect is that one clearly printed word — *Egypt*, read as `IJgyjDt` (`69aebc460d3d5e01e132c454` p. 187, otherwise complete and in order) — counts against its book exactly as another book's text does. 83 of the 206 pages that counted bad under that rule have no `wrong_text` defect at all: their worst fault changes the sense of a word.

And the share is a point on a curve whose slope is the bar, not the corpus. #7263 corrected the same 800 verdicts for the judge's **misses** at a 1% CER page bar and got 93% of books bad (55–100%), 61% at a 5% bar. One point from that curve, quoted without the bar, is the misleading part.

### 2. The ladder (`regrade.mjs`, the rubric's §5)

A page's grade comes from the judge's own fields: its severities are MQM's (cosmetic = minor, misleads = major, wrong_text = critical) and its fidelity scale is in the prompt (1 = not this page's text at all … 5 = faithful and complete). §5's *not usable* is split into four, because a wrong word, an invented span, a half-missing page and another book's page are different failures and different fixes.

| grade | rule | pages | share, design-weighted (95% book bootstrap) |
|---|---|---|---|
| fit to quote | no defect, or ≤ 2 cosmetic | 352 | **42.8%** (37.9–47.6) |
| fit to read | ≥ 3 cosmetic, no major | 58 | 8.0% (6.0–10.2) |
| fit for search only | ≥ 1 misleads, no wrong_text | 184 | **24.2%** (21.0–27.7) |
| not usable · wrong span | ≥ 1 wrong_text, none from elsewhere | 143 | 17.7% (14.1–21.4) |
| not usable · from elsewhere | ≥ 1 wrong_text of O1/O2/O3/I1/T17 | 17 | 2.2% (1.2–3.3) |
| not usable · mostly wrong | fidelity 2 | 35 | 3.6% (2.2–5.2) |
| not usable · not this page | fidelity 1 | 11 | 1.5% (0.2–3.3) |

Collapsed to what a reader can act on: **50.8% (45.7–55.9) of pages say what the page says, 24.2% (21.0–27.7) carry a reading that changes a word's sense, 25.0% (20.6–29.6) carry something the page does not have.** About 1 page in 60 is not this page's text at all.

By book (weighted): 13.9% are clean on all five pages, 28.1% have only misleading readings, 24.8% have one page carrying something off, 19.4% two or more, 13.8% have a page substantially wrong or not its own.

### 3. The judge errs in both directions, and both are quantified

- **Over-flagging.** #6740 (`2026-10-30-defect-rate-router-6740.md` §"Calibration (steer 1 A)") re-read 80 of this judge's own tags blind, each by a fresh Opus call seeing only the quoted span and the page image: of 40 `wrong_text` tags, 28 held as wrong text, 4 as misleads, 3 cosmetic, 5 were the page; of 40 `misleads`, **17 were re-read as wrong text**, 8 held, 5 cosmetic, 10 were the page. Resampling every non-cosmetic tag from that matrix (4,000 draws, cosmetic tags carried unchanged, fidelity 1–2 pages kept as judged since the wrong-page controls validate that call):

  | | as tagged | after the blind re-read |
  |---|---|---|
  | says what the page says | 50.8% | **58.0%** (56.4–59.6) |
  | fit to quote | 42.8% | 47.7% (46.4–49.0) |
  | a reading that changes the sense | 24.2% | 5.3% (3.8–6.9) |
  | something the page does not have | 25.0% | 36.7% (34.8–38.6) |

  The misleads / wrong_text line is unstable, as #6740 said; the clean share is not. Read "roughly 42% of pages have at least one error that changes the sense", and do not lean on how it splits.
- **Under-flagging.** #7263: at a 1% CER bar on pages with a typed scholarly reference, sensitivity 0.42 on print (0.23–0.64) and 0.45 on Chinese manuscripts (0.29–0.62); specificity 0.88 and 1.00. These shares are not a ceiling on quality.
- **Size, in plain units** (#7263 §5): a machine read of printed pages carries 2.5 severe defects per 1,000 words by the judge proxy and 3.4 by a translation test (1.2 of which is that test's own noise); a **human-typed scholarly edition of the same pages carries 1.45 confirmed**. Machine reading is roughly 1.5–2× the human rate on print.

### 4. By language

Weighted within language. The draw was stratified by our own confidence, not by language, so a language's own share rests on its own books (3 to 59) and carries a wide interval; a 0% or 100% on three books means three books. The rate column counts defects, not pages: per 1,000 words for alphabetic scripts, per 1,000 Han characters for Chinese and Korean, per 1,000 syllables for Tibetan. **Not comparable across those units.**

| language | books | pages | says what the page says | changes the sense | not on the page | severe / 1k | wrong_text / 1k | reading method |
|---|---|---|---|---|---|---|---|---|
| Chinese | 59 | 295 | 52.1% | 23.0% | 24.9% | 8.48 | 3.44 | PaddleOCR-VL, 3 Flash |
| Latin | 28 | 140 | 41.4% | 29.9% | 28.7% | 6.16 | 2.03 | 3 Flash, Flash-Lite |
| English | 19 | 95 | **82.5%** | 12.0% | 5.5% | **0.93** | 0.32 | Flash-Lite, IA djvu, LightOnOCR |
| German | 15 | 75 | 50.8% | 33.0% | 16.2% | 4.00 | 0.78 | Flash-Lite, 3 Flash |
| Tibetan | 10 | 50 | 62.4% | 18.1% | 19.4% | 3.63 | 1.09 | Yig-dzin, Esukhia e-text |
| Greek | 6 | 30 | **20.0%** | 13.3% | **66.7%** | **19.28** | 9.08 | 3 Flash |
| French | 3 | 15 | 64.8% | 20.6% | 14.6% | 4.47 | 0.79 | Flash-Lite |
| Korean | 3 | 15 | **0%** | 13.3% | **86.7%** | 17.78 | 8.89 | Flash-Lite |
| Russian | 3 | 15 | **93.3%** | 6.7% | 0% | 0.16 | 0 | Flash-Lite |
| Sanskrit | 3 | 15 | **0%** | 34.4% | **65.6%** | 30.89 | 13.24 | Flash-Lite |

Below three books, and so left out of the table but inside the totals: Arabic 2/10 (0% clean, 25.2 per 1k), Armenian 2/10 (40%), Italian 2/10 (30%), Danish 1/5 (80%), Dutch 1/5, Demotic 1/5, Yucatec Maya 1/5, Latin-English 1/5.

**The spread is the finding.** The library is not uniformly 57% good. English and Russian print is largely clean; Latin, German, Chinese and Tibetan sit in the middle; Greek, Sanskrit, Arabic and Korean are poor, and those are exactly the cells a cheap general model read and nothing has re-read. Two of them (Greek, Sanskrit) #7866 had already flagged in passing; this puts a number on them.

By reading method (pages, share clean, severe per 1k):

| method | books | pages | says what the page says | severe / 1k |
|---|---|---|---|---|
| LightOnOCR, our GPU (English pre-1800) | 3 | 10 | 100% | 0 |
| a typed edition (Esukhia Derge) | 3 | 15 | 80.0% | 0.48 |
| the Internet Archive's own OCR | 6 | 20 | 65.0% | 2.42 |
| PaddleOCR-VL | 58 | 278 | 55.0% | 7.12 |
| Gemini 3 Flash | 72 | 290 | 47.6% | 7.27 |
| Yig-dzin | 7 | 31 | 48.4% | 5.46 |
| **Gemini Flash-Lite** | 37 | 138 | **41.3%** | **9.44** |

Flash-Lite is the worst method in the draw and the one with the widest reach. That is a measured case for Derek's 2026-10-29 steer to retire it, on served pages rather than test pages.

### 5. What is actually wrong: 2,747 defects by class

1,304 cosmetic, 849 misleads, 594 wrong_text, on 207,581 words.

| class | name | total | cosmetic | misleads | wrong_text | mostly in |
|---|---|---|---|---|---|---|
| O6 | meaning-changing misread | **1,227** | 296 | 592 | 339 | Chinese 340, Latin 229, Greek 170 |
| O8 | silent normalisation | 272 | 238 | 30 | 4 | German 95, Latin 69 |
| E2 | the instruments lie | 242 | 229 | 13 | 0 | Latin 62, English 48 |
| O11 | page furniture mis-tagged | 206 | 172 | 27 | 7 | Chinese 150, Latin 18 |
| O12 | marginalia and apparatus | 174 | 123 | 43 | 8 | Chinese 69, Tibetan 40 |
| O5 | silent omission | 168 | 49 | 53 | 66 | Chinese 81, Latin 32 |
| O16 | self-reported tags wrong | 124 | 110 | 14 | 0 | Chinese 50, Latin 30 |
| O7 | numerals, dates and units | 79 | 12 | 27 | 40 | Chinese 28, Latin 14 |
| O1 | confabulation | 68 | 0 | 4 | 64 | Greek 24, Latin 16, Chinese 13 |
| T6 | catchword and seam | 33 | 28 | 3 | 2 | Latin 15, German 12 |
| O10 | secondary script garbled | 30 | 11 | 10 | 9 | Demotic 11, Chinese 7 |
| O4 | block repetition | 29 | 3 | 0 | 26 | Chinese 11, Tibetan 8 |
| O17 | table structure | 14 | 2 | 8 | 4 | Chinese 8, French 3 |
| I3 | spread not split | 13 | 6 | 6 | 1 | Greek 5, Dutch 4 |

Read off it:

1. **Nearly half of everything found is one class.** O6 is a word read as *another word that exists*: `欽定四庫全書` → `金定四庫全書`; *Egypt* → `IJgyjDt`; a subscript dropped from an integral so η₁ reads as η. It is the class that defeats proof-reading by fluency, because the output is fluent.
2. **Outright invention is rare and local.** O1 + O4 is 97 defects, 90 of them `wrong_text`, concentrated in Greek (27), Korean (14) and Chinese (24) — the scripts the serving engine reads badly. In Korean a tail turns into thousands of repeats of `됴히`; in Greek a whole line is replaced by plausible Greek that is not on the leaf.
3. **The long tail is the furniture of an early printed page**, and it is mostly cosmetic: running heads set as body text, signature marks (`n ij`) dropped, footnote numbers read as `l` or `+` or as an apostrophe (which silently turns *Rhys Davids* into a possessive), catchwords doubled into the text, long s written out where the reference keeps it. 1,304 of 2,747 defects mislead no one.
4. **Numbers are the sharp edge for scholarship.** O7 is only 79 defects but 40 of them are `wrong_text`: `三元九司` → `三九九司`, and the unit *li* dropped so "ten *li* square" reads "ten square". A reader cannot see these without the leaf.
5. **O16 says the page's own self-report is unreliable** (110 cosmetic): `<script>handwritten</script>` on a printed woodblock, invented catchwords. That matters because other lanes read those tags.

### 6. Limits

- One judge, Opus, on every verdict. No person has checked any of the 800. §3 bounds its error in both directions from two separate studies, neither of which is a human calibration of *these* pages.
- The draw was stratified by confidence, so every by-language and by-method number is a by-product of that draw, not a designed sample of the language. Small cells are small.
- Transcription only. The English is not graded here.
- The blind re-read matrix (§3) comes from 80 defects across all of #6740's corpus, not from these 800 pages, and did not cover cosmetic tags.
- `words()` counts Han characters for Chinese and Korean and tsheg syllables for Tibetan, so the per-1,000 column is three different units.

### Reproduce

```
node --env-file=.env.production.local scripts/eval/confidence-7866/regrade.mjs
```

Writes `scripts/eval/confidence-7866/results/served-grades.json` only. `/quality` imports that file at build time, so a new month's draw moves the page when the file moves.
