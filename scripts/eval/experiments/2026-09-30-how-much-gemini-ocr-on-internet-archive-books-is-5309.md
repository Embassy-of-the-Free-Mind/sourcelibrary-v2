## 2026-09-30 — How much Gemini OCR on Internet Archive books is a neighbouring leaf's text, as readers see it? (#5309)

**Headline: 3.7% of decidable IA books (29 of 775, Wilson 95% CI 2.6–5.3%) show text of a neighbouring leaf beside the
page image, in contiguous runs. Projected ≈ 102K pages (book bootstrap 57K–159K), 97% translated; a lower bound
(undecidable books count as clean).** Another 6.5% of books carry the same text shift but a shown image shifted the same way,
so they read correctly on screen. That is #3368 class C and must not be re-OCR'd alone. 81 of 82 books with a run have
`bulk_jp2` pages. The run starts after the 25 IIIF-read preview pages. Offsets −1 (64 books), −3 (13), −5, −2, −7.
**Repair (not run): ≈ $240 ($130–370)**, being lite-batch re-OCR at $0.00148 plus lite-batch re-translation at about $0.00085 per page.
**Also:** `ia_djvu` free-lane text shifted in 9 of 85 decidable books (#4790 residue, consistent with #5361's 7/82).
**Design:** random-order walk (seed 5309) of 2,639 of 31,187 IA books; per page, bigram Dice vs the Archive's djvu leaves
±8, abstaining below 0.30 or within 0.15 of the runner-up; dHash of the shown image at three pages of each run. Controls:
7/7 known wrong-leaf pages fire (all `text_wrong_on_screen`). Of 150 by-eye-matched IA pages, 6 are flagged, and every
imaged one is `consistent_on_screen` or ambiguous, never `text_wrong`. **Lesson: text ≠ the record's leaf is not a
reader-visible error until the shown image is checked.** *Replicated?* No (one sample; the full walk is a documented command).
Artifact: `scripts/eval/results/ia-model-ocr-off-leaf-2026-09-30/`, `scripts/audit/ia-model-ocr-off-leaf.mjs`.
