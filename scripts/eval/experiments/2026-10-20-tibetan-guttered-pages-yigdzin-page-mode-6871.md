---
stage: ocr
measure: accuracy
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 19
n_pages: 30
verdict: "Yigdzin 1 reading the whole page (no leaf cut) on 30 of the 5,132 guttered pages: line recall 0.979, 29/30 clean, but 1 page loops and invents a line; the 3-band arm: recall 1.000, 28/30 clean once blank-markers are set aside, but inserts a head mark and a stray syllable. Neither clears the preregistered 0-invented bar."
status: rejected
decision: "No full read of the 5,132 pages queued. A follow-up needs a new prereg on a fresh draw: bands arm, blank-markers stripped, the #4523 guard applied, an invented-text bar in syllables (#6871 row 4)"
superseded_by: null
issue: 6871
---
## 2026-10-20 · Can Yigdzin read the 5,132 Tibetan pages its leaf worker refused as "guttered"? (#6871 row 4, job gex45-refill-6871)
<!-- PRIOR ART: 2026-10-14-yigdzin-hidden-tibetan-books-4523.md (the run whose worker refused these pages; same reader, leaf mode) and PREREGISTRATION-tibetan-woodblock-yigdzin-5660.md (same reader against a Derge e-text; these pages have none). -->

**Question.** The #4523 leaf worker refused 5,135 pages in 130 hidden Tibetan books because its gutter detector saw a bound-book opening. 5,132 still had no OCR on 2026-10-20. Would Yigdzin 1, reading the page whole instead of cut into leaves, give text we would serve?

**What the pages are.** By eye, on 30 drawn pages: mostly **single pecha leaves** (22) and **modern book pages** (7), plus one other. None is a two-page opening. So the detector misfires on single leaves in reprint frames and on book pages. 5 of the 30 are blank leaves or empty frames.

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
