---
stage: pipeline
measure: judged
languages: []
scripts: []
canons: []
n_books: 6472
n_pages: null
verdict: "Of 20,933 printed page-number breaks, 2,271 have text missing across them (a blind read, 344 of 350 control calls right), 2,155 are copies the 0.9 Dice missed, 1,452 are misnumbering with continuous text; 9,267 stay unsorted and 4,693 are numbers too far apart to judge."
status: undecided
decision: null
superseded_by: null
issue: [5059]
---
## 2026-10-13 · Which printed page-number breaks are missing leaves, which are copies, which are nothing? (#5059)

PRIOR ART: `scripts/eval/experiments/2026-09-24-are-the-scans-in-order-and-is-every-page.md` produced the list
(20,933 breaks in 6,472 books) and hand-read 20: 9 real, 8 false, 3 unclear. It recorded the catchword
detector and "a sentence left open" as NEGATIVE evidence of order; neither is rebuilt here.

**Question.** The leaf-order list was too noisy to act on (about 45% real on n = 20). #5059 asked for two
cheap sharpenings before any repair: a duplicate check below Dice 0.9 around each break, and a test of
whether the text continues across each jump.

**Design.** `scripts/audit/leaf-order-sharpen.mjs` (rules in `scripts/lib/leaf-order-sharpen.mjs`, 16 tests).
The box had no corpus mirror, so `--fetch` read the 6,472 listed books from Atlas `pages` (read-only,
secondary preferred, 2.76M pages, `ocr.data`, `page_type` and the image URL). Each listed break was then
sorted, in order: is it still a break on the text stored today; is there a copy at word-bigram Dice ≥ 0.8
between a scan at the break and any scan up to 4 away, or (for a back-step or a repeat) between the scan
after the break and an earlier scan printed with the same number; do the Archive's own leaf indices
(`/page/nNN/` in the image URL) skip between the two scans; does the foot end on a hyphen-broken word the
head never finishes; are the two numbers too far apart to be one sequence (≥ 20 and over half the expected
value).

No rule can tell a missing leaf from a printer's misnumbering when the foot merely ends mid-sentence, so the
5,364 jumps left between neighbouring scans were READ. The packet (`--packet-dir`) shows 320 characters of
the foot and of the head, shuffled with 993 controls from the same books that the reader cannot tell apart:
503 neighbouring scans whose printed numbers run on (the text joins) and 490 feet set against the head two or
three scans later (a leaf missing by construction). The reader answers J (the head continues the foot),
B (it cannot) or U (no evidence either way). A pilot on one packet chose the reader: Claude Sonnet called 3 of
13 made gaps a join; Claude Opus made no wrong call on 21 controls. Opus subagents (subscription, $0) read all
43 packets under the instructions kept in the script (`READER_INSTRUCTIONS`).

**Result.** All 20,933 listed breaks, as of 2026-10-13. "Live" is `visible: true && pages_count > 0` in Atlas
today (the list's own `visible` is from the 2026-09-10 mirror).

| what the break is | breaks | books (live) | evidence | what it needs |
|---|---:|---:|---|---|
| text missing across the jump | 2,271 | 1,077 (951) | 2,150 by the read, 101 by rule and read, 20 by rule alone | another copy of the leaf |
| a copy the 0.9 Dice missed | 2,155 | 1,009 (893) | 1,473 beside the break, 682 a section photographed twice (the same printed number, further back) | the duplicate-captures repair (#5056) |
| misnumbered, text continuous | 1,452 | 849 (725) | 1,381 read J, 71 by catchword or split word | nothing |
| no longer a break on today's text | 1,093 | 314 (279) | re-OCR or repair since 2026-09-24 | nothing |
| numbers too far apart to judge | 4,693 | 2,390 (1,919) | another counter, a new work bound in, or a large block | not sorted here |
| leaf present at the source, not in our copy | 2 | 1 (1) | Archive leaf indices skip (book `6a98dc51eb555c6c5a6beb3c`) | re-fetch those leaves |
| unsorted | 9,267 | 4,075 (3,121) | see below | review only |

*The reader on the controls (n = 993).* Joins: 375 J, 6 B, 122 U. Made gaps: 344 B, 6 J, 140 U. So a B call was
right 344 times in 350 (98.3%) and a J call 375 in 381 (98.4%); the reader found 70% of the made gaps and 75% of
the joins, and said U on the rest. The 2,251 B reads therefore name about 70% of the missing text among the
read jumps: roughly 3,200 of the 5,364 have text missing, and about 900 of those sit among the 1,712 read U.

*By eye, from the text.* Near copies in the new 0.80–0.90 band: 12 of 12 the same page read twice (a noisier
second OCR). Far copies: 6 of 6. B reads: 11 of 14 clearly broken, 3 weak (a foot that ends a sentence).
J reads: 10 of 10 continuous. Where the split-word rule and the reader disagreed (26), 10 of 10 checked went to
the reader: a running head set in capitals above the resumed word ("car-" | "INTRODUCTION. rière"). The rule
now looks past such a head, and a J read overrides it.

*Against the 2026-09-24 hand-read (20 labels).* The 4 missing-leaf cases are all text-breaks by the read. Of the
5 duplicates, 3 are found (Dice 1, 0.989, 0.895) and 2 are not (Dice 0.51 and 0.06 on today's text). The
"unclear" block 96–98 after 101–103 is a far copy at Dice 1. Of the 8 false cases: 1 is gone, 1 read J, 3 have
a text scan between and stay unsorted, 2 now carry a copy at the break (Dice 1 and 0.855: the copy is real,
which does not show it caused the break), and 1 the reader contradicts: Vico 205→206 was labelled continuous,
the read says B, and the foot's sentence ("che dovettero dapprima esser' assai più") is not finished by the
head ("difficil prononzia, come pure nelle Degnità sta proposto").

*Missing text, by source.* Of the 1,077 books, 748 come from the Internet Archive (275 of them Google Books
scans, `bub_gb_`), 234 are BPH's own photographs, 49 MDZ, 23 e-rara. In every one of the 1,552 breaks that carry
an Archive leaf index the two leaves are consecutive: the Archive item itself has nothing between them. The
proposed repair "re-source the leaf from the holding library" does not apply to those; they need a different
copy of the edition. Only 2 breaks in the whole list are leaves we skipped on import. Size of the hole, in
printed numbers: 1 in 533 breaks, 2 in 1,012, 3–4 in 242, 5–16 in 304, more in 180. 672 books have one such
break, 302 have 2–4, 103 have five or more (22 at most).

*Unsorted (9,267).* Jumps, 2,985: 1,712 read U (the foot ends a sentence or a chapter and the head starts one,
so the text holds no evidence), 1,172 with a text scan between the two numbered pages (not read), 101 too short
to read. Back-steps, 3,944, and repeats, 2,338, with no copy at Dice 0.8, none of them read: a back-step is
leaves out of order or a second counter, and a repeat over different text is usually the printer's. 56 of the
9,267 could not be Dice-compared at all (pages under 200 characters, or unsegmented script).

**Limits.** The read saw 320 characters each side, OCR text only, no image. A B says text is missing between
two scans; it does not say whether the leaf is lost, bound elsewhere in the volume, or never photographed. The
controls are made gaps of one or two scans in the same books; a real seam at a chapter end is harder, which is
why U is 32% on the jumps against 26% on the controls. The packet was drawn before the last change to the
split-word rule, so a packet rebuilt today differs in its controls; the record of what was read is
`page-integrity-leaf-order-seam-read-2026-10-13.jsonl.gz` (every item's kind and read). Unsegmented scripts
(Tibetan, CJK) are outside the duplicate check, as in the walk. Nothing was written to any store.

*Replicated?* No. One rule pass, one read per packet, one reader model. The pilot packet was read by two
models: they agreed on 124 of 150 items, and 3 of the 26 disagreements were J against B.

Artifacts: `scripts/eval/results/page-integrity-leaf-order-sharpened-2026-10-13.jsonl.gz` (the 20,933 rows with
`verdict`, `why`, `dice`, `page`/`copyOf`, `sourceLeaves`, `read`),
`scripts/eval/results/page-integrity-leaf-order-seam-read-2026-10-13.jsonl.gz` (6,357 read items with the key).
Re-run: `--fetch --dir=<dir>`, then `--dir=<dir> --out=<rows>`, `--packet-dir`, `--score`.
