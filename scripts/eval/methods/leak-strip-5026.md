---
id: leak-strip-5026
version: 1
stage: [translation]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [5026]
status: active
---
<!-- PRIOR ART: leak-repair-5026.md (a flagged PAIR, "is the duplicate real and which page is wrong", and a re-translated
page against its image). It never sees a proposed cut. This method reads a planned DETERMINISTIC edit (a passage removed
from one page's stored English) before it is written, and the stripped page after. -->
## leak-strip-5026 v1 — is a planned strip of a neighbour's passage right, and is a stripped page clean?

**What it is for.** `scripts/maintenance/leak-strip-5026.mjs plan` proposes to remove, from the wrong page of a flagged
pair, the run of English it shares with its neighbour. The wrong page is chosen by the #8401 rule
(`neighbourVerdict`, scripts/lib/neighbour-guard.mjs). Spot check: after the edit, does each page carry only its own
text, and was any of the edited page's own text removed? Post-check: is the duplicate gone from a stripped page, and
are its edges clean? It says nothing about the rest of the book.

**Sampling.** Spot check: one planned edit per book, seeded. Books with readers come first, and no language takes more
than a quarter of the draw (`spot-draw`). Post-check: one written edit per book, seeded, the same way (`post-draw`).
`frame.selection` is `random`. The frame is the planned edits, not the book.

**Reader and input.** One sealed `claude -p --model opus` call per edit, with tools limited to Read. It gets both pages'
scans (it is told to open them when in doubt), their transcriptions, both stored Englishes, the removed passage(s) and
the edited page's English after the cut. It is not given the rule's score, the stratum or the model. Planted controls go
through the same calls and are not recorded. Spot-check controls are inverted edits: the passage is cut from the page
the rule says owns it. Post-check controls are a stripped page with the removed passage put back.

**Serious.** Spot check: the page's stored English repeats a passage the judge places only on the neighbour (kind
`carry_over`). The verdict concerns the stored text, which the strip had not touched yet. Post-check: the duplicate is
still there (`carry_over`), or a sentence or more of the page's own text is missing. A dangling edge fragment is `minor`.

**Verdict.** `verdict_source: rule`: `fix` for a serious page, `caveat` for minor only, else `show`.

**Readers.** v1 rows do not warn readers (`reader_warning: false`). The pages were chosen by the detector, and they are
queued for the own-leaf re-translation waves.

**Known blind spots.** One reader, one read. Only the pair's two pages are read. A strip is judged right only if each
page afterwards carries only its own text. A cut that removes the verbatim copy but leaves a paraphrase of the same
neighbour text counts as wrong, and that was the commonest failure in v1.

**Who writes its rows.** `leak-strip-5026.mjs record --round=spot|post --apply`.

**Versions.** 1 — 2026-11-08, first version.
