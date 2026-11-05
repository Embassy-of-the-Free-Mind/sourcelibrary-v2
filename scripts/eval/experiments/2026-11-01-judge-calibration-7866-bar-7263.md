---
stage: ocr
measure: [judged_vs_reference]
languages: [de, en, la, zh]
scripts: [Latn, Hani]
canons: []
n_books: 100
n_pages: 100
verdict: "At #7866's own bar, scored from typed references of the same pages, the judge misses more than half the bad pages: sensitivity 0.42 on print (0.23 to 0.64) and 0.45 on Chinese manuscripts (0.29 to 0.62); specificity 0.88 and 1.00. Corrected for that, the share of #7866's books with at least 2 of 5 bad pages rises from 43% (36 to 51%) to 93% (55 to 100%) at the 1% page bar, 82% at 2% and 61% (26 to 93%) at 5%. So '57% of books passed' is too high at any of these bars. Errors that change meaning: machine print reads carry 3.4 per 1,000 words (2.1 to 5.1) by the translation test, of which 1.2 (0 to 2.9) is the test's own noise, and the judge-only proxy gives 2.5 (1.5 to 3.8). Human-typed editions of the same 60 pages carry 1.4 confirmed (0.6 to 2.7). On Classical Chinese the translation test is noise: translating the same reference twice differs as much (12.6 per 1,000) as read against reference (11.2)."
status: informational
decision: "No routing or /quality change here (rules.json, current.json and /quality copy untouched, as briefed). The /quality wording is a DECISION for Derek (end of #7263 job report). The calibration is not fed into the router: it measures the judge's page call at the #7866 bar, and the router's k/n uses acceptance, whose calibration (#7880) stands."
superseded_by: null
issue: [7263, 7866, 7880]
router_evidence: "none — stored reads of served books judged to calibrate the JUDGE; each page's route is in results/draw.json (engine, pipeline), but one page per book from reference-aligned books is not a cell's waiting-page frame"
defect_rates: "none — MQM labels per page are in results/verdicts.jsonl (classes and severities, no quotes); not a route comparison"
---
## 2026-11-01 · How far to trust the 43%: the #7866 judge calibrated at its own bar, on stored reads with typed references (#7263)

Part of #7263. This answers "How far to trust the 43%" in `.claude/docs/router-optimization-paper.md`: calibrate the judge at #7866's own bar, on real reads with a typed reference, about 100 pages split across print and manuscript. It also carries Derek's amendment of 2026-11-01 11:35Z (job inbox). The amendment makes the outcome severe defects per 1,000 words, measured through translation, and adds a human-typed arm.

PRIOR ART:
- `scripts/eval/judge-calibration-7263/` (#7880) calibrated the same judge on CHURRO-DS pages that two models read fresh, at a 1% CER bar. The judge was lenient on real reads there (specificity 0.41 on reads over 1% CER). This study uses stored reads of our own books and #7866's bar, so its result can correct #7866.
- `scripts/eval/typed-refs-6012/`: the DTA, EEBO-TCP and CAMENA typed texts (private R2), their page split and the same-edition alignment are read here, not rebuilt.
- `scripts/eval/paddle-zh-qa-6388/prepare.mjs` `kanripoScore` (the #5935 Kanripo leaf rule) is reused with one change: the leaf comes from the page's two neighbours only.
- `scripts/eval/confidence-7866/`: `judgeAbsolute`, `paceCheck`, `eligiblePage`, the `badPage` rule and the 800 verdicts in `lane_judge_verdicts`.
- Searched `scripts/eval/INDEX.md` for "back-translation", "translate both" and "meaning". No earlier study compares a machine read with a typed reference through translation.

Code: `scripts/eval/judge-cal-7866bar-7263/` (`lib.mjs` truth rule, `run.mjs` draw / fetch / truth / judge / frame7866, `meaning.mjs` human / translate / compare / adjudicate, `analyze.py`). The committed results in `results/` hold ids, CERs, verdict fields and counts, but no page text, typed text, quotes or translations: EEBO-TCP, DTA and Kanripo texts stay on R2 and in `$JOB_SCRATCH`.

### 1. Design (draw and seeds committed before any judge call: commit 707a9ad34)

**Pages.** 100 pages, one per book, each a stored machine read of a live book with an independent typed reference of the same page:

| stratum | n | reference | stored reads |
|---|---|---|---|
| German print | 20 | DTA (same edition, page breaks congruent) | 3 Flash 10, Flash-Lite 8, 2.5 Flash 2 |
| English print | 20 | EEBO-TCP | 3 Flash 15, Flash-Lite 3, 2.5 Flash 1, one with no model stamp (its read is empty) |
| Latin print | 20 | EEBO-TCP 15, CAMENA 5 | 3 Flash 17, Flash-Lite 2, 2.5 Flash 1 |
| Chinese manuscript (Siku Quanshu) | 40 | Kanripo WYG | PaddleOCR-VL (`paddle-zh-2026-10`: #7866's `zh-paddle-dice-lt090` cell, 277 of its ~380 manuscript pages) |

**How pages were drawn.**
- **Print** (seed 72631 + language; pages seed 72632). Books come from #6012's same-edition pairs with ≥ 10 congruent pages and one dominant page offset. A page is drawn uniformly from the book's aligned range, not only from the pages the aligner located, so a badly read page is as likely as a good one. A page is kept when its typed page exists, has no `<gap>` and holds ≥ 300 letters (at most 12 pages tried a book).
- **Manuscript** (seed 72640). Books come from the Paddle zh lane, and the page is one the lane wrote. It is kept when **both neighbours** carry a trusted Kanripo leaf (dice ≥ 0.6) two leaves apart. The page's own leaf is the one between them, so its own read never decides whether it is drawn.
- Skipped: 40 books not live, 8 with no page between two trusted neighbours in 12 tries, 3 with no print page passing.
- **Not a random draw of the corpus.** These are books whose text a typed edition holds, and they read cleaner than #7866's frame. #7866's judge proxy is 6.0 severe defects per 1,000 words on print; this set's is 2.5. Sensitivity and specificity are conditional on the truth, so they move less than prevalence, but the kind of error differs. The 40 Siku pages are volumes of fewer works: KR3e0067 and KR1d0087 appear twice.

**Truth, from the reference alone** (`lib.mjs`, fixed before the first judge call). A page is **bad** when it has a wrong-text span or an error rate over TAU.
- Print:
  - *miss* = the order-free CER of the reference's lines inside the read (#7880 `cerLines`).
  - *extra* = the read's own lines located in the reference window: this typed page, its notes, and the pages either side.
  - A *wrong-text span* is a read line of ≥ 10 letters whose own CER in that window is over 0.5.
- Chinese: the #5935 `bodyCer` of the read's Han body fitted inside Kanripo leaves k−1..k+1. A *wrong-text span* is an edit run of ≥ 4 characters that the read has and the leaf does not.
- TAU = 1%: #7880's measured point where the judge accepts half the time. 0.5%, 2% and 5% are reported beside it.

**The judge.** #7866's instrument unchanged: `judgeAbsolute` (route-judge `judgePrompt`; the prompt embeds the text, so its sha differs per item and is stored per verdict), Opus (`claude-opus-5-5` on every verdict) via `claude -p` on this box's subscription, the page image in the workspace, blind to stratum and truth. The judge's call is #7866's `badPage`: not accepted, or a `wrong_text` defect.

**Derek's amendment.**
1. **The meaning test.**
   - The read's body and the typed reference were each translated into English by agy `gemini-3.8-flash-low` with one fixed literal prompt (`meaning.mjs TRANSLATE_PROMPT`).
   - Opus then compared the two English versions, blind to which was which (A/B drawn per pair, 4 pairs a call). It listed every difference in what they say and marked whether it misleads.
   - A **severe** defect is a difference marked as misleading. The **noise floor** is 20 seeded pages whose reference was translated twice and compared the same way.
2. **The human arm.**
   - The same judge, with the same prompt, was run on the 60 typed print references against their page images. Their notes were appended as `<margin>` blocks; running heads are not in the typed page by design.
   - Every misleads / wrong_text flag was adjudicated by a second Opus pass and by agy Gemini. Each saw the image cropped to a band around the flagged line (the whole page when the line could not be found) and was asked what the page prints.
   - **Real** = both say the typed text is wrong. **False alarm** = both say it is right. Anything else is split.

**Spend.**
- Opus, all through the subscription: 229 calls against the 260 cap. That is 110 judge calls (100 pages + 4 wrong-page + 6 repeats), 60 on the human arm, 29 adjudications and 30 comparisons. The meter on this box read 4–5% weekly throughout.
- agy Gemini: 220 translations and 14 adjudication pages.
- No paid API. No write to pages or books.

### 2. Controls

| control | result |
|---|---|
| wrong page (another drawn book's read on this image) | **4/4** rejected at fidelity 1 |
| repeat (same image and text again) | **6/6** same call |

### 3. The judge at #7866's bar

Judge call (bad / good) against the truth. Wilson 95% intervals; n is in pages, one page per book.

| stratum | bar | truly bad | sensitivity | specificity | κ |
|---|---|---|---|---|---|
| **print** | CER 1% | 19/60 | **0.42** (0.23–0.64) | **0.88** (0.75–0.95) | 0.33 |
| print | CER 2% | 12/60 | 0.50 (0.25–0.75) | 0.85 (0.73–0.93) | 0.34 |
| print | CER 5% | 7/60 | 0.57 (0.25–0.84) | 0.83 (0.71–0.91) | 0.29 |
| print | meaning | 25/60 | 0.36 (0.20–0.56) | 0.89 (0.74–0.96) | 0.26 |
| **manuscript** | CER 1% | 31/40 | **0.45** (0.29–0.62) | **1.00** (0.70–1.00) | 0.27 |
| manuscript | CER 2% | 26/40 | 0.54 (0.36–0.71) | 1.00 (0.79–1.00) | 0.45 |
| manuscript | CER 5% | 15/40 | 0.80 (0.55–0.93) | 0.92 (0.75–0.98) | 0.73 |
| manuscript | meaning | 26/40 | 0.50 (0.32–0.68) | 0.93 (0.69–0.99) | 0.36 |

By language on print at 1%: German 1/20 truly bad (its DTA pages are clean 19th-century Antiqua, and the judge called 4 of the 19 good ones bad); English 0.50 / 1.00; Latin 0.40 / 0.90.

- **The direction is the same at every bar.** The judge under-calls bad pages, and its false alarms are few. On real stored reads the judge is lenient. #7880 found the same on CHURRO reads (specificity there was 0.41 for "accept", which is this study's sensitivity for "bad").
- **The typed references are not error-free** (section 5), so part of a "bad" truth can be the reference's own error. Without the 11 print pages where an adjudicator upheld a reference error, print sensitivity is 0.33 (0.14–0.61) and specificity 0.86. The direction does not depend on it.

### 4. #7866 corrected

#7866's 800 page verdicts (`lane_judge_verdicts`, `results/frame-7866.json`; 796 of the 800 texts are unchanged since judged). Page-level Rogan-Gladen by script stratum (unknown-script pages take the print calibration), each page's true state drawn from its posterior given the judge's call, then #7866's ≥ 2-of-5 rule and its stratum × frame-size weights. Each of 4,000 draws also redraws sensitivity and specificity from their Beta posteriors and resamples #7866's books within strata. The interval therefore carries the calibration and the sampling uncertainty both.

| | share of books bad (≥ 2 of 5 pages) | read-weighted |
|---|---|---|
| #7866 as published (judge uncorrected) | **43.4%** (36.0–50.8%) | 44.1% |
| corrected, page bar CER 1% | **92.7%** (55.1–100%) | 96.9% (20–100%) |
| corrected, page bar CER 2% | 81.7% (44.3–100%) | 83.9% (6–100%) |
| corrected, page bar CER 5% | **60.9%** (26.3–92.8%) | 66.6% (2–100%) |
| corrected, meaning bar | 95.0% (56.2–100%) | 100% (25–100%) |

- **The 57% "passed" is too high at any of these bars.** At the loosest bar tried (5% CER, about one wrong letter in twenty) the median passed share is 39%. Correcting more than doubles the uncertainty, because the calibration rests on 19 bad print pages and 31 bad manuscript pages.
- **A bar this strict condemns almost every book.** The ≥ 2-of-5 rule with a 1% page bar flags a book for two pages that each have a few wrong letters. Read the 93% as "almost no book is letter-perfect on 5 pages", not "93% are unreadable". Section 5 gives the size of the errors.
- **Read-weighted.** `books.human_read_count` (books-known-fields; #5048) is set on 23 of #7866's 160 books, 101 reads in all; the other 137 weigh nothing. The read-weighted figures rest on those 23 books and their intervals run nearly 0–100%. They are shown, not relied on.

### 5. Severe defects per 1,000 words (Derek's outcome)

Words = the typed reference's words (Latin script) or Han characters (Chinese). Book-bootstrap intervals over pages.

| | print (60 pages, 13,117 words) | Chinese manuscript (40 pages, 7,299 characters) |
|---|---|---|
| meaning test: machine read vs typed reference | **3.35** (2.06–5.08) | 11.2 (7.1–16.2) |
| noise floor: reference vs itself, translated twice | 1.18 (0–2.92), 10 pages | **12.6** (3.5–27.0), 10 pages |
| judge-only proxy (MQM misleads + wrong_text) | **2.52** (1.45–3.84) | 7.40 (3.79–11.63) |
| human-typed edition, judge flags | 2.21 (1.06–3.73) | — |
| human-typed edition, confirmed by both adjudicators | **1.45** (0.61–2.67) | — |
| #7866 corpus, judge proxy (design-weighted) | 6.02 (4.43–7.91) | 7.78 (6.00–9.79) |

**Agreement between the meaning test and the judge proxy.**
- Print: Spearman 0.30, κ (any severe) 0.33. 13 pages are flagged by both, 12 by the meaning test only, 7 by the judge only, and 28 by neither.
- Manuscript: Spearman 0.56, κ 0.42.
- Their **rates** agree on print: 2.5 by the judge, and 3.4 − 1.2 ≈ 2.2 by the meaning test net of its noise. They disagree **page by page**.

**What it says.**
- **On print**, a machine read carries about 2–3 meaning-changing errors per 1,000 words on these pages. The human-typed edition of the same pages carries about 1.5. Machine reads have roughly 1.5–2× the human rate, not 10×.
- The corpus rate (6.0 per 1,000 by the proxy) is higher than this set's (2.5). These reference-aligned books read cleaner than the library average.
- **On Classical Chinese the translation test does not work.** Two translations of the same Kanripo leaf differ by 12.6 per 1,000 characters, as much as read against reference. Unpunctuated literary Chinese gives the translator too much room. The manuscript meaning rows are noise. Measure Chinese by CER and spans (section 3) or by the judge.

**The human arm, by kind** (29 severe flags on 60 typed pages; the judge accepted 50/60 and called 10/60 bad):

| class | real (both) | split | unadjudicated |
|---|---|---|---|
| O6 meaning-changing misread | 10 | 5 | 1 |
| O5 omission | 3 | 1 | |
| O7 numerals | 1 | 2 | |
| O3 another edition's text | 1 | 1 | |
| O12 marginalia / apparatus | 2 | | |
| O8 normalisation | 1 | | |
| T6 seam | 1 | | |
| **all** | **19** | **9** | **1** |

- **Real errors.** They are typical keying errors: "slying" for *flying* (long s), "Drufus" for *Drusus*, "uosce" for *nosce*, "remplum" for *templum*, "Tubaque" for *Turbaque*.
- **Wrong-edition references.** Two pages (`ge-6a426abd…`, `en-69e75402…`) are flagged as following a different typesetting. #6012's same-edition alignment put them there, and that machine page's 6.5% "miss" is partly the reference's.
- **Split.** Of the 9 split flags, 6 are "cannot tell" from both adjudicators: the crop band missed the line, or the print is unclear.
- **No false alarm.** No flag was upheld as correct typing by both adjudicators. **Caveat:** the adjudication prompt states the checker's claim, which can anchor a model toward agreeing. The 19 "real" is an upper bound on what an unanchored adjudicator would confirm. A blind re-read (no claim shown) is the next check.

### 6. Limits

- One judge (Opus) and one translator (Gemini 3.8 Flash-low). The comparisons are made by Opus, the judge's own family. On print the human arm shows the judge does not simply prefer machine text.
- The calibration set is reference-aligned books, cleaner than the corpus (section 1). The Chinese stratum is one lane (Paddle) over Siku volumes.
- The CER truth charges a read for normalising abbreviations (*ye* → *the*, *cap.* → *capitulo*) that the typed edition keeps. That is why the meaning bar was added. Under it the judge's sensitivity is no better (0.36 print).

### Reproduce

```
E=--env-file=/root/sourcelibrary/.env.production.local; D=scripts/eval/judge-cal-7866bar-7263
node $E $D/run.mjs draw --dir=$JOB_SCRATCH/kanripo-cache && node $E $D/run.mjs fetch --dir=$JOB_SCRATCH/kanripo-cache && node $D/run.mjs truth
node $E $D/run.mjs judge && node $D/run.mjs export && node $E $D/run.mjs frame7866
node $E $D/meaning.mjs human && node $E $D/meaning.mjs translate && node $E $D/meaning.mjs adjudicate && node $E $D/meaning.mjs compare && node $E $D/meaning.mjs export
python3 $D/analyze.py
```
