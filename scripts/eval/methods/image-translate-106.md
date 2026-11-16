---
id: image-translate-106
version: 1
stage: [translation]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [106]
status: active
---
<!-- PRIOR ART: euro-gpu-agy-cell-6871.md (a cell test's one-page-a-book draw judged blind by Opus with the image; OCR
stage only) and retranslation-gate.md (is a new English worse than the old, before it is written; no random draw).
This is the #106 cell test of attaching the page image to the translation call, whose best judged English per page was
written: the row records what the judge said about the English that landed. -->
## image-translate-106 v1 — is the English written from the #106 image-at-translation test what the page says?

**What it is for.** The #106 router-cell test (Latin, German, French print): three fresh agy Gemini 3.8 Flash-low reads
per page with the production translation prompt (text only; text only again; text with the page image attached), each
judged blind by Opus with the page image. Where the best judged read beat the stored English it was written. A row says
what the judge saw on that one page; it says nothing about the rest of the book.

**Sampling.** `frame.selection: random`. One interior page per book, seeded (`scripts/eval/image-translate-106/draw.mjs`,
`results/draw.json`), from visible books on the live agy translation route, about 40 books a language, the v2#7611 books
left out. Only pages whose best read was written get a row.

**Reader and input.** One blind `claude -p --model opus` call per read with the page image, the stored transcription
and the English, no arm or model name (`scripts/eval/image-translate-106/judge.mjs`). Wrong-page and planted controls go
through the same judge and are not recorded here. Reader in the row: `{kind: model, model, image_opened: true}`.

**Serious.** A page is serious when the judge did not accept the English, or named a defect of severity `wrong_text` or
`misleads`. Accepted with only cosmetic defects is `minor`; accepted with none is `clean`.

**Verdict.** `verdict_source: rule`: `fix` for a serious page, `caveat` for minor, else `show`. `text_provenance` hashes
the English the judge read, which is the English written.

**Readers.** v1 rows do not warn readers (`reader_warning: false`): one page of the book was read.

**Known blind spots.** One reader, one read per page; the judge picks the written read from among three, so the written
page's verdict is the best of three and overstates what one read of the route gives. The judge reads the image as
served.

**Rows written by** `scripts/eval/image-translate-106/write-best.mjs record`, through `recordPageVerdicts()`, one row
per book. Evidence: `scripts/eval/route-judge-6740/results/image-translate-106/`.

**Versions.** v1 — 2026-11-14 (#106).
