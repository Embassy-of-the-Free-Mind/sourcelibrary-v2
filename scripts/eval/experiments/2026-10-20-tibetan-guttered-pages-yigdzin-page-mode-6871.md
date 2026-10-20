---
stage: ocr
measure: accuracy
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 19
n_pages: 30
verdict: "Round 1 (every read scored): page-mode Yigdzin recall 0.979 but 1 of 30 pages loops and invents a line — fails. Round 2 (fresh 30, #4523 write rule preregistered): 15 of 29 text pages written, 0 invented, line recall 1.00, 15/15 clean — passes; the guard withheld both looping pages."
status: adopted
decision: "Read all 5,132 pages to FILES with HF Yigdzin page-mode (gex45 queue 80-tib-gutter-full-a, ~9 GPU-days in 24 h chunks); applying them under the #4523 write rule is a DECISION for Derek (#6871 row 4)"
superseded_by: null
issue: 6871
---
## 2026-10-20 · Can Yigdzin read the 5,132 Tibetan pages its leaf worker refused as "guttered"? (#6871 row 4, job gex45-refill-6871)

**Round 1 below fails; round 2 (at the end) passes with the write rule fixed in advance.**
<!-- PRIOR ART: 2026-10-14-yigdzin-hidden-tibetan-books-4523.md (the run whose worker refused these pages; same reader, leaf mode) and PREREGISTRATION-tibetan-woodblock-yigdzin-5660.md (same reader against a Derge e-text; these pages have none). -->

**Question.** The #4523 leaf worker refused 5,135 pages in 130 hidden Tibetan books because its gutter detector saw a bound-book opening. 5,132 still had no OCR on 2026-10-20. Would Yigdzin 1, reading the page whole instead of cut into leaves, give text we would serve?

**What the pages are.** By eye, on 30 drawn pages: mostly **single pecha leaves** (21) and **book pages** (8), plus one other. None is a two-page opening. So the detector misfires on single leaves in reprint frames and on book pages. 5 of the 30 are blank leaves or empty frames.

**Design.** Committed before any read was scored: `scripts/eval/tibetan-gutter-6871/PREREGISTRATION.md` (63c92743e).
- **Draw.** 30 pages, page-weighted, at most 2 per book, 19 books, seed 6871.
- **Reader.** BDRC/tibetan-ocr @50506eb6 under HF transformers 5.17, following the model card: sequential M-RoPE, greedy, DRY 0.8/1.75/12. It ran on the GEX45 as queue task `60-tib-gutter-bakeoff` and wrote to files only.
- **Arms.** `page` reads the whole image. `bands` cuts the image into 3 horizontal bands at the emptiest rows.
- **Reference.** Structural and written blind, because Opus invents Tibetan when it transcribes (0.70 vs 0.945 in #6560). Two independent Opus readers opened the images and recorded layout, body-line count and anchors. Their line counts agree within ±1 on **30/30** pages (references-A/B.jsonl).
- **Score.** An Opus checker read each arm's text against the image tiles, one read per checker with the arm unnamed. It labelled every line ok / minor / wrong / invented / other / loop and counted dropped body lines.

**Result** (193 reference body lines; `score2.js`, `reads-and-checks.jsonl.gz`)

| arm | invented pages | line recall | clean pages | ok+minor of read lines | s/page (HF) |
|---|---|---|---|---|---|
| bar | **0** | ≥ 0.95 | ≥ 27/30 | ≥ 0.90 | |
| page | **1** | 0.979 | 29 | 0.989 | 118 |
| bands, as marked | 11 | 1.000 | 19 | 0.907 | 124 |
| bands, blank-markers set aside (post hoc) | **2** | 1.000 | 28 | 0.989 | 124 |

- **page fails on one real fabrication.** On `6a37d736…3b33`, a hand-drawn dbu med bibliography leaf, the read repeats entry 15's text under entry 16's number. It then writes a line that is not on the page (`…དགོན་པ་ཞེན་ཆགས་འཕེལ།། །།གསུམ་པ་ཀུན་བཟང་…`) and drops entries 16–17 (4 lines). I checked this by eye: the image's entry 16 begins ལ་པཎ་ཆེན་བློ་བཟང་. It also merges the 6–7 lines of two faint woodblock leaves into one line, without losing their text.
- **bands fails on two trivial insertions, once the blank-markers are set aside.** Yigdzin writes `empty page` / `ཤོག་སྟོང་།` for a blank band, 33 such lines in all. The checkers scored those markers inconsistently, so they are set aside here, and that is a post-hoc reading. What remains:
  - a `༄༅།` head mark above a leaf whose top band is empty margin (checked by eye: no head mark on the page);
  - one stray `ས་` on an empty frame.

  Neither is fluent invented text, but the bar I fixed was 0 pages with an invented line, and it holds.
- **Text quality where it reads.** On printed pages, almost every line is ok. The "minor" lines sit on faint woodblock leaves and on the two cursive leaves (`byang btsan gom po` for `srong btsan sgam po`).
- **Speed.** HF with the Python DRY processor runs at ~2 min/page, so a full run of the 5,132 pages would take about a week. `yig_vllm.py` (card's vLLM recipe, seqpos plugin) and `parity.py` are ready but were not run.

**Decision.** Neither arm passes. No full read is queued, and the pages stay empty. The bands result suggests a narrow follow-up, which needs a **new prereg on a fresh draw**, since this draw has now been seen:
- the bands arm;
- blank-markers stripped;
- the #4523 write rule applied (v4 judge, `first-ocr-guard`, ≥ 150 syllables, which drops blank leaves);
- an invented-text bar stated in syllables.

Derek's 10-20 order puts this row fourth.

`n = 30 / 19 books`: this rules out a high failure rate, not a low one. Checker labels are an Opus judgement against the image (`read-from-image`), not a syllable-level reference.

### Round 2 — the #4523 write rule, preregistered, on 30 fresh pages

**Why a second round.** Round 1 scored every read, but a lane serves only what #4523's write rule lets through:
blank-band markers stripped, `first-ocr-guard` unflagged, ≥ 150 syllables. Applied post hoc to round 1, that rule
withheld the one page with a loop and wrote 16 of 30 with nothing invented. A post-hoc rule decides nothing, so round 2
fixed it in advance (`r2/PREREGISTRATION.md`, 06f91f3b1).
- **Draw.** 30 new pages from 22 books, seed 68712: 24 pecha leaves, 6 book pages, 1 blank. The two blind readers
  agree on line counts on 30/30.
- **Arms.** **V** (vLLM) never produced a read. vLLM 0.31's V2 runner rejected the DRY logits processor; with
  `VLLM_USE_V2_MODEL_RUNNER=0` the engine then deadlocked after warm-up (futex wait, 0 % GPU, killed after 6 min).
  By the prereg, a failed V means **H** (HF) is scored.

**Result (H, `r2/score-r2.mjs`; Opus line-check against the image, arm unnamed):**

| | value | bar |
|---|---|---|
| text pages written by the rule | 15 / 29 (coverage 0.52) | reported |
| written pages with an invented line (≥ 3 syllables, or a loop) | **0** | 0 |
| line recall on written pages | **1.00** | ≥ 0.95 |
| clean written pages | **15 / 15** | ≥ 90 % |
| ok + minor of read lines | **1.00** | ≥ 0.90 |
| parity V vs H | V produced nothing | → H path |

- **The guard did the work.**
  - Two pages read badly: an errata table with merged and repeated rows, and a two-column name list with 10 loop lines.
  - One page ended in a `ལ་ལ་ལ…` run.
  - All three were withheld: under 150 syllables, `local_loop`, `dominant_unit`.
- **Written pages were checked line by line.** No drops. "Minor" lines sit on cursive dbu med and on interlinear notes.
  One cursive leaf writes final ང as ཌ and final མ as ཾ throughout, every line minor.
- **What is not written.** 14 of 29 text pages stay empty: 2 flagged by the guard, and 12 under 150 syllables. The 12
  include title leaves, short verse and list pages, and two full pages that fall just short (143 and 147 syllables).
  That is the rule's design (it trades coverage for safety), not a read failure.

**Decision.**
- Queued as gex45 task `80-tib-gutter-full-a`: all 5,132 pages read to FILES with H. At ~2.5 min/page that is ≈ 9
  GPU-days, run in 24 h chunks (re-queued as 80-tib-gutter-full-b, -c …) so other gated tests can run between them.
- **Applying** the reads through #4523's write rule (revisions first, books stay held) is a DECISION for Derek.
- Expected: about half the pages written, and 0 invented in 15 here. n = 15 written pages rules out a high invented
  rate, not a low one: the #5660 measurement (5 % [2–13 %] for unflagged pages ≥ 150 syllables) is the better prior.
- A working vLLM path would cut the 9 days to hours. That is engineering work, not a gate.
