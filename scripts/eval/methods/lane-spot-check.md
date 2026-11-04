---
id: lane-spot-check
version: 1
stage: [ocr, translation]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [8069, 5600]
status: active
---
<!-- PRIOR ART: judged-pages.md (the route judge's verdicts from lane_judge_verdicts; another prompt, a fidelity scale,
transcription only) and served-audit.md (a reviewer run over a frame of the served corpus, REVIEWER.md). This one is the
quick judge a lane runs on its own output while it runs; its verdicts lived in a folder on one box and an issue comment. -->
## lane-spot-check v1 — the check a running lane makes of the pages it has just written

**What it is for.** To stop a lane that is writing bad text. It reads few pages, often, from whatever the lane has just
written. It answers "may this lane keep running?", not "how good is the corpus?".

**Sampling.** The lane's own draw, named in `frame.lane`. v1 is the Siku lane (`scripts/batch/siku-translate-lane.mjs`,
`spotCheck`): after every 5,000 pages written, 10 pages (20 once, on 2026-10-29), shuffled across the books written since
the last check, one random page per book first. `frame.selection` is `random`; unseeded, so a draw cannot be repeated.
`frame.pages_drawn` and `frame.verdicts_kept` show the pages lost: a verdict counts only if the transcript shows its
image was opened. The frame is new output of one lane on held books, so it says nothing about the corpus.

**Reader and input.** One `claude -p --model opus` in a sealed folder, up to 5 pages per call, with the lane's frozen
`JUDGE` prompt, the page image, the OCR and the English. Reader in the row: `{kind: model, model, image_opened: true}`.

**Serious.** A page is serious if `wrong_leaf`, `invented`, a sense error (a clause whose meaning changes), or the
judge's verdict `omission`. `page_findings` name the stage (`ocr` when the judge says the error came from the OCR, else
`translation`) and a review-vocabulary `kind`, and no taxonomy class: this judge gives none, and class labels are the
unstable part (measurement-validity.md, Jaccard 0.55–0.67). `minor` and `fine` are not serious.

**Verdict.** `verdict_source: rule`. `fix` if a page read is wrong-leaf or invented, `caveat` for any other serious
page, else `show`. A rule over this rubric, not the lane's draft bar: the bar (0 wrong-leaf, 0 invented, sense errors
on ≤ 1 page in 3) judges a batch, and a verdict covers the pages read.

**Qualitative record.** Every page read, clean or not, has a `page_notes` entry: the judge's note, its `outcome`
(clean | minor | serious) and its `verdict`. `text_provenance` holds `page_id` and `ocr_hash` / `translation_hash`, the
hashes (`contentHash`) of the text the judge was given. `changed_since_check` says the page has been rewritten since.

**Readers.** v1 rows warn readers: a deliberate choice (#8069, `SPOT_READER_WARNING` in the lane). One Opus reader
against the image is the evidence `served-audit` and the fortnightly check already warn on; the warning names the stage
(transcription or English), never an unstable class; and a rewritten page drops out by itself. The finding covers the
page read, one page per book, so the reader is told "1 of 1 pages read". A clean read gives the book the "checked" line
with the same count. Backfill on 2026-11-04: 38 live books of 50; new warnings on 10, the "checked" line on 27. A lane
that should not warn yet passes `reader_warning: false` and its rows are kept for measurement only.

**Known blind spots.** One reader, one read per page, no planted controls in the lane (the sampler has them, #7611). The
rubric counts sense errors as one bucket: on 30 served Siku pages a closer read found that bucket mixes slips with
invented names (`scripts/eval/experiments/2026-10-30-siku-translation-error-types-5600.md`). Opus against Gemini-made
text is cross-family, but cross-family agreement between judges is near chance (#6338), so these are not a human's
reading. Another lane with another rubric is a new version or a new method, not this one.

**Rows written by** `recordSpot()` in the lane, through `recordPageVerdicts()` (`scripts/lib/book-checks.mjs`), one row
per book per spot check, before any containment step. A failed write is logged, paged and said in the lane's comment;
`siku-translate-lane.mjs record-spot --dir=<folder> --apply` retries it. Evidence of a live run: `box:<host>:<path>`, the
lane's `verdicts.json`; the row itself holds the record because that file does not last. Backfilled runs:
`scripts/eval/results/lane-spot-check/`.

**Versions.** v1 — 2026-11-04 (#8069), for the Siku lane's rubric as it has stood since 2026-10-27.
