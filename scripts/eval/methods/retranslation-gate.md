---
id: retranslation-gate
version: 1
stage: [translation]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [6361, 6174]
status: active
---
<!-- PRIOR ART: fortnightly-spot-check.md (3 consecutive pages read against the image, REVIEWER.md) reads ONE text per
page and samples books from the public frame. A staged re-translation needs the new English read beside the English it
would replace, blind to which is which, on volumes of the run, before the writer runs. This file is that instrument's
description for book_checks rows. -->
## retranslation-gate v1 — before a re-translation is written, is the new English worse than the old on the page?

**Sampling.** Per run: 5 volumes drawn at random (mulberry32, the seed recorded in the run's `draw.json`) plus the 2
volumes whose staged/stored median length ratio is highest and lowest; in each, one random run of **3 consecutive
pages** whose staged English passed the run's detector gates and whose OCR has ≥ 300 characters
(`scripts/maintenance/tengyur-cli-6361/draw-byeye.mjs` for #6361).

**Reader and input.** One blind Opus reviewer per volume. Per page it gets the page image (whole and in three
2×-upscaled crops), the stored OCR, and the two English versions as **A** and **B** in a random order per page (key
kept outside the reviewer's directory). It **opens every image**. Reader in a row: `{kind: model, model: opus,
image_opened: true}`.

**Serious.** A meaning error a reader would carry away: a reversed or negated claim, a wrong speaker or attribution in
the debate (objection read as reply), an omitted or invented sentence, a mistranslated technical term that changes the
argument, text from another page. Classes as in `.claude/docs/page-error-taxonomy.md`. Style and term choice are not
serious.

**Verdict — derived from the reviewer's per-page findings on the NEW text, after unblinding.** `fix` when any page has
a serious error in the new English that the old English does not have (the volume's re-translation is worse there);
`caveat` when the new English has a serious error the old one shares; `show` when the new English has no serious error
on the pages read. The run stops when two or more volumes are `fix`. `page_findings` lists the serious errors of the
new English per page.

**Known blind spots.** A model reviewer, not a Tibetanist; 3 pages per volume; the reviewer may trust the OCR where the
image and OCR differ, though it is asked to check the image.

**Rows.** Written after the apply, against the live page provenance, so the row cites the text it read
(the run checks that the stored content hash equals the hash of the text read). When the gate STOPS the run, no row
is written: the verdict is about English that was never stored, and `page_findings` on a live page drive the reader's
page warning (src/lib/book-warnings.ts) — they would warn about text the reader is not shown. The evidence stays in the
run's results directory (#6361: `scripts/maintenance/tengyur-cli-6361/results/byeye/`).

**Versions.** v1 — 2026-10-10: #6361 stage 2.
