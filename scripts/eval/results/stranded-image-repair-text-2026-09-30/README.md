# Text stranded by the #3368 image repair: root cause and exact list (#5309)

PRIOR ART: `scripts/eval/results/ia-model-ocr-off-leaf-2026-09-30/` (PR #5398, the text-side detector and its 2,639-book sample, used here as the external check); `scripts/maintenance/repair-bulk-jp2-offset.mjs` (the repair that created the defect).

**Cause.** The bulk-JP2 archiver (#3368, fixed in #3369 on 2026-07-28) wrote each page the scan of a neighbouring leaf. Pages OCR'd after that archive was written read the shifted image, so their text agreed with what readers saw. On 2026-07-28/29, `repair-bulk-jp2-offset.mjs` re-archived the images of 710 books from IIIF. The images became right, and the post-archival text beside them became wrong. The script flagged those pages `needs_reocr: true` and noted that they "must be re-OCR'd (paid) in a follow-up pass". **No worker reads `needs_reocr`**, so that pass never ran. For two months every flagged page has shown the correct scan beside a neighbouring leaf's text and translation.

Evidence on the #5309 controls (Strutt p.82, Rajput p.26, Geronimo p.153, Oxyrhynchus V p.240): each book has `archive_metadata.jp2_offset_repaired_at` on 2026-07-29. Each control page carries `needs_reocr_reason: 'jp2-offset-repair-#3368'`, and its OCR is dated after `archived_at` and before the repair. For example, Oxyrhynchus p.240 was archived on 2026-04-07, OCR'd on 2026-06-26 and image-repaired on 2026-07-29. The 25 preview pages were OCR'd from IIIF before archival, which is why every run starts at page ≈ 26.

**Still live? No.** The archiver has been aligned since #3369, and the repair script now refuses to strand text (see below). In the #5398 sample, 482 shifted pages were OCR'd after 2026-07-28, in 25 books. 23 of those books are `consistent_on_screen`: their images were never repaired, so new OCR reads the same shifted image and agrees with it on screen. That is the #3368 class C cohort, which waits for the joint repair. One book (*The Rosicrucian*, p.8–18) was checked against the images: the displayed p.18 is a blank verso showing mirrored show-through of p.vii, which Gemini transcribed, so it is a detector false positive. One book (Leibniz, *Philosophischen Schriften* I) has 4 scattered pages and no bulk_jp2 pages, so it has a different cause and is not in this list.

## Exact list

`books.jsonl.gz` has one row per image-repaired book, with the stranded page ranges and page ids. It was produced by `scripts/audit/stranded-image-repair-text.mjs`, which classifies from timestamps (`strandedByImageRepair` in `scripts/lib/page-alignment.mjs`). A page is stranded when its OCR is later than `archived_at` and earlier than `jp2_offset_repaired_at`.

| | books | pages | translated |
|---|---|---|---|
| image-repaired books | 710 | | |
| with stranded text | **399** | **111,296** | **105,316** |
| of which live (`visible`, pages > 0) | 380 | 107,704 | 103,915 |

Other page classes in those books: 115,593 pre-archival (correct), 5,415 already re-OCR'd after the repair, 45,853 with no text, and 6,999 not from the zip. The flag and the timestamps agree: 0 stranded pages lack the flag, and 41 flagged pages have since been rewritten.

**Checked against the detector (#5398 sample).** 27 of its 29 `text_wrong_on_screen` books are in this list. The other two are the false positive and the unrelated book described above. Of 6,006 detector-shifted pages in those 27 books, 6,001 are on the list. None of the 50 `consistent_on_screen` books is on it, so the #3368 image+text-shifted cohort is excluded by construction. That cohort's images were never repaired. 45 Chinese books (6,820 pages) are on the list; the detector could not decide them.

**Known overstatement (small).** The archive shift for a page is the number of excluded leaves before it, E(p−1). Pages before the first interior excluded leaf were never shifted, so their "stranded" text is in fact correct. In the sample, pages the detector decided as aligned exceed pre-archival plus re-OCR'd pages by 21 pages across 4 of 37 books. Re-OCRing such a page is harmless.

**Why not the 29-hour full walk.** The walk exists to find pages whose text is off-leaf from any cause. For this cause, the list above is exact and takes minutes. The sample found no other cause at scale: after this list, 1 real book in 775 decidable, with 4 scattered pages. The walk stays available (see the #5398 README) if another cause is suspected.

## Repair price (not run; Derek's call)

| step | unit | all 111,296 / 105,316 | live only 107,704 / 103,915 |
|---|---|---|---|
| re-OCR, flash-lite **batch** | $0.00148/page (measured, EXPERIMENTS.md) | $165 | $159 |
| re-translate, lite **batch** | ≈ $0.00085/page | $90 | $88 |
| **total, both batch** | | **≈ $255** | **≈ $247** |

**Don't double-count the translation.** Rewriting OCR on a finished book makes the orchestrator's gap-fill re-dispatch its translation automatically. That happens on realtime lite (≈ $0.0017/page, so ≈ $179 instead of $90) and runs at the $5/day dial's pace (about 36 days). So there are two routes, not both: (a) hold the books before the OCR apply, then batch-translate them (≈ $255 in total), or (b) let gap-fill retranslate them (≈ $344 in total, slow). Route (a) is the cheaper one.

## Stopping a recurrence

- `repair-bulk-jp2-offset.mjs --apply` now refuses to re-archive a book whose repair would strand text, unless `--reocr-issue N` names the issue that owns the re-OCR. That issue is recorded on the book.
- `scripts/audit/stranded-image-repair-text.mjs` exits 1 while any stranded page remains. It is a check that stops failing once the repair lands.
