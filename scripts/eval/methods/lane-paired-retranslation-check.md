---
id: lane-paired-retranslation-check
version: 1
stage: [translation]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [8169, 5274]
status: active
---
<!-- PRIOR ART: lane-spot-check.md (a running lane's check of what it just wrote; the Siku rubric, one text a page, no
comparison with what it replaced; its file says another rubric is a new method) and retranslation-gate.md (old and new
English side by side, before the write, blind A/B in one reviewer). This one judges the new English and the English it
replaced ONE TEXT A CALL with the #5274 paired test's judge, after the write, so its k/n reads against #8134's 15/30 and
18/28. -->
## lane-paired-retranslation-check v1 — is a running re-translation lane still beating the English it replaces?

**What it is for.** To stop a bulk re-translation that has gone wrong. It answers "may this lane keep writing?", not
"how good is the corpus?".

**Sampling.** The lane's own draw (`frame.lane`): after the first 1,000 written pages, then after each 10,000, 30
written pages, one per book, seeded (`frame.seed`), drawn first from the pages written since the last check and topped
up from earlier ones. A page rewritten by anyone since the lane wrote it is skipped and replaced. Plus 2 wrong-page
controls: one drawn page's new English judged against another book's page image and transcription.

**Reader and input.** One sealed `claude -p --model opus` call per text (scripts/eval/route-judge-6740/judge.mjs
`judgePrompt` + `opusCall`, with the two #5274 questions: `source_misread` and each defect's `origin`), the page image
in the call's folder, the stored transcription and ONE English: the new one, or the one it replaced (from
page_revisions). Calls are in a hashed order and carry no arm name. Reader in the row: `{kind: model, model: opus,
image_opened: true}`. The meter is read before every call and an unreadable meter stops the check (no check ran).

**Stop rule (the lane's, #8169).** STOP when the new English is accepted on fewer than 10 of 30, when it is worse than
the English it replaced on more than 3 of 30 (worse: the old accepted and the new not; or the new 2+ fidelity points
lower; or the new has a wrong_text defect the old does not), or when a control is accepted.

**Serious.** A page whose NEW English has a `wrong_text` or `misleads` defect. `errors` name the stage from the
defect's `origin` (`ocr` when the English faithfully renders a transcription error) and the defect's class.

**Verdict.** `verdict_source: rule`. `fix` for a wrong_text defect, `caveat` for a misleads defect, else `show`. The
row covers the new English only; the old English's verdict is kept in the lane's check folder.

**Readers.** `reader_warning: false`. Rows are kept for measurement; they put no line on a book page. A lane that wants
its checks to warn readers needs Derek's yes on that copy first.

**Known blind spots.** One reader, one read a text. No repeat controls inside the check (the #5274 retests: 10/10
within one fidelity point). Opus against Gemini-made text is cross-family, but cross-family agreement is near chance
(#6338). A check of 30 pages cannot see a defect rate under about 10%.

**Rows written by** `scripts/batch/zh-retranslate-8169/check.mjs` through `recordPageVerdicts()`, one row per book per
check. Evidence: `box:<host>:<check dir>/verdicts.jsonl`.

**Versions.** v1 — 2026-11-04 (#8169).
