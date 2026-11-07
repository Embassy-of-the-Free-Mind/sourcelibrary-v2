---
id: euro-gpu-agy-cell-6871
version: 1
stage: [ocr]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [6871]
status: active
---
<!-- PRIOR ART: judged-pages.md (the route judge's frozen prompt and fidelity scale, rows in lane_judge_verdicts, not
book_checks) and lane-spot-check.md (a running lane's random draw, the Siku rubric). This is a cell test of a route that
is not running: one random unread page per book, read by the route, judged blind with the route judge's prompt
(scripts/eval/route-judge-6740/judge.mjs judgePrompt). plate-reread-check.md is picked pages, not random. -->
## euro-gpu-agy-cell-6871 v1 — is a GPU draft > agy Flash-low first read of this page what the page prints?

**What it is for.** The #6871 cell test: French, Spanish and Italian print of 1600-1799 and 1800-1929, read by
LightOnOCR-3-1B on the GPU and corrected by agy Gemini 3.8 Flash-low with the page image. It answers "may this route give
these pages their first text?" per cell. A row says what the judge saw on one page of the book; it says nothing about
the rest of the book.

**Sampling.** `frame.selection: random`. One page per book, seeded, from books with page records whose first language
and parsed year fall in the cell (`run.mjs draw --study=euro-6871`), between 5% and 95% of the book, with no text and
no human edit. The page is judged only if the route's write guards would write it (`cli-ocr.mjs apply --diff-guard=gpu-draft
--print-only`, dry run); a page they refuse is not judged and gets no row.

**Reader and input.** One blind `claude -p --model opus` call per page with the page image and the candidate text,
no route or model name (`judge.mjs judge`, unchanged). Wrong-page and planted controls go through the same judge and are
not recorded here. Reader in the row: `{kind: model, model, image_opened: true}`.

**Serious.** A page is serious when the judge does not accept it, or names a defect of severity `wrong_text` or
`misleads`. Accepted with only cosmetic defects is `minor`; accepted with none is `clean`.

**Qualitative record.** Every page has a `page_notes` entry with the judge's reader note and its defects.
`text_provenance` hashes the text the judge read. A rejected page is not written, so its row is `changed_since_check`
by construction: the verdict is about a candidate that was never served.

**Verdict.** `verdict_source: rule`: `fix` for a serious page, `caveat` for minor, else `show`.

**Readers.** v1 rows do not warn readers and give no "checked" line (`reader_warning: false`): one page of the book was
read, and most of the book is still unread.

**Known blind spots.** One reader, one read per page. Spanish and Italian have no planted control (the planter knows
la/fr/de only). The judge reads the image as served; faint or show-through print is at the limit of what it can check.

**Rows written by** `run.mjs record --study=euro-6871`, through `recordPageVerdicts()`, one row per book. Evidence: the
job's `verdicts-opus.jsonl` and `key.json`, kept in the PR's results folder.

**Versions.** v1 — 2026-11-07 (#6871).
