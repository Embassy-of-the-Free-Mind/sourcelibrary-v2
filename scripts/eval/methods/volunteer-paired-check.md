---
id: volunteer-paired-check
version: 1
stage: [ocr, translation]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [8405, 6418, 6682]
status: active
---
<!-- PRIOR ART: lane-spot-check.md and served-audit.md are our own Opus readers; this is the volunteer's Claude, an
unknown model under unknown settings, so it is its own method. The reviews themselves already lived in Supabase
volunteer_ratings (queue book-run) and were read only by book-run-plant-catch.mjs; nothing put them beside the other
checks of a book. -->
## volunteer-paired-check v1: a volunteer's Claude reading a book's paired-fifths pages

**What it is for.** To put what volunteer review shifts find about a book (#6418) in the same record as every other
check of that book, so the two can be compared on the same pages. It does not yet warn readers.

**Sampling.** The paired-fifths draw (`src/lib/paired-fifths.ts`, `paired-fifths-v1`, #8405): for each fifth of the
book, an anchor page drawn with a seed from the book id, among pages with both texts that are not hidden, split, front
matter, plates or blanks (the #7866 page types), plus the next page (else the previous one). Up to 10 pages and 5 joins
a book. The book is the volunteer's choice, their last run, or a book the translation-check pool is waiting on, so
`frame.selection` is `random` for the pages within the book only; the books are not a random draw of anything.

**Reader and input.** The volunteer's own Claude, in claude.ai or Claude Code, through `start_review_shift` /
`continue_review_shift`: the scan at 1,600 px, the transcription, the English, and the last 400 characters of the
page before. Its model name is self-reported (`assistant_model`, often "unreported"). Reader in the row:
`{ kind: model, model: <reported>, image_opened: 'unrecorded' }`: the scan is in the tool result, but nothing records
that the model looked at it. About one page in ten serves planted English (#6682); those reviews judged the plant, not
the page, and are left out of the row (`frame.plant_pages_left_out`).

**Serious.** Nothing in v1. The volunteer's verdicts (`both_sound`, `translation_drift`, `transcription_off`,
`both_off`, `unclear`) say which layer is off but not how badly, so every non-sound page is `minor` / `caveat` with
the findings in `page_notes`. `unclear` pages are left out (not assessable). A severity needs the second reader
(#6679) or the plant catch rates (#6682, `scripts/audit/book-run-plant-catch.mjs`) to weight it (#6557).

**Verdict.** `verdict_source: rule`: `show` if every page read is `both_sound`, else `caveat`. Never `fix`.

**Readers.** `reader_warning: false`. Rows are shown on `/book/<id>/checks` and kept for measurement; they derive no
warning and no "checked" line, until a catch rate says which setups can be trusted.

**Known blind spots.** One reader of unknown make; a page reviewed twice by one volunteer keeps its last review only.
The join is judged inside the second page's review, not as its own item, so a join defect shows only as that page's
finding.

**Rows written by** `scripts/audit/volunteer-paired-checks.mjs` (by hand, `--apply`), one row per volunteer per book
once every planned page has a review, through `recordPageVerdicts()`. `run_id` = `<volunteer_id>:<plan version>`, so a
re-run never doubles a row. Evidence: the `volunteer_ratings` rows themselves, `evidence_path`
`supabase:volunteer_ratings?queue=book-run&volunteer_id=<id>`.

**Versions.** v1, 2026-11-08 (#8405).
