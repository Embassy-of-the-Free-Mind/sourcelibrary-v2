---
stage: ocr
measure: [judged]
languages: [fr, es, it]
scripts: [Latn]
canons: []
n_books: 177
n_pages: 177
verdict: "PENDING: rule and frame committed before the drafts were corrected or judged."
status: undecided
decision: "PENDING"
superseded_by: null
issue: [6871]
router_evidence: "none: score files in scripts/eval/route-judge-6740/results/euro-gpu-agy-cells-6871/; router table not edited"
---
## 2026-11-07 · French, Spanish and Italian print, 1600-1799 and 1800-1929: may GPU draft > agy Flash-low give first reads? (#6871)

Part of #6871.

PRIOR ART: `2026-11-04-jcb-pre1600-first-read-cell-8049.md` (the same route and rule on pre-1600 JCB print; its harness
`scripts/eval/route-judge-6740/jcb-1600-8049/run.mjs` is reused here with a `--study=euro-6871` frame, not rebuilt),
`2026-10-29-print1800-gpu-engine-lanes-6871.md` (bare GPU reads only; never Spanish), `2026-10-28-gpu-flash-vs-opus-7263.md`
(the router's `french-gpu-7263` evidence).

### Route under test (one per cell)
LightOnOCR-3-1B draft on gex45 (the JCB cell's recipe: `euro-gpu-correct-7567/drive.sh LO`, vLLM util 0.6), then agy
`gemini-3.8-flash-low` correcting with the page image, one page a call (`cli-ocr.mjs read --gpu-draft --correct-prompt`,
template `agy-0601ef30e816f7a7`). The written set is what `cli-ocr.mjs apply --diff-guard=gpu-draft --print-only` would
write. A bare GPU draft is never served.

### Rule (per cell, unchanged from #8049, fixed before judging)
At least 10 judged; wrong text ≤ 4%; P(acc ≥ 0.8) ≥ 0.9 under Beta(1+k, 1+n−k) over written pages; both wrong-page
controls rejected; planted errors not both missed. One page per book, seeded (salt `6871-<cell>`), 30 pages a cell.
A second draw, from books not yet sampled, only for a cell whose first draw comes close (as JCB did for Latin and French).
**The planter knows only la/fr/de: the Spanish and Italian cells have no planted control.** Their judge sensitivity
rests on the wrong-page controls and on the French cells' plants.

### Frame (drawn 2026-11-07, `run.mjs draw --study=euro-6871`)
- Book's first language is the cell's (`firstReadLanguage`); parsed `year` inside the cell (no year, no book; nothing after 1929).
- Page records exist: `pages_state` is not `manifest_only` (see *Where the pages are*).
- Not an unsplit spread (`needs_splitting` and not `split_completed`); not a manuscript (`manuscriptReason`).
- Not held, or held only `scans-only-publish-7270`. Every other hold (a lane, a campaign, a containment, a person's
  decision) is counted, not drawn.
- One page a book with no text and no human edit, between 5% and 95% of the book.

| cell | books in frame | pages owed (counter) | drawn |
|---|---:|---:|---:|
| French 1800-1929 | 562 | 35,678 | 30 |
| French 1600-1799 | 824 | 43,693 | 30 |
| Spanish 1800-1929 | 34 | 7,463 | 27 (every book with an unread body page) |
| Spanish 1600-1799 | 67 | 14,223 | 30 |
| Italian 1800-1929 | 81 | 6,308 | 30 |
| Italian 1600-1799 | 132 | 11,644 | 30 |

### Where the pages are
Unread pages by book counters (`pages_count − pages_ocr`), 2026-11-07, books with a year in the band:

| | manifest-only books (no page records) | books with page records |
|---|---:|---:|
| French 1800-1929 | 1,132,382 (2,547 books) | 46,807 (625) |
| French 1600-1799 | 2,584,001 (9,581) | 81,818 (961) |
| Spanish 1800-1929 | 3,818 (14) | 8,059 (37) |
| Spanish 1600-1799 | 34,695 (116) | 16,332 (73) |
| Italian 1800-1929 | 227,004 (603) | 6,445 (95) |
| Italian 1600-1799 | 487,351 (1,715) | 30,993 (213) |

A `manifest-only-lazy-pages` book (#7343, `scripts/lib/lazy-pages.mjs`) holds its IIIF manifest and true page count and
**no page docs**; `materializePages()` creates them on a reader's first open, on hold release, on publishing or for an
archiver, and moves `pages_state` to `materialized`. `cli-ocr.mjs` read and apply both look pages up by id, so these
books cannot be read through the route without materializing them, which is a state change this test does not make.
**This result therefore speaks only for books with page records.** Those are mostly Internet Archive scans; the
manifest-only mass is e-rara and BSB (French: e-rara 2.6M, BSB 0.94M pages).

### Results
PENDING.
