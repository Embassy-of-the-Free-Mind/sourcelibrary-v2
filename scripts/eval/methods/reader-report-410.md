---
id: reader-report-410
version: 1
stage: [ocr, translation]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [410]
status: active
---
<!-- PRIOR ART: kangyur-finish-8482-by-eye.md (the same shape, but a random draw from one run; these pages were named by
readers); stub-books-8181-by-eye.md (transcription only, a first-read lane). -->
## reader-report-410 v1: pages readers reported as wrong, read against the image (#410)

**What it is for.** Readers reported about fifteen pages through the feedback widget and by email (#410): a misread
word, a dropped line, an invented rune row, an untranscribed plate, a page the translator skipped. This method records
what one reading of each named page found. It answers "was the report borne out, and is the page right now?" It says
nothing about the rest of the book.

**Sampling.** None. The pages are the ones readers named. `frame.selection` is `picked`. A reported page is more likely
to be wrong than a random page, so these rows must not go into a corpus error rate.

**Reader and input.** The job's Opus session opens the leaf image (`archived_photo`, cropped and enlarged where the print
is small), reads the stored OCR against it, and reads the English against the OCR. Each reader claim is checked against
the image before anything is written. Reader in the row: `{kind: model, model, image_opened: true}`.

**Serious.** Text that is not on the leaf: an invented passage or sign row, a dropped line that changes the sense, a
transcription loop, or a page whose English is missing. Invented text goes to `containment-on-finding.md` in the same
run. Other slips are `defects` with a severity: `cosmetic` (a misread letter that does not change the sense) or `misleads`
(a wrong name, date or term).

**Verdict.** Judged on the page as it was found. `fix` for a serious page, `caveat` for a page with a `misleads` defect,
otherwise `show`. The note says what was corrected. The correction itself is in `page_revisions` under the run id of
`scripts/maintenance/apply-by-eye-page-text.mjs`.

**Readers.** `reader_warning: false`. Picked pages say nothing about their books.
