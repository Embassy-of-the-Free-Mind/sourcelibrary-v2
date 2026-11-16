---
id: paired-arm-stored-english
version: 1
stage: [translation]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [342, 8069]
status: active
---
<!-- PRIOR ART: lane-paired-retranslation-check.md (the same judge on English, but its sampling and stop rule are a
running lane's: pages the lane just wrote); judged-pages.md (route-judge verdicts recorded per book, but transcription
only, "the English is not judged"); paired-fifths-check.md (the standard book check: ten pages in pairs, its own draw).
None covers the baseline arm of a paired-arm test, where the stored, served English is one of the arms. -->
## paired-arm-stored-english v1: the route judge's verdict on the served English, when it is a paired test's baseline

**What it is for.** A paired-arm test (`.claude/skills/paired-arm-judge`) that has the stored English as its baseline
arm judges what readers are served, page by page, against the image. This method keeps those verdicts on the book's
checks, so they outlive the job's scratch folder. The other arms were never served and are not recorded.

**Sampling.** The test's own draw, named in `frame` (the test, its group or stratum). One page per book. The draw is
usually stratified by an earlier finding (for #342: the weekly audit's flagged and clean pages), so `frame.selection`
is `picked`, and a rate over these rows is not a corpus rate.

**Reader and input.** One sealed `claude -p --model opus` call per page (scripts/eval/route-judge-6740/judge.mjs
`judgePrompt`), blind to arm: the page image, the stored transcription, the stored English with its `<summary>` and
`<keywords>` index blocks removed. Reader in the row: `{kind: model, model: claude -p --model opus, image_opened: true}`.
The judged text recorded is the page's OCR and English as drawn (byte-equal to the live page at draw time), so a later
rewrite makes the row stale by construction.

**Serious.** A page with a `misleads` or `wrong_text` defect. Each becomes an `errors` entry: stage `translation`
(the judge read the English; it does not say whether the transcription caused it), the taxonomy class, the judge's
sentence and quote as `problem`. A page with an `I1` defect is `wrong_page`.

**Verdict.** `verdict_source: rule`. `fix` for a wrong_text defect, `caveat` for a misleads defect, else `show`.

**Readers.** `reader_warning: false`. The judge prompt was tuned to rank routes and is strict (on #342 it found ~5
serious defects per 1,000 words on pages the weekly audit called clean). Rows are kept for measurement and put no line
on a book page.

**Known blind spots.** One reader, one read a page. The test's repeat controls give the judge's noise on that run.
Opus against Gemini-made text is cross-family, but cross-family agreement is modest (#6338).

**Rows written by** `scripts/eval/english-repair-342/record-checks.mjs` through `recordPageVerdicts()`, one row per
book per test. Evidence: the test's results dir under `scripts/eval/route-judge-6740/results/`.

**Versions.** v1 — 2026-11-14 (#342).
