---
stage: translation
measure: none
languages: [sa, pi, hi, zh, lzh, bo, ja, ko, ar, fa, he, syc, la, de]
scripts: [Deva, Hani, Tibt, Arab, Hebr, Latn]
canons: []
n_books: 6203
n_pages: 1103532
verdict: "Whole-page English shifts are not confined to Śakuntalā: a number-vote detector flags 80 of 5,903 caseless-label books and 19 of 300 other books (6.3%, 4.1 to 9.7), and 12 of 20 flagged pages opened as scans carry a neighbour's English; one was written by the chained Batch lane on 2026-10-05, after the parser guards."
status: undecided
decision: null
superseded_by: null
issue: [5021, 6672]
---
## 2026-10-13 · How many books carry a whole-page English shift, and can numbers find it where case cannot? (#5021)

PRIOR ART: `scripts/maintenance/detect-translation-misalignment.mjs` compares the printed page number in both layers;
`scripts/lib/block-drift.mjs` and `scripts/audit/translation-page-boundary.mjs` test one clause at a page edge by
letter case and make no claim on caseless scripts. Both missed Śakuntalā pp.291-295 (#6672). Neither reads the
numbers a leaf prints in its body.

**Design.** `scripts/audit/translation-leaf-shift.mjs`, read-only, $0, no model. For each page, the numbers in the
body of the transcription (digits of any numeral system, CJK numerals, upper-case Roman) against the numbers in the
body of the English. A number in page N's English votes `own`, `next` or `prev` when it is printed on exactly that
one of the three leaves. Left out: numbers under 10, bracketed numbers under 100, and the running head of both
layers (on the shifted Śakuntalā pages the head was right and the body was the next leaf's). A page with only
neighbour votes is `next` or `prev`; a book is flagged on 2 or more consecutive such pages in one direction.
Tier A, fixed before any scan was opened: every page of some run also lacks one of its own numbers and votes with a
number of 30 or more. Tier B: the other flagged books.

Frames, 2026-10-13, live Mongo: every book with translated pages whose language label is a caseless script (5,903
books, 1,032,812 translated pages), and a seeded draw of 300 from the other 20,404 (70,720 pages).

**Positive control.** Śakuntalā (`69dea23c4d19ec2e9ba75f5e`) with its English rebuilt from `page_revisions` as of
2026-10-13T00:00Z (6 pages restored): one run, pp.291-294, each page voting the next leaf's verse number (171, 172,
173, 174), head class `own` on pp.292-294. On the live, repaired text: no run. p.295 (a summary, no number) is not
seen.

**Result, by book.**

| frame | books | flagged | rate (95% Wilson) | tier A | tier B |
|---|---:|---:|---|---:|---:|
| caseless-label books, all of them | 5,903 | 80 | 1.36% (a census, no sampling error) | 18 | 62 |
| other books, random 300 of 20,404 | 300 | 19 | 6.3% (4.1 to 9.7) | 8 | 11 |

Flagged books by dominant script of the transcription, caseless frame: Devanagari 36 of 395, Han 18 of 2,347,
Latin (transliterated or bilingual editions) 14 of 819, Arabic 5 of 334, Hebrew 3 of 262, Japanese 3 of 130,
Cyrillic 1 of 1, Tibetan 0 of 1,583, Hangul 0 of 14, Syriac 0 of 12. By label: Sanskrit 36 of 413, Chinese 12 of
2,038, Arabic 6, Hebrew 5, Korean 5, Japanese 4, Pali 3 of 39, Hindi 3 of 21, Syriac 2, Persian 1, Ge'ez 1,
Tibetan 0 of 1,593.

By the prompt era of most of the book's pages:

| frame | era | books | flagged | tier A |
|---|---|---:|---:|---:|
| caseless | block prompt (v10/v11) | 1,459 | 46 (3.2%) | 14 (1.0%) |
| caseless | v12/v13 | 3,340 | 12 (0.4%) | 3 |
| caseless | older, single-page (v1 to v6) | 1,104 | 22 (2.0%) | 1 |
| other | block prompt (v10/v11) | 168 | 15 (8.9%, 5.5 to 14.2) | 7 |
| other | v12/v13 | 65 | 2 | 1 |
| other | older, single-page | 67 | 2 | 0 |

The single-page lane cannot move a page, so its rows are the noise floor: tier B fires there at about 2% of books,
tier A at 1 of 1,171. Tier A in the block era is 1.0% of caseless books and 4.2% of the others.

**Precision by eye.** 20 flagged books, 10 per tier, seeded draw, one page each from a flagged run. Four Opus
subagents each opened five scans and were told neither the direction flagged nor the tier; I opened item 02 myself
and agree with its verdict.

| | pages | English is the neighbour's | |
|---|---:|---:|---|
| tier A | 10 | 8 | false: a `prev` flag on a Sanskrit manuscript leaf, a Chinese two-page spread |
| tier B | 10 | 4 | false: four v2 single-page Sanskrit and Chinese pages, one v2/v10, one v13 |
| all | 20 | 12 (60%, 39 to 78) | |
| of which other-script books | 7 | 7 | Latin 4, German 2, Italian 1 |
| of which caseless-label books | 13 | 5 | Japanese, Persian notes, Sanskrit 2, Hebrew lexicon |

On all 12 the English is the following page's text under this page's own running head, the Śakuntalā shape. The
transcription matched the scan on all 20 (partly on 3), so the fault is in the translation layer, not the OCR.

**Estimate.** Books are the unit. Other-script books: 6.3% flagged (4.1 to 9.7), 7 of 7 real by eye, so about 1,300
of 20,404 books (830 to 1,980) hold at least one run, before the precision discount (7 of 7 has a lower bound of
65%). Caseless-label books: 18 tier A at 4 of 6 real plus 62 tier B at 1 of 7 gives about 21 books, 0.35% of the
frame; with the pooled tier precisions (8/10, 4/10) it is 39, 0.66%. Both are floors, see the next paragraph.

**What the no-signal fraction does to the claim.** In the caseless frame 84.4% of translated pages cast no vote
(Tibetan 99%, Han 91%, Hebrew 94%, Devanagari 48%), 2,004 books have no voting page, and 3,862 of 5,903 have no
pair of adjacent voting pages, which is the least a run needs. Only 909 books have 10 or more such pairs: among
them 69 are flagged (7.6%) and 18 are tier A (2.0%). For Tibetan (21 testable books), Hebrew (20) and Korean (0)
this run says nothing. A run of shifted pages with no printed numbers is invisible everywhere. "Not flagged" is
no claim, not "aligned".

**New cases are still being written.** *De Fato Declinando* (`6a43a5f0c3ccb765a98447bc`) p.30 was translated on
2026-10-05 by `scripts/lib/translate-batch-chained.mjs` (prompt v13, Batch API) and carries p.31's text; I read
the scan. 16 flagged runs sit on v13 pages (14 in the caseless frame, 2 in the sample). The block-shift guard
discards a block that comes back with fewer entries than pages; a block that comes back complete and one leaf
ahead passes it.

**Replicated?** No. One walk, one day. Precision rests on n = 20; the split by frame on 7 and 13.

**Not done.** No page, hold or withhold was written. The 12 pages confirmed by eye are listed on #5021 for
containment. A write-time check (reject a block in which two adjacent pages vote only for the next leaf) is a
separate change.

**Artifact.** `scripts/eval/results/translation-leaf-shift-5021/summary.json`: frame totals, the 99 flagged books
with their runs, and the 20 by-eye verdicts. Reproduce:
`node --env-file=.env.production.local scripts/audit/translation-leaf-shift.mjs --frame caseless` and
`--frame rest --sample 300 --seed 5021`; control: `--book 69dea23c4d19ec2e9ba75f5e --as-of 2026-10-13T00:00:00Z --list`.
