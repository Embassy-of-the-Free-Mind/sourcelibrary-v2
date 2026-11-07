---
stage: metadata
measure: judged
languages: []
scripts: []
canons: []
n_books: 62
n_pages: 1545
verdict: "Running-head lines confirmed by blind image reads give 10,346 page numbers on 45 of the 62 first-set books; the same method reaches 19 of 300 sampled visible books (6.3%), 3.3% of their pages."
status: adopted
decision: "page_printed_numbers holds the first set; corpus rollout awaits Derek (#8041)"
superseded_by: null
issue: 8041
---
## 2026-11-04 · Can the printed page number of a frame be confirmed from running heads and images? (#8041)

<!-- PRIOR ART: 2026-10-03-printed-page-fit-4291 fits <page-num> into pages.printed_page, and #5699 showed that tag is invented on these books; 2026-10-08-which-flagged-books-are-stored-in-the-wrong-page-order-5699 opened the same books to judge order, not to map numbers. -->

- **Question.** Which printed number does each frame carry, on the books where the frame number and the printed number differ most, without trusting `<page-num>`? And how far would the same method reach?
- **Design.** `scripts/lib/printed-number-runs.mjs` fits straight lines, up or down one per frame, through the running-head markers of `scripts/eval/page-marker-order.mjs`. A run needs 5 markers exactly on the line, at most 10 frames apart, with at least half of the markers in its span agreeing. Opus then read the printed number off the images, blind: shuffled across books, opaque filenames, nothing about the expected number. Each run was opened at both ends, the middle, one frame between anchors, then a second look with whole pages at any blank and at frames between anchors on the side of the opening the anchors missed. Any number off the line rejects the whole run. An end showing no number moves inward. Kitab Manafi and Turris Babel carry almost no head markers, so every frame was read and the reads went through the same fit.
- **Result (first set: 60 #5699 books + 2).** 177 runs proposed on 50 of the 60 books, 134 confirmed, plus 3 on the 2 read in full: **137 runs, 45 books, 10,346 rows** (4,227 read, 6,119 between anchors). No run on 10 books (most markers there are absent or other counters); runs on 7 more all rejected, including both Maqrizi volumes.
- **Result (the check doing its work).** 41 of the 43 rejected runs showed a different number on the image. Reads between anchors: 452 showed a number, 15 of those were off the line and rejected their run (both Maqrizi volumes: frame 377 shows 352 where the line says 354, because the pairs are swapped and only one side of each opening had a marker). Fitting the markers alone would have numbered every other frame wrongly on those books.
- **Result (holdout).** 70 rows drawn at random from the 6,119 between-anchor rows after writing, read blind: 67 agree, 2 show no number, 1 reads ٩٦ where the row says ٦٦ (Kitab al-Hayawan, glyph ambiguous on the image; the adjoining frames are numbered on the 66 line). 67/68, Wilson 95% lower bound 92%.
- **Result (coverage, measured).** 300 visible books (`visible: true, pages_count > 0`, 70,942 live) by `$sample`: 49 have 10+ head markers, **20 have a run**, and 19 of those 20 keep at least one on image reads (first pass only: 44 of 46 runs). So **19/300 = 6.3% of books (Wilson 95%: 4.1–9.7%)**, 2,282 of 69,906 pages (3.3%); 8 of the 300 reach half their pages. Recent OCR holds the number in `<page-num>` and leaves it out of the body, so the head has nothing to read. The same line fit over `<page-num>` as a proposer only finds runs on 90 of the 300 (30%, 17.6% of pages); its confirmation rate is unmeasured.
- **Caveats.** Page ids in `page_printed_numbers` are the key, so a renumber does not move them, but a later image swap on a page would leave a row stale. Three reads per run cannot see a local jump smaller than the anchor gap that cancels itself. Coverage runs had one between-anchor check, not the second look. The ٦ and ٩ of some Arabic founts read alike to the reader (several rejections trace to this), which makes the method conservative there. No folio or Hebrew-numeral run was confirmed on this set; the code paths are tested, not field-tested. Syriac letter numerals were out of scope.
- *Replicated?* No. Run-level records: `scripts/eval/results/printed-numbers-8041/`.
