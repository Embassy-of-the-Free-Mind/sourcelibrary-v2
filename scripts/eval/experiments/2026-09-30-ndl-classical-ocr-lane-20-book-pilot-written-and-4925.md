---
stage: ocr
measure: [judged, agreement]
languages: [ja]
scripts: [Jpan]
canons: []
n_books: 20
n_pages: 1087
verdict: "On 20 cursive Japanese books NDL and stored Gemini readings barely agree (median Dice 0.067); by eye NDL gives the page's text on 9/10 pages, Gemini was invented or looping on 3 of 4."
status: adopted
decision: "NDL classical-OCR lane shipped (PR #5412); 985 pilot pages written, 356 translations marked stale"
superseded_by: null
issue: [4925, 4745]
---
## 2026-09-30 · NDL classical-OCR lane — 20-book pilot, written and read by eye (#4925, #4745)

- **Question.** Run end to end on whole books, does the NDL lane give readers the page where the stored Gemini reading does not?
- **Design.** 20 census-cursive books, one per series (the shortest of 15–150 pages; 12 visible), 1,087 pages; all HELD
  first. NDL古典籍OCR ver.3 (commit 939cbfa) on one leased L4 (pl-waw-2): 1.8 s/page, 33 min inference, ≈ 85 min billed
  (≈ €1.10) including a missed pull window. Paired stored-vs-NDL agreement on every page; 10 pages opened against the image.
- **Result.** 635 pages had no reading (first writes), 452 had one; 48 of those were loops (NDL 0). **The arms barely
  agree (median character-bigram Dice 0.067 on 452 pages)**: not two noisy readings of one text. By eye: NDL gives the
  page's text on 9/10 opened pages (slips in rare kanji); the Gemini reading was invented or a loop on 3 of 4
  image-checked paired pages and partly right on 1 (an omikuji verse). NDL's visible failure: large display type and
  margin marks become short noise lines. 102 textless NDL reads (pictures) were not stored. Written: 985 pages,
  404 revisions saved, 356 English translations marked `translation_stale` (books held; no re-translation queued).
- **Replicated?** Consistent with #4745 (NDL coherent 10/10 on 45 cursive pages); first run on whole books.
- **Artifact.** `scripts/eval/results/ndl-koten-pilot/` (compare.json, eye-read.md, books.json, box.json);
  `scripts/workers/ndl-koten-lane.mjs`, `scripts/gpu/ndl-koten-box.sh`.
