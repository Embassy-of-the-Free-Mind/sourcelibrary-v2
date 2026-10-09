## 2026-10-08 · Which right-to-left and CJK books are stored in the wrong page order, and what would a repair move? (#5699) — 50 of 60 confirmed by image

PRIOR ART: `scripts/eval/page-marker-order.mjs` (PR #5707, the detector, re-run unchanged) and
`scripts/eval/results/quality-census-2026-10/d-precision-review.md` (its precision, judged from OCR text only).
`scripts/maintenance/reorder-rtl-split-pages.mjs` (#4796) is the only existing repair; it swaps split halves and
moves `pages.page_number` and `cover_page` only.

**Question.** The detector flagged 52 of 736 right-to-left books and 8 of 1,456 CJK books. Which of the 60 are really
stored out of reading order, in what pattern, and what would a repair have to move?

**Method.** Read-only, $0, no writes. Detector re-run on the 3 October draw. For each of the 60 books, 3 or 4
adjacent page images at the flagged run were opened and the printed page numbers read from the image by a reader
that was not shown the OCR's numbers; 35 more samples were read where one sample could not settle the extent
(95 samples in all). Range ends come from the OCR marker runs and are approximate to a few pages.

**Detector re-run.** 51 right-to-left, 8 CJK, 0 of 180 multi-language and 8 of 1,500 others flag (≈ 102 of 19,039
scaled; 6 swap, 2 descending). Two books flagged on 3 October no longer do.

**Result** (60 books; `scripts/eval/results/page-order-dryrun-5699/verdicts.json`):

| pattern | books | served pages in range | translated pages in range |
|---|---|---|---|
| whole book descending | 26 | 15,559 | 7,734 |
| one part descending | 17 | 5,126 | 3,318 |
| pair-swapped | 6 | 2,568 | 1,163 |
| isolated swap | 1 | 3 | 3 |
| false positive | 10 | 0 | 0 |

- 50 of 60 confirmed (83%); 49 verdicts rest on numbers read from the image, 1 on OCR numbers plus backwards chapter
  labels and sheet signatures on the image. 48 of the 50 are visible.
- False positives: OCR digit misreads (3), numbers that are not page numbers (5), unsplit spreads with two numbers
  per image (1), folio and page counts mixed (1).
- The detector understates extent. Talmud Bavli flagged two short runs and is descending at every one of four
  samples across 764 pages. In Pococke's Historia Dynastiarum the half that descends is the Latin, not the Arabic.

**Where the order comes from.** 48 of the 50 are Internet Archive books. On 46 of them the stored page number equals
the Archive's leaf number plus one on every page: `src/app/api/import/ia/route.ts` writes `page_number: i + 1` from
`/page/n{i}` and nothing reorders afterwards. The order is the Archive's own scan order. Its `page-progression`
field does not predict it: of 13 flagged items marked `rl`, 7 descend, 5 are in order and 1 has one isolated swap; all 6 marked `lr` descend;
29 with no value descend. Three books are different: both Maqrizi volumes were put out of order by
`scripts/split-book.mjs`, which stores the right half first for any book whose language is Arabic (`RIGHT_FIRST`),
and these volumes are bound left to right; Avodat ha-kodesh came through the older BPH crop split, which
`reorder-rtl-split-pages.mjs` skips.

**What a renumber moves.** Counted on Benjamin of Tudela (`69e9617a2beefe2f6f72ba14`): 319 page documents, 319
Supabase `page_translations` rows carrying a copied `page_number`, 972 page references in `entities.books[]`,
12,502 in `book_indexes`, 33 chapters, 15 summary quotes; 0 locus anchors, highlights, DOIs. Across all 50 books:
21,399 `entities.books[]` rows with 88,659 page references, 905 chapters, 0 DOIs, 0 locus anchors, 0 highlights,
4 shortlink visits. A separate reading-order field would instead touch every reader of page order: 90 files under
`src` and 203 under `scripts` sort by `page_number`, and 30 sites take `page_number ± 1` as the neighbour.

**Translation context.** 12,218 translated pages sit in the confirmed ranges; each was translated with the wrong
neighbour as context. Re-translating them in the chained Batch lane (Gemini 3.1 Flash-Lite, $0.0012 a page) is $14.66.

**Limits.** Recall is unmeasured: about a third of right-to-left books carry enough markers to check. Range ends are
not exact. Instructions Nautiques rests on two manuscript folio numbers. The 8 flagged "other" books were not opened.
