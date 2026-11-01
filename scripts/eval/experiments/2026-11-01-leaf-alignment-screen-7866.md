---
stage: image
measure: accuracy
languages: []
scripts: []
canons: []
n_books: 47435
n_pages: 10617527
verdict: "A judge-free leaf-alignment screen over all 47,435 live OCR'd books confirmed 631 books (2,336 pages named) where a page's text and its image are different leaves: 206 with text on a blank leaf, 408 with one text on two different images, 17 with images off their source leaf. Validated before the corpus run: on 52 books read by eye on #5803 (2026-10-17/18), precision 29/29 (95% CI 0.88-1.00), specificity 8/8, recall 29/44 = 0.66 (0.51-0.78). On the 160 books Opus judged on #7866, recall 2/2 and 4 flagged books, all real by eye. Top-20 spot check by eye: text-on-blank 4/4 and repeat 4/4 real; image shifts are reader-visible in 3 of 11 checkable (the rest consistent on screen, only the source pointer off). Bulk-JP2 books never repaired: 8/200 (4.0%, 2.0-7.7%) have images off their source, about 760 of 18,994 books; 1/200 is reader-visible. 17 pages in 13 books contained."
status: informational
decision: "Derek's (#7866): run the screen as a standing audit; the repair route for the three classes; whether the #3368 repair gate is widened to offsets beyond +1."
superseded_by: null
issue: [7866, 5803, 3368, 5309]
---
## 2026-11-01 · Which pages carry another leaf's text? A judge-free screen over every live OCR'd book (#7866)

PRIOR ART:
- `scripts/audit/page-integrity.mjs` walks a local mirror this box lacks, and its duplicate check compares N with N+1 and N+2 only (`duplicateScan`).
- `scripts/audit/ia-model-ocr-off-leaf.mjs` covers IA books only. It matches the text against the Archive's own OCR and abstains where that OCR is junk: on the 1488 incunable `69af4864…`, 3 of 248 pages scored.
- `scripts/audit/bulk-archive-alignment.mjs` / `scripts/lib/page-alignment.mjs checkAlignment` dHash the archived image against its source at offsets 0 and +1 only, so `69af4864…` (−3) reads `ambiguous`.
- `scripts/eval/jev/clef-*` (#5803) puts a model on every page.
- `scripts/audit/page-repeat-images.mjs` compares images with no text.
- Reused unchanged: `block-drift.mjs sourceProse`, `page-integrity.mjs foldWord`, `page-alignment.mjs hashBuffer`/`hammingHex`, and the thumbnail correlation `page-repeat-images.mjs` validated on #5056.

Code:
- `scripts/lib/leaf-alignment.mjs` (pure signals and the confirm rule; tests in `tests/unit/leaf-alignment.test.ts`).
- `scripts/audit/leaf-alignment-screen.mjs` (stages `scan`, `arbitrate`, `rank`).
- Results: `scripts/eval/results/leaf-alignment-screen-7866/`.
- Raw rows (47,435 scan rows, every arbitration): R2 `sl-corpus-snapshots` `cold/l7a/leaf-screen-7866/leaf-alignment-screen-2026-11-01.tar.zst` (9,571,154 bytes, sha256 `8d818e31…7b96c4`).

**Question.** Both books contained on #7866 showed the same failure: page text that is another leaf's. In one, the text sits 3+ leaves off its images; in the other, a blank leaf carries text and the opening is repeated. Can that be found in every live book without a judge?

### Method

**1. Scan (free: Mongo only, 22 min on earthai-l7a; no API, no model).** Per book, for every visible page, the scan reads: the first 1,200 characters of `ocr.data` and its length, `page_type`, `archive_metadata.{bytes,source}`, and `image_width`/`image_height`. Three signals come out of it:
- **Repeat.** Word 5-gram shingles (letter 8-grams in unsegmented scripts) are compared across all pages of a book. Shingles on more than a quarter of the pages are dropped as boilerplate. A pair is kept at containment ≥ 0.6.
- **Text on a near-blank image.** A text of ≥ 300 prose characters, mostly letters, whose image weighs under 0.25 of the median for that archiver. Weight is bytes per megapixel, from bytes the archiver already stored.
- **Offset.** Text length against image weight, correlated at shifts −6…6. Illustrated pages are left out (a herbal alternates plate and description).
  - A #3368 repair re-archived images without rewriting `archive_metadata.bytes`. Bytes on repaired books' `bulk_jp2` pages are stale (`69e41331…` p.29: stored 534,384 B is the old leaf 30), so they are ignored.

**2. Arbitrate (free: our R2 images and the providers' source images).** Each candidate is checked against the images themselves:
- **Image shift.** The shown image is dHashed against the source image of pages n−6…n+6. Where dHash cannot separate two pages of one layout, a 64×80 thumbnail correlation decides.
  - The Archive's `page/nK_s4.jpg` is the same leaf as its IIIF form (dHash 2) and ~4× faster.
- **Blank.** The shown image's ink share: pixels 15 grey levels under the paper.
- **Repeat.** dHash between the two shown images.

**Confirmed (`confirmed()`)** when any of these holds:
- ≥ 2 of 3 sampled pages show an image off its source leaf (k ≠ 0, not necessarily the same k: a #3368 shift grows, e.g. `69e53425…` −6/−4);
- a text sits on an image with < 0.5% ink;
- one whole text sits on two different images (containment ≥ 0.9, sizes within 0.8, ≥ 50 shingles, no cover/title page, image dHash ≥ 20).

### Validation, before the corpus run

The ink and repeat thresholds were set on these two sets (every false alarm opened by eye is a shape the rule now refuses), so the top-20 spot check below is the out-of-sample test.

| set | n | recall | precision | specificity |
|---|---|---|---|---|
| #5803 Clef audit, read by eye 2026-10-17/18 (43 wrong-leaf + #7321; 8 read right) | 52 | 29/44 = 0.66 (0.51–0.78) | 29/29 = 1.00 (0.88–1.00) | 8/8 (0.68–1.00) |
| #7866 Opus draw, positive = an I1 page | 160 | 2/2 | 2/4 vs Opus labels; 4/4 by eye | 156/158 (0.96–1.00) |
| #7866 I1 pages | 800 | 4/6 (0.30–0.90) | 4/5 (0.38–0.96) | — |

- **The two extra Opus-set flags are real defects on pages Opus did not sample**, opened by eye:
  - `6a060d36…` p.1: a blank leaf carrying invented Latin ("De natura et proprietatibus elementorum") in a Sanskrit book.
  - `69ac5f7c…` p.8: a blank leaf whose mirrored show-through was transcribed as its text.
- **Missed:**
  - text-side shifts on e-rara books whose images are their own leaves and whose text has no blank leaf or repeat at the shift;
  - books with no stored image bytes;
  - #7321, whose text comes from ~650 pages away, outside every window.
- **O1 confabulation is not this class:** recall 0/20.
- **False alarms found by eye and designed out:**
  - a printed wrapper repeating its title page; a leaf re-shot inside a spread; a leaf re-shot under a BSB calibration card;
  - the Archive's OCR noise on a tissue leaf;
  - a washed-out contents page read as blank at a 50-level ink threshold;
  - bytes offsets driven by book structure (`6992cf0e…` herbal, `6990795b…` pothi). Because of these the bytes offset only nominates; it never confirms.

### Corpus run (2026-11-01, 47,435 books)

**Scan coverage:**
- 46,844 books can be judged for repeats, 34,560 for ink and 29,941 for the offset.
- Candidates: 836 books with text on a near-blank image, 2,811 with a near-complete repeat, 539 with a bytes offset, and 18,994 with `bulk_jp2` pages the #3368 repair never re-archived (4,205,486 pages).

**Arbitrated:**
- every blank and repeat candidate (3,469 books);
- a seeded random 200 of the 18,994 bulk-JP2 books (seed 7866);
- 49 of the 539 offset candidates. **Stopped there**: the Archive answers at ~2 s an image, and the offset signal is the weakest.

**Confirmed: 631 books, 2,336 pages named** (`ranked.md`, `ranked.json`):

| class | books | pages named |
|---|---|---|
| text on a blank leaf (+ any repeats in the same book) | 206 | 558 |
| one text on two different leaves | 408 | 1,679 |
| image off its source leaf | 17 | 99 |

- Languages: English 248, Latin 128, German 68, French 40, Greek 30, Italian 20, Sanskrit 16, Chinese 10, Russian 9, Hebrew 7, and others.
- These are counts of books with ≥ 1 confirmed page, not of bad books. The precision is the spot check below.

**Bulk-JP2 prevalence (sample n = 200 of 18,994):**
- 182 aligned, 8 shifted, 1 single off page, 7 undecided, 2 with no source.
- Shifted: **8/200 = 4.0% (2.0–7.7%), about 760 books (388–1,461)**. All of them are outside the #3368 repair, which only handled +1.
- Reader-visible (text OCR'd from the source before the archive): **1/200 (0.5%)**, about 95 books. In the other 7 the text was OCR'd from the shifted image and agrees with it on screen; only the record's source pointer is wrong.

### Spot check: top 20, by eye (`spot-check.json`)

| class | opened | reader-visible defect | not a reader defect |
|---|---|---|---|
| image off its source leaf | 12 | 3 (`69af2362…` Festus −5, `69af37bc…` Lomonosov −3, `69af13c5…` Ptolemy −3) | 8 consistent on screen (2 are BSB numbering drift); 1 has no OCR on the sampled pages |
| text on a blank leaf | 4 | 4 | — |
| one text on two leaves | 4 | 4 | — |

- Inside the opened books, 5 of 6 repeat pairs were true misplacements. 1 was the same printed page photographed twice (an opening and a flat shot).
- **An image shift is a reader-visible defect only where the text was read from the source leaf before the archive.** In the Archive books the dates predict which: `image-shift-ocr-dates.json` (Festus 425 pages before, Lomonosov 523, Ptolemy 472). In BSB books they do not, because BSB's numbering moved under both.
- The repeat class is dominated by that same mixed state. A book OCR'd partly before and partly after a shifted archive holds each text twice, |k| pages apart: Festus p.439 = p.444, Grammatici Latini 516 = 537.

### Containment (containment-on-finding.md, by eye only)

- **13 books held**, under three reasons:
  - `wrong-leaf-blank-7866` (2 books);
  - `wrong-leaf-image-shift-7866` (3 books);
  - `wrong-leaf-screen-7866` (7 books, plus one already held for `title-leaf-recitation-6297`).
- **17 pages' English withheld:**
  - `6a060d36…` 1, `69ac5f7c…` 8;
  - `69af2362…` 439, `69af37bc…` 433, `69af13c5…` 120;
  - `6a357a2a…` 7, 520; `69e745f6…` 13, 24; `69b63e85…` 5, 17; `69e72994…` 7;
  - `69af4395…` 516; `69af3988…` 516; `69af453b…` 515; `69af4a2f…` 500.
- Undo: `restore-withheld-translation.mjs`; `hold-pipeline-books.mjs --release-held --reason <reason>`.
- No OCR or translation write, no re-read. The other pages on the ranked list are a detector's output and are not withheld (containment-on-finding.md: a predicate over thousands of pages goes through a dry run and approval).

### Limits

- The offset class is barely run (49/539).
- The bulk-JP2 census is a 200-book sample, not a census.
- Recall on text-side shifts with no blank leaf or repeat is low.
- Books without stored image bytes (27% of the frame) get no ink or offset signal.
- Thresholds were set on the validation sets. The spot check is n = 20.
- Run: 2026-11-01 00:50–03:00Z on earthai-l7a. $0, no model call.
