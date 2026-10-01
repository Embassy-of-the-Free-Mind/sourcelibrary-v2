# Model OCR written off-leaf on Internet Archive books (#5309)

PRIOR ART: `scripts/eval/results/leaf-identity-2026-09-30/` (the hand read that found six such pages in the #5274 audit sample; its 150 matched IA pages are the negative control here); `scripts/audit/ia-ocr-leaf-drift.mjs` (free-lane `ia_djvu` text only).

**Question.** On an Internet Archive book, how often does a reader see a page image next to Gemini OCR text (and so a translation) of a *different* leaf? The answer sizes a paid re-OCR.

**Answer.** In a random sample of 2,639 IA books (8.5% of the 31,187 IA books with OCR), **29 of 775 decidable books (3.7%, Wilson 95% CI 2.6–5.3%) show text of a neighbouring leaf beside the page image across a contiguous run of pages.** That is 8,642 pages in the sample (8,372 translated). Projected to the frame, it is **≈ 102,000 pages (book-bootstrap 95% CI 57,000–159,000)**. This is a lower bound, because the 1,785 undecidable books (mostly Chinese, where the Archive's engine reads nothing usable) count as clean.

A further 50 books (6.5%, projected ≈ 94,000 pages) carry the same text shift, but their *shown image* is shifted the same way. They read correctly on screen and are off only against the record's leaf pointer. That is #3368's image class (and #4790 class C), not a reader-visible error. Re-OCRing their text alone would *create* a visible error. Six books (≈ 17,000 pages) are ambiguous on the image side.

**Where it comes from.** 81 of the 82 books with a shifted run carry `bulk_jp2` archived pages; 1 of 323 decidable books without them does. By OCR run, shifted share of decided pages: `batch_api|flash-lite-preview` 25.8%, `pipeline_preview|flash-lite-preview` 30.3%, `batch_api|flash-preview` 7.5%, realtime `ai|flash-preview` 0.9%. The shape is whole books from page ≈ 26 on: the first 25 preview pages were read from IIIF and are aligned, and the bulk of the book was read from #3368-shifted R2 images that have since been re-archived. Offsets: −1 (64 books), −3 (13), −5 (3), −2 (3), −7 (1).

**The Archive-text lane (#4790 residue).** The same comparison over `ia_djvu` pages that the free lane wrote finds shifted runs in 9 of 85 decidable books (956 pages in the sample). They include *The Path* series and Washington's *Writings* (583 pages at −3), which is consistent with the 7/82 found by the #5361 cohort check. Those texts have no translation.

## Repair estimate (not run — Derek's call)

For the text-wrong-on-screen pages only, the fix is to re-OCR each page against its shown image and then re-translate. The image is right; don't touch it.

| step | unit price | pages ≈ 102K (57K–159K) |
|---|---|---|
| re-OCR, flash-lite batch | $0.00148/page (measured, EXPERIMENTS.md) | **$151** ($85–235) |
| re-translate, lite batch | ≈ $0.00085/page (half the $0.0017 realtime rate) | **$87** ($49–135) |
| **total** | | **≈ $240 ($130–370)** |

A full walk (below) replaces the projection with an exact page list. The 50 consistent-on-screen books wait for the joint #3368 image + text repair.

## Method

- **Instrument.** `scripts/audit/ia-model-ocr-off-leaf.mjs`. Per page, the model text is scored against the Archive's `_djvu.xml` leaves k−8 … k+8 by token-bigram Dice (`scripts/lib/leaf-offset-match.mjs`), and the best offset must clear 0.30 and beat the runner-up by 0.15. Otherwise the page abstains (`low` / `ambiguous`). A book "has a run" at ≥ 2 decided pages shifted by one offset; a book is decidable at ≥ 5 decided pages. `--stage=images` dHashes the shown image against IIIF leaf k and k+offset at three pages of the longest run.
- **Sample.** Books in a fixed pseudo-random order (sha1 of seed 5309 + id), walked for 200 minutes on Hetzner. The walked prefix is a simple random sample of the frame. Pages cluster by book, so page-level intervals are book-level bootstraps.
- **Positive controls, all seven fire:** the six #5309 pages (Strutt p.82, Rajput p.26, Geronimo p.153, Yucatán p.371 at −5, Oxyrhynchus p.240, Quixote p.269 at −3), plus *Comedia famosa* p.36 from tq12. All six imaged books read `text_wrong_on_screen`.
- **Negative control:** the 150 IA pages the leaf-identity read found matching. 144 are not flagged. Of the six that are, the one probed (al-Kindi p.110) has model text = printed p.69 = leaf n108, the shown image is p.69, and the record points at n109. Image stage for the eight negative books with runs: 6 `consistent_on_screen`, 2 ambiguous, 0 `text_wrong_on_screen`. **So "text ≠ record leaf" alone overstates what readers see; always quote the image verdict with it.**
- **Limits.** The image stage checks model-lane runs only. Pages of 17th-century verse and other poor Archive OCR sit near the 0.30 floor (*Comedia famosa* p.36 decided at 0.31). 39 books have only lone off-leaf pages (64 pages), reported apart and not counted.

## Files

`summary.txt` / `summary.json` (all strata), `books.jsonl.gz` (one row per walked book), `pages.jsonl.gz` (every shifted or far page, with `lane`), `images.jsonl`, `meta.json`, `controls-*.jsonl`.

## Full walk

Resumable on the same order: `node --env-file=.env.production.local scripts/audit/ia-model-ocr-off-leaf.mjs --cache /root/sl-ia-cache --out <dir>/walk.jsonl --max-minutes 200`, repeated until done (about 29 hours at 18 books/min), then `--stage=images` and `--stage=summary`.
