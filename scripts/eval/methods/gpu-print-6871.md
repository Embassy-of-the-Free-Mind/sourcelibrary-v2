---
id: gpu-print-6871
version: 1
stage: [ocr]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [6871]
status: active
---
<!-- PRIOR ART: euro-gpu-agy-cell-6871.md (the same route and judge, but a cell test: unread pages drawn BEFORE the route
reads them and dry-applied by the harness). This method judges what a production lane WROTE: the draw is over the lane's
ledger and the text is the stored page. lane-spot-check.md is the Siku rubric, not the route judge's prompt. -->
## gpu-print-6871 v1 — is the first read a GPU print lane wrote on this page what the page prints?

**What it is for.** The #6871 GPU print lanes after the four-route rule (Derek, 2026-11-06: agy, GPU>agy, Opus,
GPU>Opus). First used on the English 1800-1929 widening pilot (`cli-ocr-lane.mjs armc --frame=euro --cell=en19`):
LightOnOCR-3-1B drafts the page on gex45, agy Gemini 3.8 Flash-low corrects it with the page image, and the lane writes
it (stamped `gpu-agy-first-read-en-6871`). It answers "may this lane keep running?" A row says what the judge saw on one
page of the book; it says nothing about the rest of the book.

**Sampling.** `frame.selection: random`. Pages the lane WROTE in its pilot, drawn seeded, one per book where books allow,
then a second page of a book already drawn (`scripts/eval/route-judge-6740/euro-route-gate-6871/draw.mjs`). A page the
lane refused is not judged and gets no row.

**Reader and input.** One blind `claude -p --model opus` call per page with the page image and the stored text, no
route or model name (`scripts/eval/route-judge-6740/judge.mjs judge`, unchanged). Wrong-page controls (and planted
errors, where the planter knows the language; it has no English) go through the same judge and are not recorded here.
Reader in the row: `{kind: model, model, image_opened: true}`.

**Serious.** A page is serious when the judge does not accept it, or names a defect of severity `wrong_text` or
`misleads`. Accepted with only cosmetic defects is `minor`; accepted with none is `clean`.

**Qualitative record.** Every page has a `page_notes` entry with the judge's reader note and its defects.
`text_provenance` hashes the text the judge read, which is the stored text.

**Verdict.** `verdict_source: rule`: `fix` for a serious page, `caveat` for minor, else `show`.
