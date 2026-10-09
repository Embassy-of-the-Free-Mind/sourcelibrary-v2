---
stage: image
measure: agreement
languages: []
scripts: []
canons: []
n_books: 6
n_pages: 491
verdict: "Contact-sheet vision screen finds illustrated pages at 79% recall (v2 prompt); union of two tilings reaches 93.6% at $0.00029/page, 6.8x cheaper than full-page calls"
status: informational
decision: null
superseded_by: null
issue: 5009
---
## 2026-09-24 — contact-sheet screen for illustrated pages (#5009)

**Question.** Books filled with free Internet Archive text carry no `<page-type>` or `<image-desc>`
markup, so `image-extract-worker.mjs` finds zero candidates and marks the book `images_complete`
having looked at nothing. Can one vision call over a GRID of page thumbnails find the illustrated
pages instead, cheaply enough to run over a whole shelf?

**Tool.** `scripts/eval/contact-sheet-screen.mjs`. Reference labels are `gallery_images` rows —
detections that survived the 0.5 quality gate and `isTrivialGalleryDetection` — NOT raw
`detected_images`. Six illustration-rich books, 491 pages, 188 labelled pages. Arms are PINNED to
the same six books (`--book-ids`); `$sample` redraws every run and the misses are strongly
book-specific, so an unpinned arm measures the draw.

**THE INSTRUMENT WAS THE FIRST RESULT, AND IT WAS WRONG TWICE.** Reported in order, because the
shape recurs:

1. First run: recall **72.9%**. Reading the misses by eye showed 30 of 51 were large, full-page
   woodcuts — too conspicuous for a downsampling story. Grouping by sheet showed why: the misses
   arrived in whole blocks of sixteen. Eleven of 33 sheets returned zero hits while their
   neighbours scored exactly right (8/8, 10/10, 6/6).
2. The cause was one line of parsing. The model answers in **either** envelope — `{"cells":[...]}`
   as asked, or a bare `[...]` array. v1 read only `parsed.cells`, found `undefined` on a bare
   array, and scored all sixteen cells as "no picture". **A discarded valid answer was
   indistinguishable from a confident negative.**
3. Interim fix (retry + exclude non-answering sheets) gave **88.3%**, still wrong: the sheets that
   happened to use the asked-for envelope were a biased subset. Only accepting both envelopes gave
   full coverage and the honest number.

Guards now in the script: three attempts, one cell required per page, both envelopes accepted,
never-answered sheets reported loudly and **excluded from the rates rather than counted as
negatives**. See `lesson_partial_artifact_read_as_total` and
`lesson_absence_is_not_failure_no_silent_skips` — this is a third instance.

**Results** (same six books, full coverage):

| arm | prompt | density | recall | precision | $/page screened |
|---|---|---|---|---|---|
| A | v1 | 16 @ 384px | 65.4% | 83.1% | $0.000134 |
| B | v2 | 16 @ 384px | **79.3%** | 83.7% | $0.000128 |
| C | v2 | 9 @ 512px | 78.7% | 82.2% | $0.000162 |
| **B ∪ C** | v2 | both | **93.6%** | — | $0.000290 |

**The prompt was worth 13.9 points, free.** v1's exclusion list said "text-only pages", and the
production extractor catalogues **a staff of musical notation** as an image — 13 misses in
*Le Jeu de Robin et de Marion* were typeset text pages carrying medieval notation, confirmed on
all 13 by eye. v2 names notation, heraldic arms, and sparse line art explicitly, and warns against
**show-through** (v1 twice called ink bleeding from the far side of a leaf a "heraldic coat of
arms", while missing the real painted shield on the facing page).

**Precision is understated by the reference, not by the screen.** Of 29 hits with no gallery row,
20 were flagged by OCR as well; the expensive pass agreed and the 0.5 quality gate rejected them
afterwards. And at least one *miss* is a label artifact: `Nieuwe Maniere` p43's row describes a
fold-out bastion plan, but the leaf we hold scans nearly blank — the screen is right there.

**Resolution is NOT the dial — the misses are stochastic, and that is the design finding.**
Arm C gives the model 78% more pixels per page and recall does not move (78.7% vs 79.3%) at 27%
more cost. But B and C miss almost *different* pages: of ~40 misses each, only **12 are shared**;
512px recovers 27 that 384px missed and loses 28 that 384px caught. The model is inconsistent
rather than blind, so **two cheap passes at different tilings beat one pass at any density** —
`B ∪ C` reaches **93.6%** recall for $0.00029/page, still **6.8× cheaper** than one
full-resolution page call ($0.00196). Only 6.4% of labelled pages are missed by both.

Union-ing costs nothing in practice because a false positive is just one extra full-resolution
call on a page that was going to be cheap either way. My "fine hatched engravings need more
pixels" hypothesis was wrong and is withdrawn: the residual misses are not a contrast problem.

**Not measured.** Whether the screen finds pictures on free-filled books where there is no
reference at all — by construction those have no labels. Recall here is measured against what
production already found on books that went through the expensive path.
