---
stage: ocr
measure: none
languages: [de]
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "The 2026-10-30 decision (keep the live first-read knobs, 4 pages a call) no longer holds for German: PR #7874 (merged 2026-11-01) moved the German first read to 8 pages a call, under a router waiver that runs to 2026-11-15."
status: informational
decision: "Records a production change made elsewhere; supersedes 2026-10-30-read-surface-box-behnken-6740.md (#6553)"
feeds: none
supersedes: [2026-10-30-read-surface-box-behnken-6740.md]
superseded_by: null
issue: [6553, 6740]
router_evidence: "none — records a change already made, no route compared"
defect_rates: "none — nothing judged"
---
PRIOR ART: `2026-10-30-read-surface-box-behnken-6740.md` — the entry this one supersedes; found by `2026-11-04-experiment-kinds-6553.md` §7.

## 2026-11-04 · German first reads moved to 8 pages a call (#6553)

PR #7874 ("German first read at 8 pages a call, under a router waiver") merged 2026-11-01. The
`german-blank/print` cell in `scripts/lib/ocr-routing-table.json` carries the `first-read` waiver
(set 2026-11-01, until 2026-11-15). Latin and English keep the live knobs, as the 2026-10-30 entry found.

This is the case that started #6553's status check: the decision went to Derek, he took it, and the
write-up kept saying "keep 4 a call".

Found by the status-against-production check in `2026-11-04-experiment-kinds-6553.md` (§7), re-checked
against `origin/main` f193ddebc.
