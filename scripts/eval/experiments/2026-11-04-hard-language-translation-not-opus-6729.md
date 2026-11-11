---
stage: translation
measure: none
languages: [fa, sa, lzh, grc, he]
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "The 2026-10-15 decision (\"Opus stays the hard-language translator\" for Persian, Sanskrit, Chinese, Greek, Hebrew) does not match production: Ancient Greek routes to Gemini 3.8 Flash on agy (greek-cli-gemini38, #7360), and Persian, Sanskrit, Chinese and Hebrew sit on the Gemini 3 Flash row (flash-measured). Of the cluster, only Pali routes to Opus."
status: informational
decision: "Records a production change made elsewhere; supersedes 2026-10-15-gemini-4-argon-low-translation-hardest-6729.md (#6553)"
feeds: none
supersedes: [2026-10-15-gemini-4-argon-low-translation-hardest-6729.md]
superseded_by: null
issue: [6553, 6729, 7075]
router_evidence: "none — records a change already made, no route compared"
defect_rates: "none — nothing judged"
---
PRIOR ART: `2026-10-15-gemini-4-argon-low-translation-hardest-6729.md` — the entry this one supersedes; found by `2026-11-04-experiment-kinds-6553.md` §7.

## 2026-11-04 · Opus is not the production translator for the five hardest languages (#6553)

`scripts/lib/translation-routing-table.json` on 2026-11-04: row `greek-cli-gemini38` (adopted 2026-10-25,
`2026-10-25-greek-cli-lane-sample-7075.md`, PR #7360), row `flash-measured` (gemini-3-flash-preview for
Hebrew, Aramaic, Arabic, Persian, Sanskrit, Chinese) and row `pali-cli-opus`.

The 2026-10-15 measurements (G4L ahead of 3.8 Flash, behind Opus under the Opus judge) are unchanged.
Its decision line was not a description of the routing table then or now.

Found by the status-against-production check in `2026-11-04-experiment-kinds-6553.md` (§7), re-checked
against `origin/main` f193ddebc.
