---
id: refusal-empty
version: 1
stage: [ocr]
measure: detector
reader: detector
image_opened: false
verdict_scale: [fix]
issue: [4686, 6056, 6174]
status: active
---
<!-- PRIOR ART: scripts/audit/quality-sprint-classes.mjs `pages` mode is the detector; scripts/lib/ia-ocr-cohort.mjs
`wasRecitationRefused()` is the definition of a refused page it reuses. This file is the instrument's description for
book_checks rows. -->
## refusal-empty v1 — pages the OCR refused as "recitation" that still have no text

**Sampling.** `scripts/audit/quality-sprint-classes.mjs pages`: a uniform per-BOOK sample of the public library
(`visible: true, pages_count > 0`), seed 6056, `--sample 1000` (or `--all`, or `--books` for positive controls). Every
page of a sampled book is read, by one indexed aggregation per book.

**Reader and input.** Model-free. It reads stored fields only — `ocr.recitation_count`, `ocr.recitation_blocked`,
`ocr.last_skip.reason` and the **length** of `ocr.data` — never the text and never the image. Reader in a row:
`{kind: detector, role: quality-sprint-classes/refusal_empty, image_opened: false}`.

**Serious.** A page is a hit when the OCR was refused as recitation (`wasRecitationRefused()`) **and** the page has
< 20 characters of text: a reader opening it finds an empty transcription (taxonomy: a refusal leak, #4686). Its
sibling class `tr_placeholder` (the translation pane shows "could not be translated") is counted by the same pass.

**Verdict.** A detector can only say **fix**: a book with ≥ 1 hit page gets a `fix` row whose `pages_read` are the hit
pages. A book with no hits gets **no row** — absence of this one defect is not a pass, and must never read as `show`.

**Known blind spots.** Only this one mechanism. A refused page later filled from another source passes. 1,000-book
sample: 27 books with hits (2.7%, CI 1.9–3.9%) on 2026-10-07 (`results/quality-sprint/2026-10-07-detectors-v3`).

**Rows.** Not backfilled yet (the 2026-10-07 summary keeps 10 example URLs, not every hit book). A detector run that
wants rows writes them through `recordBookCheck()` with the hit pages.

**Versions.** v1 — 2026-10-07: `quality-sprint-classes.mjs` as merged in PR #6059.
