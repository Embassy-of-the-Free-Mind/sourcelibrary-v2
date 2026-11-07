---
stage: metadata
measure: accuracy
languages: []
scripts: []
canons: []
n_books: 775
n_pages: null
verdict: "First full pre-OCR duplicate screen: 167 queued copies of a printing we already read (or are reading) held, 47,696 unread pages; 23 holds checked by eye, 2 wrong (both reissues with a different imprint year, now excluded). Two instrument faults found and fixed: provider watermarks and reissued sheets."
status: informational
decision: "Hold same-printing unread copies before paid OCR (reason same-edition-copy-unread); never across differing imprint years."
superseded_by: null
issue: [4285, 6019]
---
## 2026-10-22 · Screening the OCR queue for copies we already hold, by page images (#4285)
<!-- PRIOR ART: scripts/eval/experiments/2026-10-21-page-image-same-printing.md (the calibration this run applies at scale); src/lib/holdings-check.ts (candidates); scripts/audit/pre-ocr-duplicate-screen.ts (#7132, #7134, #7139, #7142). -->

**Question.** Of the books about to be OCR'd at priority ≥ 50, how many are copies of a printing we already hold, and can they be held back without a person reading each one?

**Frame.** 775 books in `archive_complete`/`queued` with `processing_priority >= 50` (2026-10-22). `checkHoldings()` proposed 1,281 candidate pairs for 441 of them; 305 pairs whose page counts differ by more than 15% were recorded and not image-checked (another volume or an incomplete scan; no hold could follow). 976 pairs were checked with `page-image-same-printing.py`.

**Result** (count).

| verdict | pairs |
|---|---:|
| same printing | 348 |
| different | 593 |
| unclear | 35 |

`decide` held **167 books, 47,696 unread pages** (133 because the other copy is read, 3 because it is further along, 31 where both were queued and one was preferred). 71 of the 167 scored 3,000, the cap: the same scan imported twice under two records, which the import gate's source fingerprints did not catch. 135 same-printing pairs did not qualify for a hold and went to the review list (#4285 comment), with 48 more from a second set: same-edition-key pairs where both copies are public or both read (387 pairs checked).

**By eye** (image opened; title pages and first 8 leaves of both copies, 23 holds: the 8 lowest-scoring and 3 random from the first 542 verdicts, then the 8 lowest and 4 random of the rest). 19 confirmed by matching title pages, imprint and year; 2 not confirmable from the first leaves (one copy's scan opens at the back) and not contradicted; **2 wrong**, both reissues whose interior sheets match: Melanchthon *Elementorum rhetorices* 1546 vs 1544 (median 42), *Oracula magica Zoroastris* 1599 vs the 1607 reissue (median 43). Both are now excluded by a rule (no hold when the two imprint years differ; #7139); the 23 contain no other year mismatch.

**Two instrument faults found at scale** (not visible in the 25-pair calibration):
1. *Provider watermarks.* National Museum, New Delhi stamps one logo on every photograph; ORB matched it, and about 30 unrelated "A Manuscript on Music" items scored 40–270 (a music-notation grid against Persian prose, by eye). Inliers now count only when their central 80% box covers ≥ 8% of the leaf; the four museum pairs fell to 0, seven same printings unchanged (#7134).
2. *Reissues and page-for-page reprints* share sheets, so the images cannot separate them; the imprint year does (#7139).

**Operational.** The first run cached full-size originals and filled gex45's disk (111 GB, ~18 minutes); the cache now stores 1000 px grayscale (#7142), and OpenCV runs one thread per process (#7134). About 75 minutes of 12–18 processes for 976 pairs on gex45.

**Limits.** The by-eye sample is 23 of 167; the 2 errors sat at the two lowest scores, and the rule that removes them was found on this sample, so the post-rule error rate is measured on the same 23 (0 of 21). 54 unclear pairs are being re-run. `pages_ocr` is taken as "read"; a stale counter would mis-state that reason, not the same-printing verdict.

**Use.** Holds are released with `hold-pipeline-books.mjs --release-held --reason same-edition-copy-unread --ids <file>`; `pipeline_auto.hold.detail.kept` names the copy each hold defers to.
