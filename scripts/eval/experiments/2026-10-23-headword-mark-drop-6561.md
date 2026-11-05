---
stage: ocr
measure: none
languages: [lzh]
scripts: [Hant]
canons: []
n_books: 825
n_pages: 74464
verdict: "PaddleOCR-VL drops the 丨 headword mark on about 46% of 佩文韻府 pages (≥100 Han), against 13% of Opus-read pages; the per-page rate is bimodal, so a zero page in a high-median book is a free flag."
status: informational
decision: null
superseded_by: null
issue: [6561, 6056]
---
## 2026-10-23 · How often does the OCR drop the 丨 headword mark in Chinese reference works? (#6561, #6056)

PRIOR ART: `scripts/eval/experiments/` had no measure of a script-specific mark; the Paddle lane's guards
(`scripts/lib/paddle-zh-lane.mjs`, #5600) and the #6388 bake-off judged catastrophic reads and tables, not 丨.

**Question.** Sprint round 3 found 佩文韻府 vol 664 (`6a3c64e339b4508b04e2ae39`) pp39–40 with every 丨丨 missing from the
OCR, and an English that filled the holes with invented words and invented headwords. Is that one volume, or the lane?

**Design.** `measure: count`, no model, $0. Per page with ≥ 100 Han characters: 丨 per 1,000 Han. Frame: the 825 public
books whose title contains 佩文 (title regex over public books with 韻府/類書/類編… titles, 2,078 books). Grouped by
`ocr.source/ocr.model`. Detector now in `scripts/audit/headword-mark-drop.mjs`.

**Result.**

| OCR engine | pages | 丨 per 1k Han | pages < 1/1k |
|---|---:|---:|---:|
| Paddle (PaddleOCR-VL-1.6-0.9B) | 74,464 | 43 | 34,540 (46%), in 584 books |
| Opus (claude-opus-5-5) | 67 | 80 | 9 (13%) |
| gemini-3-flash-preview | 6,327 | 10 | most |

- **Bimodal per page.** Vol 664: p36 83, p37 64, p38 6, **p39 0, p40 0**, p41 89. The reviewer flagged 39–40 and passed 41.
  The detector run on that book alone flags 48 of 128 pages, 39 and 40 among them, not 41.
- **By eye.** Vol 664 p33 (score 0): the image carries dozens of 丨丨; the OCR has none.
- **Blind prediction.** Before round 4's review the detector said vol 411 pp95–97 keep their marks (51–76/1k); the
  reviewer found no dropped-headword error there (it found two other serious errors: a column-order scramble and an
  invented share in a Guanzi quotation).
- **Flash is worse than Paddle** on this mark (10/1k), so it is not the repair lane.

**What it means.** About a third of Paddle pages in these works (46% minus the 13% baseline of genuinely mark-free pages,
≈ 24K pages) lost the mark, and the English built on them invents. Because Paddle keeps the mark on about half the pages,
a Paddle re-read of only the flagged pages is the cheapest repair to test (≈ 5 GPU-hours at 0.54 s/leaf), then
re-translate those pages only. Other 類書 titles (駢字類編, 淵鑑類函) are not yet measured.

**Not established.** Precision page by page (one page opened by eye); whether a re-read recovers the mark; the rate in
non-佩文 reference works.
