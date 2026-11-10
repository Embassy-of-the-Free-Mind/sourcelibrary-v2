---
id: paired-fifths-check
version: 2
stage: [ocr, translation]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [8518, 8478, 8405, 7866]
status: active
---
<!-- PRIOR ART: judged-pages.md records the #7866 5-page reads (one random page from each fifth, the route judge). This
method replaces that design for book checks: #8405 found 24 of 159 books good on 5 pages and bad on 10 paired pages
(15.1%; preregistered bar 5%; scripts/eval/experiments/2026-11-08-paired-fifths-results-8405.md). v2's call shape is
the P5-opus arm of #8478 (scripts/eval/experiments/2026-11-09-callshape-results-8478.md), adopted on #8518. -->
## paired-fifths-check v2: ten pages and five page breaks of a book, read by Opus a pair of facing pages at a time

**What it is for.** The standard Opus check of one book: is what a reader is served the text on these leaves, in the
transcription and in the English, and does the text stay on its own page at a page break? It replaces the
one-page-per-fifth read of #7866 as the default book check. A per-page judge can't see text that sits on the wrong
side of a break; on #8405 18 of the 24 books it caught were caught at a break.

**Sampling.** The paired-fifths draw (`scripts/lib/paired-fifths.mjs`, `paired-fifths-v1`): for each fifth of the book,
by position among all its pages, a page drawn with a seed from the book id among #7866-eligible pages (OCR text, an
image, not hidden or split, not front matter, a plate or a blank), plus the next page, else the previous one. That
gives 10 pages and 5 breaks; a book with fewer than 4 drawable pairs is not checked. `frame.selection` is `random`
within the book. The draw is deterministic, so a re-check reads the same pages, and a volunteer's check
(volunteer-paired-check) reads the same pages as this one. Which BOOKS are checked is the queue's business
(`scripts/maintenance/book-check-priority.mjs`: reads × measured risk, with a 10% uniform random stratum that is
reported apart).

**Reader and input.** `claude -p --model opus`, **one call per pair** (5 a book; v1 made 15): both scans
(`./p01.jpg`, `./p02.jpg`), both transcriptions and both English pages. Prompt `p5-8478`, the #8478 `batchPrompt` for
two pages, byte-identical (pinned by `tests/paired-fifths.test.ts`):
- **Each page:** the route-judge page questions (accept, fidelity 1–5 of the transcription, defects with the
  page-error taxonomy, reader_note), plus `en_accept` and defects in the English, each defect with a `layer`
  (transcription | english).
- **The break:** the join judge v1 rules (carry_over, duplicated, dropped, wrong_leaf, other; furniture is not a
  defect), each defect with kind, layer, page (A | B), quote and material.
Reader in the row: `{kind: model, model, image_opened: true}`; `frame.call_shape: P5`.

**Validation (#8478, 80 study books and 30 planted controls).** Carry-over 10/10, wrong-leaf 10/10 (the 9/10 bar
holds). Planted English errors (`page_defect`) 8/10, under the bar; v1 read no English and would score 0/10, so this
is a translation-side control: English findings are evidence for a caveat, never a fix on their own. Against v1 (R):
serious OCR findings per 1% of a week 142.5 vs 99.0 (+44%), OCR recall vs the union 0.705 vs 0.712, precision 0.963 vs
0.916, and 11.9 serious translation findings a book that v1 cannot see. Changing the prompt is a version bump and
re-runs the controls.

**Serious.**
- **Page, transcription:** fidelity ≤ 3; its `misleads` and `wrong_text` transcription defects become stage-`ocr`
  errors.
- **Page, English:** any `misleads` or `wrong_text` English defect is a stage-`translation` error (fidelity scores the
  transcription, so it does not gate these).
- **Break:** a material `carry_over`, `duplicated`, `wrong_leaf` or `dropped` is an error on the page the judge names.
  It has the stage of its layer (transcription → `ocr`, English → `translation`) and its kind: carry_over and
  duplicated → `carry_over`, wrong_leaf → `wrong_leaf`, dropped → `omission`.

**Verdict.** `verdict_source: rule`:
- `fix`: any page at fidelity ≤ 2, or a wrong-leaf finding (from a break, or an I1 page defect).
- `caveat`: any other serious page.
- `show`: otherwise.

**Qualitative record.** Every page read has `page_notes`: the judge's note, fidelity, English acceptance, defects, and
the break findings that name it. The evidence file `scripts/eval/results/paired-fifths-check/<run_id>.json` keeps every
raw verdict and the token usage of each call.

**Readers.** `reader_warning: true`, as judged-pages: one Opus reader against the image is the evidence the library
already warns on, and a rewritten page drops out by itself (the row carries the hash of the text judged; a page
whose transcription or English changed between the call and the write is left out of the row).

**Known blind spots.** One reader, one read per page. Planted English errors are caught 8 times in 10. A break
between pairs (page 2 of one pair and page 1 of the next) is never read; only the five breaks inside pairs are.
10 pages give a book grade with reliability about 0.81 (split half on #8405, an upper bound). Spot-check fix
verdicts by eye on a new shelf (#8518 did the first 50).

**Rows written by** `scripts/eval/paired-fifths-check.mjs --books=… --apply` (run ids `pfc-p5-<date>-…`), one row per
book per run, through `recordPageVerdicts()`.

**Versions.** v1, 2026-11-08 (#8405): a page judge a page and a join judge a break, 15 calls a book, join judge v2.
v2, 2026-11-10 (#8518): one call per pair (P5-opus, #8478), English read on every page. v1 rows stay valid as v1.
