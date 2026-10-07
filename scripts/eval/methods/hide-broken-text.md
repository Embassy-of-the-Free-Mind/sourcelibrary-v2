---
id: hide-broken-text
version: 1
stage: [ocr, translation, structure]
measure: judged
reader: model
image_opened: true
verdict_scale: [fix]
issue: [6048, 6056, 6142, 6174]
status: active
---
<!-- PRIOR ART: scripts/maintenance/hide-named-books.mjs (the hide itself, reason `broken_text_<issue>`) and the
shelf-overview skill's "hide what a reader must not meet" step. Neither leaves a record of which check, which pages
and which reader led to the hide; books.hidden_reason holds only the code. -->
## hide-broken-text v1 — a book hidden because a check found its text broken

**What it records.** Not a new read: the **action** a session took on a check's finding. A book is hidden with
`hidden_reason: broken_text_<issue>` (`hide-named-books.mjs`) after a check read it and found text that is not the
page's, loops, or English that is not a translation. The row makes that failure a check record like any other, so a
reader of `book_checks` sees the hide, its date and its grounds next to the reads.

**Sampling, reader and input.** Those of the check that led to the hide. The row copies that check's `pages_read`,
`reader` and `evidence_path`, and names its run in `frame.source_run_id`. `checked_at` is `books.hidden_at`.

**Serious / verdict.** Always **fix**: the hide is the decision that the book must not be shown until fixed.

**Known blind spots.** Which check led to a hide is not stored on the book; the backfill takes the latest
in-repo check of that book with a `fix` verdict (or, failing that, with a serious page) dated before `hidden_at`. A hidden book whose
grounding check is not in this repo (round 0, #6048; #6142) gets no row until its evidence is linked.

**Versions.** v1 — 2026-10-07.
