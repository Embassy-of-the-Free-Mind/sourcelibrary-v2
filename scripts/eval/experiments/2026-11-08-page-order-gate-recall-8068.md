---
stage: ocr
measure: judged_vs_reference
languages: []
scripts: []
canons: []
n_books: 659
n_pages: null
verdict: "A gate that holds a book when its printed page numbers descend for 5+ markers catches 42 of the 43 known descending #5699 books in the order they arrived, holds none of the 10 by-eye false positives and none of 598 random non-English books; it sees only books whose running heads carry numbers (69 of 598, 11.5%)."
status: adopted
decision: "Phase 4 holds fresh books on a 5+ marker descending run (page-order-descending-8068)"
superseded_by: null
issue: 8068
---
## 2026-11-08 · Can the printed page numbers hold a back-to-front book before it is translated? (#8068)

<!-- PRIOR ART: 2026-10-08-which-flagged-books-are-stored-in-the-wrong-page-order-5699 judged the detector's flags by image, in the books' order on that day; the books have since been renumbered, so this reconstructs the order they arrived in. -->

- **Question.** If `scripts/eval/page-marker-order.mjs` gated Phase 4, which known back-to-front books would it hold, and how often would it hold a book that is in order?
- **Design.** `scripts/eval/page-order-gate-recall-8068.mjs`, read-only, no model calls. **Recall set:** the 50 books confirmed by image in #5699 plus Kitab Manafi al-Aghdhiyah, each read in the order it ARRIVED in: the renumber's `sweep_log` moves (`renumber-page-order-5699`, 44 rows) are inverted page by page. **Hard negatives:** the 10 books the detector flagged in #5699 and the image showed in order. **Draw:** `$sample` of 600 books with `pages_ocr >= 10` and a language other than English (598 after removing known books), current order. The gate reads the same OCR head and tail as the detector, never `<page-num>`.
- **Result (threshold).** With the detector's own minimum (a DESC run of 4 markers), 6 of the 10 hard negatives would be held. Every one of those six has a longest run of exactly 4 (verse numbers, folio counters), and every held descending book has a run of 5 or more. **The gate needs 5.**
- **Result (recall, at 5).** Whole book descending: **26/26**. One part descending: **16/17**. Together **42/43** (Wilson 95% 88–99.6%). The miss, Horae Semiticae VIII (Codex Climaci Rescriptus), has no markers at all. Kitab Manafi (whole book descending, missed in #5699) is missed again: 0 markers. With it, 42/44. Pair-swapped (0/6) and the isolated swap (0/1) are not held: a swap is a SWAP finding, which the gate does not act on.
- **Result (false holds, at 5).** Hard negatives **0/10**. Random draw **0/598** (Wilson upper bound 0.64%); among the 69 draw books that carry 10+ markers, 0/69 (upper bound 5.3%). Dry run on the live queue (2,097 non-English books at `ocr_complete`, 2026-11-08): 0 would be held, about 50 ms per book.
- **What it cannot see.** Only 69 of 598 draw books (11.5%, Wilson 9–14%) carry 10+ running-head markers; of the 12 right-to-left books in the draw, 3. Recent OCR keeps the printed number in `<page-num>`, which #5699 showed is invented on exactly these books, and leaves the head bare. A book with no head numbers (Kitab Manafi, Codex Climaci) passes the gate, and so does a pair-swapped book.
- **Caveats.** The recall set is mostly books this detector found in the first place (only Kitab came from elsewhere), so 42/43 is recall on books it can see, not on all reversals. The draw's 0 holds is a false-hold bound only if no unknown reversal is in it; none was flagged, so the bound holds either way.
- **Release path.** A held book carries `pipeline_auto.hold.reason = page-order-descending-8068` with the flagged runs in `detail`. Check the run against the images; if reversed, renumber with `scripts/maintenance/renumber-page-order.mjs`; then `scripts/maintenance/hold-pipeline-books.mjs --release-held --reason page-order-descending-8068 --book <id> --apply`. A released book is never held by the gate again.
- *Replicated?* No. Per-book records: `scripts/eval/results/page-order-gate-8068/`.
