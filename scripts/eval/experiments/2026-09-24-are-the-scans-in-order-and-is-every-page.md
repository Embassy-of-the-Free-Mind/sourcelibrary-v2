---
stage: pipeline
measure: judged
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "Exact detectors over 6.78M pages find 30,186 duplicate captures (20/20 real) and 66,525 truncated translations (10 real, 0 false); catchword and partial-echo detectors fail"
status: informational
decision: null
superseded_by: null
issue: [5055, 5056, 5057, 5058]
---
## 2026-09-24 — Are the scans in order, and is every page's translation all there? Five exact page-integrity detectors over the whole mirror

**Question.** A reader who turns a page and meets a leaf missing, the same leaf twice, or a
translation that stops a third of the way down never knows it: the text is healthy and the
image is right. Can exact checks over the text we already store find these, and how many are there?

**Design.** One walk of the local mirror (`scripts/audit/page-integrity.mjs`; pure detectors in
`scripts/lib/page-integrity.mjs`): 64,990 books, 6.78M pages, 5.11M translated, zero Atlas page
reads, 7 minutes on 16 processes. (1) catchword of page N vs the opening words of N+1; (2)
printed `<page-num>` sequence fitted at the book's rate (1, ½, 2 per scan), 1–2-number misprint
runs removed as outliers, a break excused as `misnumbered` only when the pages CHAIN (catchword or
a hyphen-broken word); (3) OCR of N vs N+1 and N+2 (word-bigram Dice ≥ 0.9 after ſ/f and
hyphen folding) — the same page, or the same two-page opening, twice; (4) translation vs source
reading length (letters + digits, so tables/LaTeX/entities do not count), normalised by the
language's median; flag < 0.5 of median, and in languages whose ratio varies widely (Tibetan,
Sanskrit, Hebrew, Arabic, Persian …) also < ½ of the language's 5th percentile; (5) a run of
≥ 120 folded chars shared by translation and source, and the *whole-page* tier where that run is
≥ ½ of the translation. OCR vintage and translation prompt from a read-only Atlas sample of
1,500 books. Precision from 20 hand-read flags per detector (one per book, fresh seed, final
code); the duplicate class by the IMAGES (pixel correlation of the two photos vs an ordinary
neighbour, 3 by eye).

**Result.**

| class | flagged | books (visible) | precision, final read of 20 | repair cost |
|---|---:|---:|---|---|
| duplicate captures (a page / an opening photographed twice) | 30,186 pages | 4,249 (3,328) | **20/20 real, by image** | $0 model; hide the copy (#1721's `duplicate_of`) |
| repeated-page books (≥ 20% of pages repeat) | 3,557 of 9,771 pages | 198 (121) | 6 worst checked: 4 IA items serve ONE image for every page, 1 same OCR on different images, 1 real double captures | fix image source, re-OCR + translate ≈ $56 |
| page-number break not explained by a duplicate | 20,933 breaks | 6,472 (5,084) | 9 real (4 missing pages, 5 duplicates the Dice missed), 8 false, 3 unclear | human triage; re-source missing leaves |
| truncated translation | 66,525 pages | 7,437 (6,994) | **10 real, 0 false**, 10 unclear (editor's notes / footnotes not rendered) | re-translate ≈ $233 realtime, ≈ $116 batch |
| echoed source, whole page | 4,598 pages | 1,503 (1,363) | 12 real, 7 false (tables, sigla, transliteration), 1 unclear | re-translate ≈ $16 |
| echoed source, partial run | 26,731 pages | 4,183 | 3/20 — kept quotations; **not a class** | — |
| catchword break | 256,271 of 1.60M judged boundaries | 26,719 books | **1/20** (and that one a duplicate scan); not a class | — |
| OCR field holds the model's reasoning (side find) | 25 pages | 24 (23) | 25/25 | re-OCR |

Duplicate captures are a partner-library defect: **1,031 of 2,322 BPH books** (and 113 of 1,511
Kloss) carry them, against 1,111 of 6,643 IA and 347 of 5,546 BSB books — the #1721 manual-upload
re-shoots, library-wide; #1721 repaired 42 books, and 10 of the 14 of those found here still carry
flags (132; one checked by image, r=0.91 vs 0.35 — its dHash ≤ 2 was too strict). The
repeated-page books are the reverse case (`lesson_text_image_mismatch_has_two_sides`): Ishvara
Pratyabhijñā's IA item returns byte-identical images for leaves n40 and n200, so 325 of 347 pages
show one title page — the reader sees one page 300 times.

*Vintage (1,500-book sample).* `<page-num>` is on 67–75% of v3/v5/v10/batch OCR pages and on
0.3% of imported text; catchwords on 16–54%. Duplicated openings concentrate in the v5 lane (768
pairs, 73 books — the Feb–Mar 2026 manual uploads). Truncation by translation prompt: v10 2.1%
(99 books), prompts-collection 11 1.5% (62), v1 2.2% (19), v2 0.3%, v5 0.02%; v11 and v13 are one
book each (an SBE Enoch, a Migne Greek/Latin) and say nothing about the prompt.

*Positive controls.* Atalanta fugiens: catchwords chain 183/196, page numbers 0 breaks after 19
misprint outliers. The 197 held wrong-leaf books (#4790): the catchword chain holds on 51% of
judged boundaries vs 82% in a matched random sample — detector 1 lights up; detector 2 does NOT
(break rate no higher than random), as it should not: that defect offsets text from images and
leaves the printed sequence in order. Batch-lane drafts (#4681): Latin p.12 at 0.33 of production
flags; p.89 at 0.04 is a 292-char diagram page, excluded by the prose gate (a documented miss).
Italian p.109's repair echo flags (whole page). Tests: 40, every one of 10 mutants fails the suite.

**Found on the way — the false shapes, each now a test.** The model records a page's own LAST
WORD as the catchword (and invents catchwords for modern books); a sentence merely left open is no
evidence that two scans are in order (most pages end mid-sentence — the first `misnumbered` rule
hid duplicated openings and would hide missing leaves); page numbers on plates; `&nbsp;`, LaTeX
and HTML-encoded Greek inflating a source 2–10×; untagged Greek+Latin crib pages; English inside a
source counted as echo; a line beginning with the word "thought" read as leaked reasoning (19/20
false before the rule was tightened).

*Replicated?* No — one walk (the fifth; the first four were stopped as the hand-reads found
shapes), one final hand-read per detector. The catchword and partial-echo detectors are recorded
as NEGATIVE results: do not rebuild them as leaf-order or translation-failure detectors.
Artifacts: `scripts/eval/results/page-integrity-handread-2026-09-24.json` (every label),
`page-integrity-repair-<class>-2026-09-24.jsonl.gz` (six lists), `page-integrity-2026-09-24.summary.json`;
the per-boundary flag file (109 MB) is regenerable in 7 minutes and is not committed.
Issues: truncated #5055, duplicate captures #5056, repeated-page books #5057, whole-page echo #5058, page-number breaks #5059.
