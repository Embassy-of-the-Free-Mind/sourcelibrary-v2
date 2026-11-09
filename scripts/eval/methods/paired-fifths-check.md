---
id: paired-fifths-check
version: 1
stage: [ocr, translation]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [8405, 7866]
status: active
---
<!-- PRIOR ART: judged-pages.md records the #7866 5-page reads (one random page from each fifth, the route judge). This
method replaces that design for book checks: #8405 found 24 of 159 books good on 5 pages and bad on 10 paired pages
(15.1%; preregistered bar 5%; scripts/eval/experiments/2026-11-08-paired-fifths-results-8405.md). -->
## paired-fifths-check v1: ten pages and five page breaks of a book, read by Opus against the images

**What it is for.** The standard Opus check of one book: is what a reader is served the text on these leaves, and does
the text stay on its own page at a page break? It replaces the one-page-per-fifth read of #7866 as the default book
check. A per-page judge can't see text that sits on the wrong side of a break; on #8405 18 of the 24 books it caught
were caught at a break.

**Sampling.** The paired-fifths draw (`scripts/lib/paired-fifths.mjs`, `paired-fifths-v1`): for each fifth of the book,
by position among all its pages, a page drawn with a seed from the book id among #7866-eligible pages (OCR text, an
image, not hidden or split, not front matter, a plate or a blank), plus the next page, else the previous one. That
gives 10 pages and 5 breaks; a book with fewer than 4 drawable pairs is not checked. `frame.selection` is `random`
within the book. The draw is deterministic, so a re-check reads the same pages, and a volunteer's check
(volunteer-paired-check) reads the same pages as this one.

**Reader and input.** `claude -p --model opus`:
- **Pages:** the #7866 page judge, unchanged (route-judge `judgePrompt`, OCR task, one page image in the workspace).
- **Breaks:** the join judge v2 (`joinPrompt` in `scripts/eval/paired-fifths-8405/run.mjs`), with both scans, both
  transcriptions and both English texts.

v2 adds one rule to the study's v1: a sentence finished across the break, with nothing lost and nothing repeated, is
not a defect (13 of the study's 72 failed breaks were only that). Reader in the row: `{kind: model, model,
image_opened: true}`. The study's controls (10/10 planted carry-overs, 10/10 wrong-leaf swaps) validated the join
judge at v1.

**Serious.**
- **Page:** fidelity ≤ 3 (as judged-pages); its `misleads` and `wrong_text` defects become stage-`ocr` errors.
- **Break:** a material `carry_over`, `duplicated`, `wrong_leaf` or `dropped` is an error on the page the judge names.
  It has the stage of its layer (transcription → `ocr`, English → `translation`) and its kind: carry_over and
  duplicated → `carry_over`, wrong_leaf → `wrong_leaf`, dropped → `omission`.

**Verdict.** `verdict_source: rule`:
- `fix`: any page at fidelity ≤ 2, or a wrong-leaf finding (from a break, or an I1 page defect).
- `caveat`: any other serious page.
- `show`: otherwise.

**Qualitative record.** Every page read has `page_notes`: the judge's note, fidelity, defects, and the break findings
that name it. The evidence file `scripts/eval/results/paired-fifths-check/<run_id>.json` keeps every raw verdict.

**Readers.** `reader_warning: true`, as judged-pages: one Opus reader against the image is the evidence the library
already warns on, and a rewritten page drops out by itself (the row carries the hash of the text judged).

**Known blind spots.** One reader, one read per page. The page judge reads the transcription only; the English is read
only at the breaks. 10 pages give a book grade with reliability about 0.81 (split half on #8405, an upper bound).

**Rows written by** `scripts/eval/paired-fifths-check.mjs --books=… --apply`, one row per book per run, through
`recordPageVerdicts()`.

**Versions.** v1, 2026-11-08 (#8405), join judge v2.
