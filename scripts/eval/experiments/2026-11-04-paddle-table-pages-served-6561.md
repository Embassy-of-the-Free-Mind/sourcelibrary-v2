---
stage: ocr
measure: none
languages: [lzh]
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "The 2026-10-14 decision (serve nothing: Gemini flagged 23 of 100 pages) was overturned two days later: Claude arbitrated the 23 flagged spans against the images, found them printed on the page, and all 4,379 Opus-corrected table pages were served (#6744)."
status: informational
decision: "Records a production change made elsewhere; supersedes 2026-10-14-paddle-table-gemini-review-gate-6561.md (#6553)"
feeds: none
supersedes: [2026-10-14-paddle-table-gemini-review-gate-6561.md]
superseded_by: null
issue: [6553, 6561]
router_evidence: "none — records a change already made, no route compared"
defect_rates: "none — nothing judged"
---
PRIOR ART: `2026-10-14-paddle-table-gemini-review-gate-6561.md` — the entry this one supersedes; found by `2026-11-04-experiment-kinds-6553.md` §7.

## 2026-11-04 · The Opus-corrected Paddle table pages were served, after Claude arbitrated the Gemini flags (#6553)

Derek's steer on 2026-10-15 made Gemini's review a recorded second opinion rather than a gate.
`scripts/eval/paddle-review-6561/README.md` (step 2b) and commit 3ec7e27d7 (PR #6744, 2026-10-16) record
the arbitration: all 23 flagged spans are printed on the page, and the 4,379 pages were served. The
2026-10-14 entry had already shown the 5 invented calls it opened were wrong.

Found by the status-against-production check in `2026-11-04-experiment-kinds-6553.md` (§7), re-checked
against `origin/main` f193ddebc.
