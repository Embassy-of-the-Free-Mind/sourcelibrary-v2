# Page-order dry run (#5699): results

PRIOR ART: `scripts/eval/page-marker-order.mjs` and `scripts/eval/results/quality-census-2026-10/` (PR #5707)
flagged the books; this directory holds the by-image verdicts on them. Write-up:
`scripts/eval/experiments/2026-10-08-which-flagged-books-are-stored-in-the-wrong-page-order-5699.md`.

`verdicts.json`: one record per flagged right-to-left or CJK book (60). No page text.

- `pattern`: whole book descending, one part descending, pair-swapped, isolated swap, false positive.
- `verdict_basis`: "read from image" or "from OCR text".
- `affected_ranges`: storage `page_number`, inclusive, as stored on 2026-10-08. Range ends were taken from
  the OCR marker runs and are approximate to a few pages; a repair has to fix them by eye.
- `mapping`: what a repair would apply. Nothing was applied.
- `translated_ai_in_range`: served pages in the range holding a model translation.
- `image_reads`: the printed numbers read from the page images, in storage order, for each sample.
- `ia_page_progression`, `ia_scanner`: from the Archive's item metadata, read on 2026-10-08.
