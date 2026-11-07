---
stage: ocr
measure: none
languages: [la]
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "The 2026-10-28 entry rejected the Latin diff-QA route and kept lite>opus for the latin-lite cell. The diff-QA rejection stands, but the cell moved: on 2026-11-03 latin-lite/print switched to agy-flash-low@4-read (20/30, table 2026-11-03-latin-v4-7263)."
status: informational
decision: "Records a production change made elsewhere; supersedes 2026-10-28-latin-diffqa-three-way-vote-7591.md (#6553)"
feeds: none
supersedes: [2026-10-28-latin-diffqa-three-way-vote-7591.md]
superseded_by: null
issue: [6553, 7591, 7263]
router_evidence: "none — records a change already made, no route compared"
defect_rates: "none — nothing judged"
---
PRIOR ART: `2026-10-28-latin-diffqa-three-way-vote-7591.md` — the entry this one supersedes; found by `2026-11-04-experiment-kinds-6553.md` §7.

## 2026-11-04 · The latin-lite router cell no longer keeps lite>opus (#6553)

`scripts/lib/ocr-routing-table.json` `router_cells`: `latin-lite/print` → decision `switch`, route
`agy-flash-low@4-read`, k/n 20/30, set 2026-11-03, from `2026-11-03-router-v4-latin-lite-7263.md`.

Diff-QA is still not a live route, so that half of the 2026-10-28 result holds. This entry supersedes it
because its decision line names the live route of a cell that has since changed.

Found by the status-against-production check in `2026-11-04-experiment-kinds-6553.md` (§7), re-checked
against `origin/main` f193ddebc.
