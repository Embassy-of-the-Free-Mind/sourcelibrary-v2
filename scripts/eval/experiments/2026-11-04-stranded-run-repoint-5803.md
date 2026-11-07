---
stage: pipeline
measure: none
languages: [en, de, es, la]
scripts: [Latn]
canons: []
n_books: 26
n_pages: 954
verdict: "In 26 live Internet Archive books, 86 whole runs of text sat one leaf after their image (k=-1; one run k=-3), left behind when the shifted bulk-JP2 images were re-archived to the source leaf. Blind by-eye checks against the source leaf confirmed 85 of 86 runs, and 257 of 258 opened slots, across both ends of each run. 954 pages were re-pointed at $0 with revisions, plus 31 chapter starts. 9,044 live stranded pages in 294 books still need a read (10,112 before)."
status: adopted
decision: "Repairs applied through scripts/maintenance/repair-text-offset-segments.mjs (sources shift-repair-segments-5803, backups in the job scratch) and repoint-chapters-after-text-shift.mjs (sweep_log repoint-chapters-5803); the needs-a-read list is in scripts/eval/results/stranded-repoint-5803/needs-read.json for a separate read job (#5803)."
superseded_by: null
issue: [5803, 5309]
---
## 2026-11-04 · Stranded text runs re-pointed to their own leaf (#5803)

PRIOR ART: `scripts/maintenance/repair-text-offset-segments.mjs` (#7949, commit 333bc84bf) is the
writer, reused; `scripts/audit/stranded-image-repair-text.mjs` (#5309) is the frame;
`scripts/audit/ia-model-ocr-off-leaf.mjs` is the detector. New this run: the writer's by-eye gate
works without a IIIF manifest (IA manifests carry ordinal labels, which never score), and
`repoint-chapters-after-text-shift.mjs` handles lane 3 for chapters.

**Who it is for.** Someone reading a page image next to a transcription and an English translation
that belong to the page before. Derek, 2026-11-04: "pages not reflecting the text... a big issue".

**Pre-registered** (written before any result was read): frame = live books with a #5309 stranded
run of at least 5 pages (46 books). 10 were excluded before measuring: 9 had a live lane writing in
the last 3 days, and Talmud Bavli is on the #5699 renumber list. That left 36 books. Repair rules:
R1, at least 80% of scored pages share one offset k≠0, with a scored page within 3 slots of each end.
R2, the shown R2 image is the source leaf. R3, by eye on at least 3 slots including both ends.
R4, moves stay inside the run. R5, no human-edited text, no split pages, and text never leaves its book.

**Detector (model-free).** The detector matched each page's text against the Archive's own OCR of
leaves k−8..k+8. It found 113 runs of 5 or more pages (1,802 pages); 86 runs (1,032 pages,
26 books) pass R1. Every passing run is k=−1 except one in Outline of the Vedanta (k=−3).
The biggest-cluster artifact showed up as expected: the largest "stranded" run, Buddhism in
Translations (528 pages), is Archive djvu text that the classifier counts, and the detector reads it
as ALIGNED. The Path of Light is the same case. Neither is a defect, and neither was written.

**By eye (R3).** Opus subagents, blind A/B: the source IIIF leaf (top half), the text that the move
puts on the slot, and the text the slot holds now, in shuffled order. Each run was checked at its
first slot, its middle and its last moved slot. The test book (Esoteric Christianity) was checked by
hand at 6 slots. Results: 257 of 258 slots chose the moved text. One run failed: Lucifer Vol 3,
334–338, whose head slot holds neither neighbour, so it is listed and not written. Run precision is
85/86. There were 10 planted controls (aligned fresh slots: own text vs the next slot's text). 7
chose their own text, 2 said "both" (the two slots carry the same text), and 1 chose the neighbour,
which holds a duplicate of the same leaf (Kant 687/688). None contradicts the key. R2: the shown R2
image matched the source leaf by dHash (distance 0) on every sampled slot in all 25 books.

**A finding the rule did not anticipate.** At each run head the writer orphans one slot's text,
which pre-registration assumed was a duplicate of the fresh read on the leaf before it. On 17 heads
it was not, and 10 of those were opened by eye. In those 10 the fresh read of leaf a−1 is a stub:
empty, or a header plus a keyword list with no body (Oct 01 reads). The stranded slot held the
**only** full transcription of that leaf. Those segments were extended to start at a−1, checked by
eye on the new slot: True History of the Conquest of Mexico ×8, Kritik der reinen Vernunft 654,
Rajput Painting 38, and Vedanta 47 and 49–51. Nothing was orphaned that was not a duplicate or
snapshotted.

**Applied.** 26 books, 954 pages. That is 940 this session plus 14 on the test book, with 1,809 +
28 `page_revisions` rows, each book's run id in `book_events`, mirrors synced, `page_translations`
embeddings permuted with their text, `needs_reocr` cleared on pages that received their own text, and
every book revalidated. Served HTML was read on 4 pages in 4 books: each now shows its own leaf's text.

**Lane 3** (derived-metadata-lane.md). 46 chapter starts fell in a moved range. 31 of them had their
heading on the new slot and not on the old, and were moved (9 books, old lists in `sweep_log`). The
other 15 were left: their heading was not found on the new slot alone. **Not repaired:** `book_indexes`
page citations in these books were derived from the shifted text, so citations inside the moved
ranges point one page late. That needs a regenerated index, which is a model spend and is listed on
the issue. Summaries do not depend on page addresses.

**Left, in `needs-read.json`.** 9,044 live stranded pages in 294 books, each with a status and a
route from the OCR lane decision tree:

| status | books | pages |
|---|---:|---:|
| repaired runs; run tails and isolated stranded pages remain | 26 | 1,859 |
| isolated stranded pages and runs under 5 (re-pointing cannot help: their own text is on no page) | 248 | 3,803 |
| run ≥ 5, fails R1 (Talmud Yerushalmi, Avesta, Suggestive Inquiry abstain; Household Management, Lucifer 3 and 6 mixed; Buddhism in Translations and Path of Light read as aligned) | 10 | 1,601 |
| deferred: live lane in the last 3 days | 9 | 1,340 |
| deferred: #5699 renumber (Talmud Bavli) | 1 | 441 |

The tail slot of each repaired run (about 85 pages) now carries a duplicate of the page before it.
These pages stay flagged `needs_reocr` and are not withheld. Withholding a detector-defined set needs
approval under containment-on-finding.md.

**What the detector cannot see.** Books outside the Internet Archive. Pages where the Archive's OCR
is junk (non-Latin scripts, plates). Isolated stranded pages. Text-side shifts that no image repair
produced (#7949's canvas-label detector covers e-rara). Shifts by more than 8 leaves.
