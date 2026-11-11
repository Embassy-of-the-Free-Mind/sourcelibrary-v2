---
id: leak-repair-5026
version: 1
stage: [translation]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [5026]
status: active
---
<!-- PRIOR ART: plate-reread-check.md and retranslation-gate.md (one page against its image; neither reads a PAIR of
pages for a passage one page's English took from the other's); lane-spot-check.md (a lane's random draw, the Siku rubric).
This instrument reads two consecutive pages together, because the defect is a relation between them. -->
## leak-repair-5026 v1 — does one page's English repeat its neighbour's text, and is a repaired page clean?

**What it is for.** `scripts/audit/translation-page-boundaries.mjs` flags consecutive pages whose English shares a run
of ≥ 500 characters while their sources do not. This method answers, for a flagged pair, "is that a real duplicate, and
which page carries the other's text?" (the spot checks), and for a page re-translated by the #5026 repair, "is the
duplicate gone, and is the new English a usable account of the page?" (the post-repair check). It says nothing about
the rest of the book.

**Sampling.** Spot checks: a seeded stratified draw from the flagged pairs (`scripts/eval/leak-repair-5026/pair-judge.mjs
draw`), one pair per book, strata by lane and month cohort, the two length bands balanced; `frame.selection` is
`random`. Post-repair: one repaired page per book, seeded, spread by language (`post-draw`), also `random`.

**Reader and input.** One sealed `claude -p --model opus` call per pair (or page), tools limited to Read. It gets both
pages' scans (it is told to open every image), their machine transcriptions and their English, and no stratum, lane,
model or detector score. Planted controls (made duplicates, clean pairs, unrepaired leaks) go through the same calls and
are not recorded. Reader in the row: `{kind: model, model: 'claude -p --model opus', image_opened: true}`.

**Serious.** A page is serious when the judge says its English carries a paragraph or more that renders the
neighbouring page's printed text (kind `carry_over`, taxonomy T4/T5), or, post-repair, when it is not usable (a
sentence or more left out, meaning changed, or text added that is not on the page). A minor defect the judge lists is
`minor`; otherwise `clean`.

**Verdict.** `verdict_source: rule`: `fix` for a serious page, `caveat` for a page with minor defects only, else `show`.

**Readers.** v1 rows do not warn readers (`reader_warning: false`). The spot-check pages were chosen BY the detector
(a flagged pair is not a random page of its book), and the repair rewrites the serious ones, so a warning would
describe text that is no longer served.

**Known blind spots.** One reader, one read. The judge reads the scans of two pages only: a passage taken from page
N−1 or N+2 is not looked for. Facing and bilingual editions (the same passage printed in two languages on two pages)
are legitimately duplicated in English, and the judge must notice the second language on the scan. v1 of the pair
prompt cut each English at 6,000 characters, so on long pages an overlap past the cut was invisible (round 2 was judged
again with the cut at 16,000; only the re-judged verdicts are recorded).

**Who writes its rows.** `pair-judge.mjs record`, after a round is scored.

**Versions.** 1 — 2026-11-08, first version.
