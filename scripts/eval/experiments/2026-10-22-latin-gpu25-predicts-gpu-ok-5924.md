---
stage: ocr
measure: agreement
languages: [la]
scripts: [Latn]
canons: []
n_books: 54
n_pages: 11622
verdict: "PENDING — the rule below was committed before any GPU read existed; results replace this line."
status: undecided
decision: "PENDING"
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
- **Arms** (one gpu-queue task, `85-latin-gpu25`, on gex45):
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

**Results.** Pending (queued behind gpu-queue `80-tib-gutter-full-c2`).
