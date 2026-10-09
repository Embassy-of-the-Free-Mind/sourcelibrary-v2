---
stage: ocr
measure: agreement
languages: [en]
scripts: [Latn]
canons: []
n_books: 246
n_pages: 4470
verdict: "Archive OCR words are fine (1-3 per mille glyph misreads) but numbers are not: 0.7-8.0% of years wrong per book, driven by typeface; flash-lite eye-skips 0.5% of interior pages."
status: informational
decision: null
superseded_by: null
issue: 5186
---
## 2026-09-30 — What does the Internet Archive's OCR get wrong? Class-by-class taxonomy on 4,470 Archive-vs-flash-lite page pairs (#5186)

- **Question.** The free OCR lane accepts Archive text at ≥ 0.80 sequence agreement; four
  reference books passed at 0.977–0.990 and still had wrong years. Which KINDS of error does the
  Archive make, at what rate per opportunity, and for which books is its text acceptable?
- **Design.** $0. Pairs already in `page_revisions` (source `ia_djvu`, reason `reocr_realtime`) ×
  current flash-lite `ocr.data`. Interior: 2,132 pages of four whole books (1890–1919 reference
  genre). Front matter: 2,338 pages of 242 lane books (one page per book pooled). Token LCS after
  stripping tags and running heads from both sides. Reading-order and misaligned pages get no
  token classes. Rates per opportunity, a book = one observation. 15 disagreements checked on
  the facsimile.
- **Result.** Words are fine (1–3‰ glyph misreads on prose, proper nouns 3–5× worse); **numbers
  are not**: 0.7% / 1.0% / 4.6% / **8.0%** of years wrong per book, driven by the TYPEFACE, not the
  engine or the genre. 613 of 614 3→8 swaps are in one book (flat-topped 3), and old-style figures
  give `1 → i` plus split years (`191 7`, 6.2% of Gate City's years). Other classes: capital R→E
  ×880 in one face, dot-leader tables → letter noise, drop caps → block moved to page end,
  genealogy superscripts → apostrophes, running heads kept inline on 78–95% of pages. Facsimile check:
  of 10 random draws, 9 were Archive errors and 1 a model error. **The other direction:** flash-lite eye-skipped a
  readable passage on 0.5% of interior pages (verified twice), which the Archive never does.
- **First-run retraction (same day, before any number left the worktree).** The first report
  counted year ranges (`1888-1891` vs `1888 1891`), footnote superscripts, misplaced running heads,
  and index-column misalignments (`137 → 138`) as misreads. Fixed in the script (ALIGNMENT HYGIENE
  in its header); Gate City's year rate moved 2.2% → 8.0% once split years counted, matching the
  earlier 25-page digit check (6.6%).
- **Replicated?** Deyo's 4.6% reproduces the earlier independent count (4.5%). Other books within
  1.4 points of it.
- **Artifact.** `.claude/docs/ia-ocr-error-taxonomy.md` (decision table),
  `scripts/eval/results/ia-ocr-error-taxonomy-2026-09-30/`, `scripts/eval/ia-ocr-error-taxonomy.mjs`.
