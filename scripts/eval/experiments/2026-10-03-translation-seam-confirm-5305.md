---
stage: translation
measure: judged
languages: []
scripts: []
canons: []
n_books: 125
n_pages: 125
verdict: "Seam lines alone do not cut page-boundary invention on block-door page breaks: 19 / 19 / 19 pages (v13a / v13b / seam), p 0.60. Rule output FAIL."
status: rejected
decision: "FAIL: seam lines not flipped (PR #5675, DECISIONS.md)"
superseded_by: null
issue: 5305
---
## 2026-10-03 · Do the seam lines alone (#5305 items 1 + 1b) cut page-boundary invention on the chained lane's page breaks? Confirmatory (#5305)

**Question.** In the v14 A/B, page-boundary invention fell from 20 to 8 pages and the continuity-meta payload from 32
to 0. Those were exploratory secondaries of a package that failed its own rule. Does the seam family alone (item 1,
"This page only", plus item 1b, the bare continuity marker) reproduce that drop on new chained-lane page breaks?

**Design.**
- Pre-registered in `PREREGISTRATION-translation-seam-confirm.md`, committed before the draw.
- Arms: v13a, v13b (the A-vs-A noise floor), and seam (v13 + v14's items 1 and 1b, byte-identical; candidate md5
  `9d9794376f5d09211ca95509e44bef57`, not a `prompts` row).
- Chained-lane block door (seed + adjacent OCR + `PAGE_BREAK_SCOPED`), Flash-Lite, Batch.
- 125 new pages, one per book, none from a v14 book: 100 whose source ends open, 25 closed-end controls.
- Judged blind by 24 Opus packets with the v14 judge text, including 20 repeats.
- Spend: $0.531.

**Result.**
- **Rule output: FAIL.** Page-boundary invention on page breaks is 19 / 19 / 19 pages (v13a / v13b / seam), with
  8 vs 8 discordant pages, one-sided p 0.60.
- Both guards hold: control invention 4 / 5 / 3 pages; pooled omission 24 / 22 / 21.
- Item 1b removes the meta payload, 6 / 5 / 0 pages (p 0.031). On the block door the payload is rare.
- Re-reading the v14 data by door explains the gap. v14's boundary drop came from its single-page-door strata,
  where v13 writes the previous page's words into the continuity meta (22 of 45 flagged pages). On v14's block-door
  page breaks the counts were 7 / 4 / 3, inside noise, which matches this run.
- On the block door, the bridging that remains is the model completing a sentence or a hyphenated word from page
  N+1. The "This page only" lines do not stop it.

**Replicated?** Yes, as a null on the block door: this run and v14's block-door stratum agree. The single-page-door
effect has not been confirmed.

**Artifact.** `scripts/eval/results/translation-seam-confirm-2026-10-03/` (README, report.json with `decision`,
verdicts). The harness is `scripts/eval/translation-prompt-v14-ab.mjs --study seam`. The flip decision is on #5305
and is Derek's call.
