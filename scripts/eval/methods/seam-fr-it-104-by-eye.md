---
id: seam-fr-it-104-by-eye
version: 1
stage: [translation]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [104]
status: active
---
<!-- PRIOR ART: kangyur-finish-8482-by-eye.md and stub-books-8181-by-eye.md (the same shape: a job's own session opens the
image and records through recordPageVerdicts). Neither reads a page break: they judge one page. This one opens the two
scans either side of a join the seam pass repaired or failed, for the paired seam test on French and Italian (v3#104). -->
## seam-fr-it-104-by-eye v1: the joins opened by eye in the French/Italian seam-pass test (v3#104)

**What it is for.** The paired test of the seam pass (`scripts/eval/seam-prevent-7118/seam-fr-it-104.mjs`) is scored by
Opus judges. This check is the person-shaped look behind them: did the judges' calls about a join hold on the scans?

**Sampling.** `picked`. Five joins chosen from the pages the pass changed, to cover what could go wrong: the one page
where the pass added a wrong-text defect, the one page that lost acceptance, a major repair, a page that gained
acceptance, and an edit at a join the seam judge called ok. Both pages of each join are recorded (10 pages).

**Reader and input.** The job's Opus session opens the page images the page judge saw (`getPageSource`), the foot of
the page before and the head of the page after, beside the stored OCR, the stored English (A) and the passed English
(S, results directory only, never served). Reader in the row: `{kind: model, model, image_opened: true}`.

**What the row records.** The verdict is on the STORED English, the text readers see (the passed text was never written).
`serious` only for text that is not on the leaf (an invented phrase, another page's text); a dropped word or a doubled
catchword at the join is `minor` with a `misleads` defect; `clean` when the join reads right. The note says what the
pass did to that join, judged against the scans.

**Verdict.** `verdict_source: rule`. `fix` for a serious page, `caveat` for a minor one, otherwise `show`.

**Readers.** `reader_warning: false`. Picked pages answer a question about a repair pass, not about the book.

**Known blind spots.** One reader, five joins, picked rather than drawn: this checks the judges on the cases that
decide the test, it does not estimate a rate. Only the region of each scan around the join was read closely.

**Rows written by** the job's recorder, `scripts/eval/seam-prevent-7118/record-by-eye-104.mjs`, through
`recordPageVerdicts()`. Evidence: the results directory `scripts/eval/results/seam-fr-it-104/by-eye.json`.
