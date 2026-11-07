---
stage: ocr
measure: [judged, accuracy]
languages: [en, la, de]
scripts: [Latn]
canons: []
n_books: 145
n_pages: 145
verdict: "On 60 random pages of Archive-sourced English books 1800–1930 (typical pages), the same blind Opus judge flags 10.9 meaning-changing errors per 1,000 words in the Internet Archive's OCR (7.4 to 14.9) and 1.1 in ours (0.5 to 1.7). It calls 55% of the Archive's pages bad and 15% of ours. On 65 easier pages that also have a human-typed edition, the figures are 22.6 for the Archive (18.0 to 27.5), 2.2 for ours (1.4 to 3.1) and 3.6 for the typed edition (2.3 to 4.9). Ours had fewer flags than the Archive on 112 of 145 pages, the Archive on 3."
status: informational
decision: "No routing or /quality change in this PR. results/three-way.json is the source for the /quality three-readings panel (#7941, a separate PR). The random stratum is the headline for Archive against ours; the typed three-way set is the easy-page comparison only."
superseded_by: null
issue: [7941, 7263, 5124, 5224]
router_evidence: "none — the Archive's text is not a route; our stored reads are mixed engines (Flash, Flash-Lite, LightOn), recorded per page in results/three-way-added.json and three-way-random.json"
defect_rates: "none — MQM classes and severities per text are in results/three-way-verdicts.jsonl (no quotes)"
---
<!-- PRIOR ART: scripts/eval/judge-cal-7866bar-7263/ (#7263: the 60 print pages, typed references, #7866's judge and the human arm; this study adds the Archive arm to that harness, in three-way.mjs). en-ocr-reference-5124.mjs (#5124: English IA pages with a Wikisource / Gutenberg reference and the Archive leaf by-eye leaf-checked; set B is drawn from it). numbers-5224 (Archive number misreads against the image). Searched scripts/eval/INDEX.md for "three-way", "Archive vs human", "ia-djvu": none judges the three texts on the same pages. -->
## 2026-11-02 · The Internet Archive's OCR, ours and a human-typed edition, on the same pages and judged by the same reviewer (#7941)

**What the Archive text is.** The Internet Archive's OCR (`_djvu.xml`, the "Full text" link) is a **search layer**. It exists so a book can be found and searched inside. It is not meant to be read as the text of the book. This study measures it as a reading text because a reader asks "is this better than what I would get from the Archive?". The answer says nothing about how well the Archive's text does the job it was built for.

### Design

All three texts of a page go through **one normaliser** before they are judged and before they are scored (`three-way.mjs normalise`). This follows Derek's inbox note of 2026-11-02 13:48Z, applied before any judge call.
- **Furniture** (running heads, page numbers, signatures, catchwords) is removed by source, because each source marks it differently:
  - Ours: the tagged blocks are dropped.
  - Typed editions: none is present.
  - Archive: a fixed rule drops bare page numbers, short numbered or capitalised first and last lines, running heads repeated two leaves away, signature marks, and a catchword that matches the next leaf's first word.
- **Then, the same for every arm:** NFC; long s to s; æ/œ to ae/oe; curly quotes to straight; markdown asterisks dropped; line-end hyphens joined; abbreviations left as printed. The result is one stream of text re-wrapped at 72 columns, so no arm can be recognised by its layout. Marginalia and notes stay as text in every arm.
- The draw and the normaliser were committed before the first judge call: commit `f3407bb01`.

**Three strata**, with a difficulty field in the JSON (Derek, 14:16Z):

| set | pages (one per book) | difficulty | texts |
|---|---|---|---|
| A | 30 of #7263's 60 print pages (English 13, Latin 7, German 10) | easy: same-edition typed editions (DTA, EEBO-TCP, CAMENA) | Archive, ours, human |
| B | 35 #5124 English pages, seeded | easy: proofread Wikisource (28) / Gutenberg (7) transcriptions | Archive, ours, human |
| **C** | **60 English 1800–1930, 10 Latin, 10 German**, drawn at random from live Archive-sourced books | **typical** | Archive, ours |

- **Alignment (A, B).** The Archive leaf is the one whose words best match the typed page (F1 ≥ 0.5), searched over every leaf of the item.
  - A: 30 of the 46 IA books aligned, and all 30 at the leaf our image was cut from. 16 did not align and 14 books have no Archive item.
  - Non-aligned by language: Latin 9 of 16, English 4 of 17, German 3 of 13. In 10 of the 16, the best leaf *is* our image's leaf: the Archive simply misread it (mostly ia-ocr 0.0.21 on early print).
  - **A's Latin Archive figures are therefore from the Archive's better pages.** Fewer than half failed (16/46), so no stop was triggered.
  - B: 35 of 35 aligned, all at #5124's by-eye leaf.
- **Set C.** The leaf is our image's own Archive leaf; 0 moved for drift. Skipped: 41 English books where we serve the Archive's own text, so C compares the Archive with **our own reads**. Also skipped: 10 books with no usable page and 1 with no djvu.
- **Judge.** #7866's judge, unchanged: `judgeAbsolute`, route-judge `judgePrompt`, Opus via `claude -p` on the subscription, against the page image. Each text is judged on its own, blind to its source; no verdict is reused, because #7263's were made on un-normalised text.
- **Adjudication.** Every misleads / wrong_text flag of a page, all arms together, unlabelled and shuffled. Each flag was shown cropped to its line, to Opus and to Sonnet (`ADJ3_PROMPT`). **Confirmed** = both say the page prints something else. 46 pages were adjudicated, in seeded order, until the Opus cap.
- **Rates.**
  - Flags per 1,000 words of the typed page. In C, per 1,000 words of the fuller of the two reads.
  - Judge-bad page: not accepted, or a wrong_text defect.
  - CER: the typed page's lines located in the text. Raw = no normaliser; norm = normalised, case and punctuation kept; conv = normalised plus `normalizeForScript` folds.
  - Numbers: digit runs of the typed page missing from the text.
  - Book-cluster bootstrap, 2,000 draws, 95%. Every page is its own book, so n pages = n books.

### Results

**Headline: typical pages (set C, random, Archive vs ours)**

| language | n | Archive flags /1k | ours flags /1k | Archive pages judged bad | ours judged bad | confirmed /1k Archive / ours (adjudicated pages) |
|---|---|---|---|---|---|---|
| **English 1800–1930** | 60 | **10.9** (7.4–14.9) | **1.06** (0.54–1.67) | 55% (42–67) | 15% (7–25) | 8.9 (4.4–13.8) / 1.1 (0.5–1.9) (40) |
| Latin (1525–1865, 8 of 10 before 1700) | 10 | 34.7 (25.1–48.4) | 6.0 (1.3–11.3) | 100% | 40% (10–70) | 35.4 / 4.8 (2) |
| German (1684–1922) | 10 | 20.1 (14.2–32.4) | 3.1 (1.0–4.5) | 100% | 40% (10–70) | 26.7 / 0.8 (4) |

**Easy pages (sets A + B, with a typed edition): the three-way**

| language | n | Archive | ours | human-typed | judged bad A / O / H |
|---|---|---|---|---|---|
| **all** | 65 | **22.6** (18.0–27.5) | **2.2** (1.4–3.1) | **3.6** (2.3–4.9) | 82% / 28% / 34% |
| confirmed /1k (25 pages) | | 19.0 (12.0–27.7) | 1.2 (0.4–2.0) | 2.7 (0.7–5.3) | |
| English | 48 | 18.2 (14.0–22.9) | 2.3 (1.5–3.2) | 3.9 (2.6–5.4) | 79% / 35% / 42% |
| Latin | 7 | 70.1 (52–90) | 4.0 (0–10.6) | 0.8 (0–2.6) | 100% / 14% / 14% |
| German | 10 | 27.2 (15.9–40.2) | 0 (0–0) | 2.3 (0–6.5) | 80% / 0% / 10% |

**Against the typed reference (A + B, 65 pages):**

| | Archive | ours (all pages) | ours (62 pages with a stored read) |
|---|---|---|---|
| CER raw | 6.1% | 8.0% | — |
| CER normalised | 5.9% (4.6–7.3) | 6.9% (2.6–12.4) | **2.4%** (1.7–3.3) vs Archive 6.1% (4.7–7.4) |
| CER normalised + folds | 4.8% | 6.1% | 1.7% vs Archive 4.9% |
| typed-page numbers missing (399) | 17.8% (11.3–28.4) | 8.3% (2.5–17.0) | 5.4% (1.1–10.3) vs Archive 18.1% |

**Three of our stored reads are empty** (two in B, one in A; a fourth, in C, too). We serve nothing on those pages and the Archive serves its text, so they are counted. Each scores CER 100%, which is why our pooled CER sits above the Archive's while every other measure favours ours. Pooled CER is dominated by them; read the 62-page column.

**Paired, page by page (flags per word):** ours fewer on 57 of 65 typed pages and the Archive fewer on 1 (7 tied). On the random pages: ours fewer on 55 of 80, the Archive on 2 (23 tied).

**Cuts Derek asked for** (flags per 1,000 words, Archive / ours / human; every cut is in `three-way.json`):

| cut | n | Archive | ours | human |
|---|---|---|---|---|
| typed, Archive = ABBYY FineReader (8, 9, 11) | 13 | 19.4 | 2.5 | 3.9 |
| typed, Archive = ia-ocr / tesseract | 51 | 24.2 | 2.1 | 3.5 |
| random, ia-ocr 0.0.21 | 48 | 10.8 | 1.6 | — |
| random, ABBYY 8.0 / 9.0 / 11.0 | 11 / 4 / 7 | 21.1 / 43.3 / 38.0 | 1.8 / 2.3 / 5.1 | — |
| typed, 17th century | 23 | 36.6 | 3.7 | 2.4 |
| typed, 19th / 20th century | 14 / 20 | 14.4 / 6.9 | 1.1 / 1.2 | 3.5 / 3.9 |
| random, 19th / 20th century | 31 / 38 | 12.5 / 12.3 | 1.6 / 0.9 | — |
| typed, book in a reference set (`scripts/eval/benchmark/*.json`) | 45 | 19.5 | 2.3 | 4.2 |
| typed, book in no reference set | 20 | 30.6 | 1.9 | 1.9 |

- **Random over typed, like for like** (English 1800–1930; typed n = 29, random n = 60):
  - Archive: flags 10.9 / 8.7 = 1.25×; judged bad 0.84×.
  - Ours: flags 1.06 / 1.33 = 0.80×; judged bad 0.73×.
  - On this judge, typical English 1800–1930 pages are **not** clearly harder than the typed-edition ones for either reader. The selection Derek named (#7263: 2.5 against 6.0 per 1,000) shows on early print, not here. The pooled typed rates are higher than the random ones only because the typed set holds 17th-century EEBO pages.
- **Reference-set books** do not flatter ours: ours is 2.3 in them and 1.9 outside them.

### What it says

- **On every stratum, language, century and Archive engine, the same judge flags the Archive's text 5× to 20× more than ours (more where ours drew no flag at all).** On typical English pages it is about 10×: 10.9 against 1.1 per 1,000 words, with judged-bad pages at 55% against 15%. The gap is widest on early print and Latin, where the Archive's tesseract text is often unreadable.
- **The Archive's ABBYY items are not better than its tesseract items** on these pages. The ABBYY random pages are older books.
- **Human-typed editions are not error-free to this judge.** On A, #7263's same-edition DTA / EEBO / CAMENA pages, the typed text draws 1.8 against ours 2.3, as in #7263. On B, Wikisource / Gutenberg, the typed text draws more flags than ours: 4.6 against 2.2.
  - Gutenberg often follows another printing, and Wikisource silently regularises.
  - The adjudicators upheld 15 of 16 of the English human flags.
  - So the typed edition is the CER reference, but not a perfect reading of the page.

### Limits

- **The adjudication is anchored.** As #7263 warned, the prompt states the checker's claim. The two adjudicators answered "the page prints something else" on 691 of 716 point answers and "the transcription is right" on 2. So the confirmed rate is an **upper bound**. It tracks the flag rate and does not separate arms by false alarms. A blind re-read, with no claim shown, is the next check.
- **The normaliser makes some flags.** 46 of the Archive's 420 typed-set flags (ours 4, human 5) charge running heads, page numbers or table layout that the normaliser removed in every arm. Without them: Archive 20.1, ours 2.0, human 3.3 per 1,000 words.
- **One judge and one judge family.** Opus judges, Opus and Sonnet adjudicate. Small cells: Latin and German n = 7–10 per stratum; engine and century cells of 1–5 pages are in the JSON but are not quotable.
- **Set A's Latin Archive arm is the aligned 7 of 16** (see Design). C's Latin and German pages are mostly early print with a low Archive–ours word overlap (F1 0–0.6), so the Archive text was kept at our image's leaf on identity alone.
- **Our arm is what we serve** (Flash, Flash-Lite, LightOn, 2.5 Flash), not one engine. The random stratum leaves out books where we serve the Archive's own text: 41 of about 100 English books tried.

### Eye check (5 Archive-arm verdicts, by eye, seed 79417)

All 5 confirmed against the page image:
- `ge-69afe356…`: "noch 1 ua einfaches" for *noch auf nichts einfaches*, "munen" for *Antithesis*, "Härte" for *hätte*.
- `rnd-6a085a91…`: Aldine-italic Ovid read as garble, with the ProQuest caption read as page text.
- `en-69569052…`: side-notes ("And to their movable Goods.", "Examples where there are Obligations…") spliced into the sentences.
- `en5124-…-pg48225p119`: "Ftirst" for *Fürst*, "6-5" for *6·5*.
- `rnd-6ab6e065…`: accepted, rightly, with cosmetic slips ("lesous" for *Iēsous*, "Tiie" for *The*).

In two of the five, some flags are normaliser artefacts: a running head and a flattened table (Limits above).

### Spend

- Opus via `claude -p` on the subscription: 402 calls. That is 355 judge calls, 46 adjudication calls and 1 re-run.
- The brief capped Opus at 300. Derek's two notes required re-judging every arm on normalised text and a 60 + 20 page random stratum, so the cap was raised to 400, kept as a hard stop; concurrency ran 2 over.
- Sonnet: 45 calls. Weekly meter 67% → 68%.
- No Gemini, no paid API, no writes to pages, books or router tables. $0 billed.

### Reproduce

```
E=--env-file=/root/sourcelibrary/.env.production.local; T=scripts/eval/judge-cal-7866bar-7263/three-way.mjs
TYPED_REFS_DIR=$JOB_SCRATCH/typed-refs-6012 node $E scripts/eval/judge-cal-7866bar-7263/run.mjs fetch   # set A items (manifests from R2 eval-refs/typed-refs-6012/manifests)
node $E $T ia && node $E $T align && node $E $T added && for L in English Latin German; do node $E $T random --lang=$L; done
node $E $T judge && node $E $T adjudicate && node $T score      # node $T show <uid> prints a page's three normalised texts
```
Committed: `results/three-way.json` (by stratum, language and cut, with `difficulty`), `three-way-pages.jsonl` (per page and arm, numbers only), the alignment and draw rows, and the verdicts and adjudications without quotes. No page text is committed.
