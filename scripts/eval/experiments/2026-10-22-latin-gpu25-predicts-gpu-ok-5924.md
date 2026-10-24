---
stage: ocr
measure: agreement
languages: [la]
scripts: [Latn]
canons: []
n_books: 54
n_pages: 11622
verdict: "Under the preregistered bar (median disagreement with stored OCR ≤ 2 points, no catastrophic page), no whole book is GPU-OK. The 25-spread verdict therefore matches the whole-book verdict on 20 of 20 books, but every match is a fail, which says nothing. Read as numbers, the 25 spread pages predict the book: Spearman ρ 0.89 for median disagreement, a median gap of 0.8 points, ρ 0.75 for the catastrophic share. The first 25 pages predict it less well: ρ 0.46, a gap of 4.0 points. Post hoc, at a bar some books pass (median ≤ 5 points, catastrophic pages ≤ 4%), the spread verdict matches on 20/20 (3 OK, 17 fail) and the first 25 on 17/20. Gothic, two-column and side-note books disagree 3–4× more than plain roman, and one Greek book plus one two-column book loop on 55–74% of their pages. By eye, the stored text is right on 3 of 6 disagreement pages and GLM on 3. Two of GLM's three wins are pages where the stored text is another leaf's."
status: informational
decision: "Decide GPU eligibility from 25 pages spread through the book, never the first 25. Measured against stored Gemini text, stock GLM-OCR 0.9B does not reach a 2-point bar on any whole Latin book here: no Latin GPU lane on this evidence. The distilled adapter agrees more with the stored text (it was trained on it) but loops more. Two wrong-leaf stored pages were found by eye and reported on #5924, not contained (this job was read-only)."
superseded_by: null
issue: [5924, 6871, 6912]
---
## 2026-10-22 · Do 25 spread pages predict whether a Latin book can go to GPU OCR? (#5924)
<!-- PRIOR ART: 2026-10-22-latin-ocr-repair-census-5924.md (PR #7173: the 54 printed books, their Opus format labels, and the finding that 25 spread pages predict the text-defect rate while the first 25 do not; gpu-plan.json copied from it unchanged); 2026-10-18-latin-gex45-bakeoff-5924.md (#6912 arm G: stock GLM-OCR serve flags, read.py, score.mjs views, reused unchanged); scripts/eval/latin-distill-6871 (the distilled adapter, PR #6871 item 2). -->

**Question.** Derek, 2026-10-22, to the census job: "also test whether 25 pages predict whether a book can go to GPU
OCR." The census found that 25 pages spread through a book predict its text-defect rate. This asks the same of a
go / no-go decision for the GEX45: read the 25 pages on the GPU, and does that verdict match the one from reading the
whole book?

**Design (committed before any read was scored).**
- **Books and pages.** `gpu-plan.json` from the census, unchanged. Spread: 54 printed Latin books × 25 pages spread
  evenly through the OCR'd pages (1,348 pages: one book has two page numbers held by two page documents each, so we drop
  both). Whole: 20 of those books, filled by format quota (gothic 5, two-column 4, Greek 4, side-notes 4, any 3). That
  is 10,274 pages, every page with stored OCR.
- **Images.** `getPageSource` (scripts/lib/page-image-url.mjs), the leaf the stored OCR read. All 11,622 are on
  images.sourcelibrary.org. Long side is capped at 2,400 px, as in #6912 (`fetch-chunk.py`).
- **Arms** (one gpu-queue task on gex45; it ran as `644-latin-gpu25`, with files in `/root/jobs/gpu-queue/79-latin-gpu25/`):
  - **GS.** Stock GLM-OCR 0.9B on the spread pages, with #6912 arm G's flags (MTP speculative decoding, 6,000 tokens).
  - **DS.** The distilled GLM-OCR (#6871 `run/merged`) on the same pages.
  - **GW.** Stock GLM-OCR on the 20 whole books.
- **Comparison text.** `pages.ocr.data` as of 2026-10-22, read only and frozen in `refs.jsonl.gz` (scratch). Metadata
  blocks the engine never prints are dropped with their content: language, page-type, vocab, meta, image-desc,
  scan-quality, warning, note, columns, figure, detected-images (the list in benchmark-score.mjs). Every other tag
  loses its markup and keeps its text: margin, header, page-num, sig, term.
- **Measure.** **Agreement CER, not accuracy**: the stored text is itself OCR, and the census found it wrong on many
  pages. View N of `latin-bakeoff-5924/score.mjs` (latin-norm@1, marks dropped, v→u, j→i, letters only, order
  tolerant). We use it with `--fold-f`, so ſ and f both fold to s and lite's ſ→f habit does not count as a
  disagreement.
- **Loops.** `loopVerdict` (scripts/lib/ocr-loop-guard.mjs), unchanged. Pages that hit the 6,000-token cap are
  counted too.

**The rule (stated before scoring).**
- A page **counts** if its stored text has ≥ 100 letters in view N. Blank leaves and plates are excluded.
- A counted page is **catastrophic** if the GPU text is empty or its N disagreement is > 50%.
- A book is **GPU-OK** if its median disagreement over counted pages is ≤ 2 points (0.02) and it has **no**
  catastrophic page.
- For each of the 20 whole books we take two verdicts: one from GS on its 25 spread pages, and one from GW on all its
  pages. **Decision agreement** is the number of books where the two verdicts match, reported as a 2×2 table.
- We also report two secondary views: the spread verdict from GW's own rows at the spread page numbers (the same
  engine pass), and a first-25 verdict, as a contrast with the census.
- **Formats.** For each format flag (gothic, two-column, Greek, side-notes) we report the GPU-fail rate with and
  without the flag, over the 54 GS books and over the 20 GW books.
- **Student vs stock.** DS against GS on the same 1,348 pages: GPU-OK books, and per-book medians.
- **By eye.** An Opus reader looks at 6 high-disagreement pages, with the image and both texts, and says which engine
  is right.

## Results (2026-10-23)

**Run.** The task ran as gpu-queue `644-latin-gpu25`, renamed twice so that it ran between 24 h chunks that other
sessions queued after it. GW did not fit its 7.5 h slice, so `6441-latin-gpu25-gw` resumed it. All files are in
gex45 `/root/jobs/gpu-queue/79-latin-gpu25/`. Wall time and output:

| arm | pages | pages/h | errors | hit 6,000-token cap | loops (`loopVerdict`) | catastrophic | median disagreement |
|---|---|---|---|---|---|---|---|
| GS stock, spread | 1,348 | 1,355 | 0 | 77 | 66 | 146 | 4.4% |
| DS distilled, spread | 1,348 | 1,194 | 0 | 127 | 86 | 163 | 3.8% |
| GW stock, whole | 10,274 | ~990 (looping books) | 0 | 2,063 | 1,707 | 3,302 | 12.1% |

**The preregistered rule.** Five spread books pass under GS and 7 under DS (of 54). None of the 20 whole books
passes. The best whole-book median is 2.7%, and 19 of the 20 have at least one catastrophic page.
Decision agreement on the 20 whole books:

| spread verdict from | agree | both OK | both fail | spread OK, whole fail | spread fail, whole OK |
|---|---|---|---|---|---|
| GS on the 25 spread pages | **20/20** | 0 | 20 | 0 | 0 |
| GW rows at the same 25 pages | 20/20 | 0 | 20 | 0 | 0 |
| GW first 25 pages (contrast) | 20/20 | 0 | 20 | 0 | 0 |

The rule cannot tell the two samples apart, because nothing passes. The informative evidence is the numbers behind it.

**Do 25 spread pages predict the book? Yes, as a number.** Over the 20 whole books:

| | spread 25 (GS) | first 25 (GW) |
|---|---|---|
| Spearman ρ with whole-book median disagreement | **0.89** | 0.46 |
| Median absolute gap to whole-book median | **0.8 pts** | 4.0 pts |
| Spearman ρ with whole-book catastrophic share | **0.75** | 0.69 |

**Post hoc grid** (chosen after the preregistered rule passed nothing). Each bar is applied the same way to the 25
pages and to the whole book. A catastrophic **share** replaces "no catastrophic page", because a long book fails
"no catastrophic page" by its length alone; 4% is 1 page in 25.

| median ≤ | catastrophic ≤ | whole books OK | spread agrees | first 25 agrees |
|---|---|---|---|---|
| 3 pts | 4% | 2 | 18/20 | 18/20 |
| 3 pts | 10% | 2 | 18/20 | 16/20 |
| 5 pts | 4% | 3 | **20/20** | 17/20 |
| 5 pts | 10% | 4 | 18/20 | 14/20 |
| 10 pts | 0 | 1 | 15/20 | 17/20 |
| 10 pts | 4% | 6 | 17/20 | 12/20 |
| 10 pts | 10% | 7 | 16/20 | 12/20 |

There are 7 cells where at least one whole book passes (the full 12-cell grid is in `results/summary.json`
`posthoc`). In 6 of them the spread verdict matches as well as or better than the first 25. The exception is the
zero-tolerance cell, where only 1 book passes, so "fail" is right for nearly every book whichever 25 pages are read.

**Per book, whole vs spread** (median disagreement; catastrophic share; loop share):

| book | quota | pages | whole median | whole cat. | whole loops | spread median (GS) | spread cat. | first-25 median |
|---|---|---|---|---|---|---|---|---|
| 69b62f861c… | two-col + side-notes | 1,436 | 91.6% | 97% | 74% | 92.9% | 25/25 | 69.7% |
| 69b21c3c42… | Greek + side-notes | 602 | 97.9% | 61% | 55% | 100% | 17/25 | 96.7% |
| 69b631ba1c… | gothic two-col | 1,136 | 77.6% | 99% | 3% | 77.4% | 24/25 | 12.5% |
| 69b51ebdff… | Greek | 184 | 15.1% | 35% | 26% | 64.5% | 13/22 | 23.7% |
| 69b4cd08d5… | two-col | 230 | 10.2% | 34% | 12% | 22.6% | 8/23 | 87.1% |
| 69bd9dc461… | Greek | 146 | 8.1% | 29% | 16% | 18.0% | 9/23 | 19.0% |
| 6990616cef… | two-col + Greek | 452 | 17.1% | 4% | 1% | 10.2% | 0/25 | 1.0% |
| 69a9570865… | side-notes | 746 | 14.3% | 2% | 1% | 14.6% | 0/25 | 2.1% |
| 69dbc94010… | gothic | 253 | 13.9% | 0.4% | 0.4% | 14.0% | 0/24 | 9.0% |
| 69dbc9f310… | gothic | 323 | 12.6% | 4% | 3% | 12.2% | 1/25 | 8.6% |
| 69dbc9b110… | gothic | 124 | 10.8% | 3% | 3% | 10.0% | 2/25 | 8.3% |
| 69dbca0d10… | Greek | 157 | 9.4% | 0% | 0% | 9.5% | 0/23 | 8.0% |
| 69dbcb8610… | gothic | 314 | 7.8% | 20% | 8% | 6.8% | 0/7 | 4.2% |
| 6ff1a28b… | side-notes | 898 | 7.7% | 3% | 2% | 10.3% | 0/23 | 6.7% |
| 6a08551d15… | two-col + side-notes | 719 | 6.2% | 2% | 1% | 6.3% | 0/25 | 4.2% |
| 6952d05477… | side-notes | 856 | 4.3% | 8% | 0.1% | 5.8% | 1/25 | 32.1% |
| 69af106e26… | any | 251 | 3.8% | 1% | 1% | 3.0% | 0/25 | 1.5% |
| 69b2ff6a55… | side-notes | 829 | 3.4% | 12% | 12% | 3.9% | 2/25 | 5.4% |
| 69de992d1b… | any | 174 | 2.9% | 2% | 0% | 3.1% | 0/23 | 2.0% |
| 6a08525b49… | any | 444 | 2.7% | 0.5% | 0% | 2.8% | 0/24 | 6.7% |

The three books that loop or collapse are flagged by their 25 spread pages (17–25 catastrophic of 25). The first 25
misses one of them: 69b631ba1c… reads 12.5% on its first 25 pages and 77.6% over the whole book.

**Which formats predict GPU failure** (GS, 54 books; median of the per-book median disagreement):

| format | with: books, fail, median | without: books, fail, median |
|---|---|---|
| gothic | 10, 10 fail, 11.8% | 44, 39 fail, 3.0% |
| two-column | 8, 7 fail, 14.9% | 46, 42 fail, 3.4% |
| side-notes | 9, 9 fail, 10.3% | 45, 40 fail, 3.1% |
| Greek | 10, 9 fail, 7.5% | 44, 40 fail, 3.8% |

Under the strict bar nearly every book fails, so fail counts separate the formats poorly; the median separates them.
Gothic, two-column and side-note books disagree 3–4× more than plain books. The loop and collapse cases are
two-column or Greek with side-notes. No gothic or side-note book passed under either GPU arm. One two-column book passed under GS (median 1.9%, no catastrophic page).

**Distilled vs stock** (same 1,348 pages): GPU-OK books 7 vs 5; the distilled arm has the lower median on 41 of 54
books; loops 86 vs 66; catastrophic 163 vs 146. The distilled model was trained on stored flash-preview text. Its
higher *agreement* with stored Gemini text is partly built in, and is not evidence that it reads better. It also
loops more.

**By eye** (6 pages: 4 at 5–50% disagreement and 2 catastrophic, distinct books, Mulberry32(5927); Opus subagent,
image vs both texts; `latin-gpu25-5924/results/by-eye-pages.json`):

| # | page | disagreement | right | why |
|---|---|---|---|---|
| 1 | 69c835706c…-p41 | 7.4% | GLM | scan crops the right edge; the stored text invents the cut-off word endings ("laudat", "numero") |
| 2 | 69dbcc270f…-p124 | 16.6% | stored | incunable abbreviations: GLM maps the marks to junk ("scd£m", "ērto") |
| 3 | 69dbc94010…-p97 | 14.2% | stored | gothic textura: GLM "Dec" for the red "Hec", "Pullus" for "Nullus" |
| 4 | 69c82de66c…-p180 | 40.7% | stored | GLM skipped the whole Hebrew column |
| 5 | 69b631ba1c…-p848 | 77.3% | GLM | **the stored text is another leaf** (2 Macc 14–15 for the end of 2 Macc 15); GLM has many gothic letter errors |
| 6 | 69bd9e6761…-p774 | 76.1% | GLM | **the stored text is another index leaf** (O–P for the printed R–S entries) |

The stored Gemini text reads better on incunables, gothic type and Hebrew. GLM-OCR stays on the right leaf. A
catastrophic disagreement can therefore be a stored-text failure as easily as a GPU failure, which is why this
measures agreement, not accuracy.

**Containment not done.** Pages 5 and 6 are wrong-leaf stored text, found with the image open. Page 6 (Mylius,
*Philosophia reformata*, visible) carries an English translation of the wrong leaf. The brief made this job read-only
("NO writes to pages/books"), so it did not hold or withhold anything. They are reported on #5924 for containment.

**Limits.** The comparison text is OCR, not a reference. n = 20 whole books, and only 3–7 pass under any post hoc
bar. The by-eye check is 6 pages from one reader. The grid was chosen after the preregistered rule passed nothing.
