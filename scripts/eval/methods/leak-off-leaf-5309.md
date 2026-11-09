---
id: leak-off-leaf-5309
version: 1
stage: [ocr, translation]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [5309]
status: active
---
<!-- PRIOR ART: leak-repair-5026.md (a PAIR of pages for a duplicated passage in the English) and lane-spot-check.md
(a lane's own draw, the Siku rubric, one page against its image). Neither asks which leaf a stored TRANSCRIPTION came
from with a window wide enough for #5309's −3/−5 offsets, and neither judges a re-OCR'd page with its new English. -->
## leak-off-leaf-5309 v1 — is a stranded page's text another leaf's, and is a repaired page its own and usable?

**What it is for.** Pages of Internet Archive books whose image the #3368 repair corrected while their text, read from
the shifted image, stayed (`scripts/audit/stranded-image-repair-text.mjs`). Before the repair it answers "is the stored
transcription really another leaf, and which?" (the `pre` stage: the precision of the stranded list). After
`scripts/maintenance/offleaf-fix-5309.mjs` re-reads a page it answers "is the new transcription this leaf's, and can a
reader rely on it and on its new English?" (the `post` stage). It says nothing about the rest of the book.

**Sampling.** `scripts/eval/offleaf-5309/judge.mjs`. Pre: one stranded page per book, books drawn uniformly at random
from the audit's list, seeded. Post: one repaired page per book from the repair's ledger, seeded. `frame.selection` is
`random` in both; the frame is the stranded list (pre) or the pages a wave wrote (post), not the corpus.

**Reader and input.** One sealed `claude -p --model opus` call per page, tools limited to Read. Pre: the scans of pages
n−3 … n+3 and the stored transcription; the question is which leaf it renders (p<k>, none, cannot_tell). Post: the
scans of n−1, n, n+1, the new transcription and the English; questions leaf, usable, defects by kind. The judge is not
told the detector's verdict, the offset, or that a shift is expected. Controls go through the same calls and are not
recorded: pre — the six #5309 positive-control pages with their current (repaired) text and with their pre-repair text
from page_revisions; post — two repaired pages given back their pre-repair transcription. Post pages are also read by
agy gemini-3.8-flash-low with the same prompt, to calibrate it as a checker; only Opus verdicts become rows.

**Serious.** Pre: the stored transcription renders another leaf (`wrong_page`). Post: not the page's own leaf, a serious
defect (a line or sentence lost, added or changed in meaning), or not usable.

**Verdict.** `verdict_source: rule`: `fix` for a serious page, `caveat` for minor defects only, else `show`.

**Readers.** v1 rows do not warn readers (`reader_warning: false`): pre pages are the repair's own queue (rewritten
after the check), and post pages are a lane's spot check of text it has just written.

**Known blind spots.** One reader, one read. Pre: a leaf more than three away is answered `none` (offset unknown).
Post: the judge sees three scans, so a transcription of a leaf two away reads as `other`.

**Who writes its rows.** `judge.mjs record --stage pre|post --apply`, after the stage is scored.

**Versions.** 1 — 2026-11-08, first version.
