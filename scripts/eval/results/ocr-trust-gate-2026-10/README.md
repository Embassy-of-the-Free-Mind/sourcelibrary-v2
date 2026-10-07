# OCR trust gate — stratum census and page-signal calibration (#5700)

2026-10-03. $0: read-only Mongo, no model calls. Code: `scripts/lib/ocr-trust-gate.mjs` (the gate),
`scripts/eval/ocr-trust-gate-census.mjs`, `scripts/eval/ocr-trust-page-signal-calibration.mjs`.

## 1. How much translation the gate stops (`census.json`, `census-books.jsonl`)

Live books only (`visible: true`, `pages_count > 0`). Every book a row could take was read page by
page; counts are exact, no `$sample`. **Pending** = pages with OCR, not a skipped page type, not
blocked, no translation yet (the Mongo cut `selectPages` starts from; its per-page text check can
only lower it). **Auto-eligible** = the book passes `selectAutoCandidates`' Mongo cut today.

| stratum | books | pages | translated | pending pages (books) | auto-eligible pending (books) | open chained runs |
|---|---|---|---|---|---|---|
| Greek manuscripts | 124 | 68,349 | 60,272 | **2,242** (85) | 584 (3) | 0 |
| Greek print 1450–1599 | 321 | 139,513 | 124,028 | **2,393** (110) | 1,479 (3) | 0 |
| Persian | 62 | 17,741 | 14,996 | **584** (15) | 355 (1) | 0 |
| Latin incunabula (1450–1500) | 1,233 | 284,724 | 259,700 | **4,786** (493) | 789 (3) | 0 |
| **gated total** | 1,740 | 510,327 | 458,996 | **10,005** (703) | 3,207 (10) | 0 of 68 open |

Not gated, for scale: Greek print 1600+ 332 books, 3,096 pending; Latin manuscripts dated
1450–1500 132 books, 297 pending.

How a book is placed:
- **Language** is the first label (`Greek-Latin` is Greek; `Latin; Greek` is Latin).
- **Year** is the census rule (`year`, else the first 3–4 digit run of the free-text `published`).
- **Manuscript** means at least half of the book's typed pages are `pages.script_type: handwritten`.
  There is no book-level field. A DATED Greek book with no script tags (173 of the 321) is taken by
  its year row; so is a dated Latin one (189 of the 1,233).

**The gap this leaves.** 351 live Greek books carry no script tag on any page and are dated outside
1450–1599 (329) or not at all (22). A manuscript among them is not seen by the gate. Their pending
volume is 1,516 pages. The script tags come from the OCR's own `<script>` tag, so a re-OCR fills them.

**What produced the OCR.** Every gated page was read by Gemini flash-lite or flash-preview
(`ocr_readers` in `census.json`): Greek manuscripts 36,952 flash-preview / 25,497 lite; Latin
incunabula 204,425 lite-preview / 24,007 flash-preview. That is why the release rule starts from
"read by something else, after the gate date".

## 2. A page-level signal — measured, NOT wired (`page-signal-calibration.json`, `page-signal-rows.jsonl`)

**Question.** Can a cheap signal on one page's OCR text tell that the OCR is why the English is
wrong? Bar set before the run: precision ≥ 0.8 at a useful recall, else record and stop.

**Calibration set.** All 135 pages of #5695 whose image was opened and whose defects were attributed:
T1 20 (Latin), T2 32 (Greek), T3 20 (vernaculars), T4 33 (Hebrew/Arabic/Persian), T5 30
(Sanskrit/Pali/Chinese). Positive = the reader named the OCR as the PRIMARY cause: **48 of 135**
(T1 3, T2 17, T3 1, T4 18, T5 9). The set is enriched for low pages, so its base rate is not the
corpus rate.

**Signals.** The OCR's own `<unclear>` / `[...]` density; script mismatch (share of letters not in
the script of the book's language); dictionary-miss rate for Greek and Latin (`garbleFeatures` from
`scripts/lib/ocr-garble-score.mjs`, against a lexicon built here from 14,062 pages of 1,800 other
Greek and Latin books: a word seen in ≥ 3 books; 28,159 Greek, 79,527 Latin words);
`ocrSelfCaution`; vowel-less, mixed-script and fragment tokens.

| signal | pages judged (OCR-primary) | best point at precision ≥ 0.8 | best F1 |
|---|---|---|---|
| unclear density, all | 135 (48) | none | P 0.60, R 0.06 (3/5 flagged) |
| script mismatch, all | 135 (48) | none | P 0.42, R 0.58 |
| script mismatch, Greek | 32 (17) | none | P 0.50, R 0.88 |
| script mismatch, Hebrew/Arabic/Persian | 33 (18) | none (P 0.75, R 0.33, 6/8) | same |
| dictionary miss, Greek | 32 (17) | **P 0.80 (4/5; CI 0.38–0.96), R 0.24** at ≥ 0.28 | P 0.64, R 0.82 at ≥ 0.17 |
| dictionary miss, Latin script | 40 (4) | none | P 0.15, R 0.75 |
| `ocrSelfCaution` | 135 (48) | never fires on these pages | — |
| vowel-less / mixed / fragment | 135 (48) | none | P ≤ 0.67 (6/9, RTL fragments) |

**Verdict: nothing is wired into `isTranslatablePage`.** One point touches the bar (Greek
dictionary miss), on five flagged pages, with a lower bound of 0.38 and a quarter of the bad pages
caught. The miss rates of bad and good Greek pages overlap almost entirely (bad: 0.07–0.54, median
0.23; good: 0.06–0.38, median 0.20).

**Why they fail.** The OCR that damages the English is fluent: it writes real words, in the right
script, with no doubt markers. On these 135 pages the OCR marked doubt on five. This is what
`ocr-garble-score.mjs` says of itself ("a model that fabricates fluent text writes real words;
that class needs the image"), now measured against cause labels.

**What did separate.** The book's stratum. On the 32 Greek pages, `script_type: handwritten`
was OCR-primary on 8 of 8; that is the book-level gate's row, not a page signal.

**Caveats.**
1. 16 of the 135 pages had their OCR re-read after the eval drew them, so their signals are
   computed on newer text. Without them (119 pages, 44 positive) the result is the same: Greek
   dictionary miss P 0.80, R 0.25 (4/5); Hebrew/Arabic/Persian mismatch P 0.83, R 0.29 (5/6);
   nothing else meets the bar.
2. Thresholds were swept on the same pages they are scored on, so the two points above are
   optimistic. There is no held-out set.
3. The lexicon is made from our own OCR. A misreading that recurs across books is in it.
4. T1's `ocr_abbrev` (abbreviations mis-expanded) is counted as OCR-primary.

**Re-run.** Labels: `image-check/*.json` of T1 and `image-check.json` of T4 are on the branches of
PRs #5721 and #5735 until they merge; T2, T3, T5 are on main. Collect them into
`<dir>/t1 … t5`, then `node --env-file=… scripts/eval/ocr-trust-page-signal-calibration.mjs --labels=<dir>`.
