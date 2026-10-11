---
stage: ocr
measure: none
languages: [la]
scripts: [Latn]
canons: []
n_books: 1
n_pages: 1156
verdict: "The Praetorius p.72 reference was pinned one leaf off; images were always correct, and after the 2026-10-01 re-OCR it belongs on page 130."
status: informational
decision: "latin-la-praetorius-syntagma1-p120 re-pinned from page_number 131 to 130; it can rejoin cross-engine rollups (#4732)"
superseded_by: null
issue: 4732
---
## 2026-10-11 · Is Syntagma musicum I really one leaf off between image and text?

**Headline: not any more, and the images were never the problem. The ground-truth
pin was off by one. It is now on page 130.**

- **Question.** The 2026-09-11 Cloud Vision entry found `latin-la-praetorius-syntagma1-p120`
  could not be pinned. At `page_number 131` the stored OCR read printed p.72, but every
  engine run over the archived image read p.73. Which artifact was wrong, and how much
  of the book did it affect?
- **Design.** All $0, no model calls. (1) Perceptual hash (`page-alignment.mjs`
  `hashBuffer`) of R2 `archived/<book>/<n>.jpg` against IA IIIF `page/n{n-2,n-1,n}`
  for n = 2, 131, 500, 1100. (2) Over all 1,156 pages: `ocr.updated_at` against
  `archive_metadata.archived_at`, and the histogram of `page_number − <page-num>`.
  (3) `build-reference-groundtruth.mjs --language=latin --only=praetorius` re-probe.
- **Result.**
  - Every archived image matches `photo`'s leaf `n{page_number−1}` at Hamming 0, with
    20–43 to the neighbours. So `131.jpg` is the correct leaf, and that leaf is printed p.73.
  - 1,119 of 1,156 pages were re-OCR'd on 2026-10-01 from the archived images. Over
    pages 125–136 the printed number runs `page_number − 58` with no gap or repeat:
    p.72 is at 130 and p.73 at 131. The 25 pages OCR'd before archival are front
    matter read from the same IA leaves. Readers no longer see facing-leaf text.
  - The reference probe now hits only page 130: guard 7%, CER 0.5%. The first pin
    (131) followed stored OCR that had been a reading of the neighbouring leaf. The
    builder pins by *text*, so it inherited that shift.
  - The entry in `reference-works/latin.json` now pins `book_id` + `page_number: 130`.
    A later re-probe cannot drift with the stored text again.
- **Not established.** Why the pre-October OCR sat one leaf off (it was overwritten,
  and no `page_revisions` rows survive for pages 130–131). Results scored before
  this date against page 131 (`results/benchmark/ref-pinned-2026-09-16.json`,
  `engine-wave{1,2}-6011`, `ocr-pareto-6293`) still carry the bad pin. Leave this
  slug out of those runs' rollups. Do not rescore them.
- *Replicated?* Deterministic (hash and query). *Artifact:* the re-pinned
  `ground-truth/latin-la-praetorius-syntagma1-p120.json`.
