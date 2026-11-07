---
stage: translation
measure: none
languages: [yua, cak]
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "The 2026-10-14 decision (Gemini 3.8 Flash Low translates Yucatec Maya) no longer matches production: two days later the Yucatec lane moved to Gemini 4 Argon Low with a one-line style prompt, and 15 Yucatec books (1,341 pages) were retranslated with it (PRs #6795, #6801)."
status: informational
decision: "Records a production change made elsewhere; supersedes 2026-10-14-opus-vs-flash-translation-maya-6559.md (#6553)"
feeds: none
supersedes: [2026-10-14-opus-vs-flash-translation-maya-6559.md]
superseded_by: null
issue: [6553, 6559]
router_evidence: "none — records a change already made, no route compared"
defect_rates: "none — nothing judged"
---
PRIOR ART: `2026-10-14-opus-vs-flash-translation-maya-6559.md` — the entry this one supersedes; found by `2026-11-04-experiment-kinds-6553.md` §7.

## 2026-11-04 · The Maya translation lane is no longer Gemini 3.8 Flash Low (#6553)

The 2026-10-14 entry adopted Gemini 3.8 Flash Low as the Maya translation lane. The next test,
`2026-10-16-gemini4-opus1pp-maya-6559.md`, put Gemini 4 Argon Low ahead of it under both judges and
adopted it for Yucatec, with a style line. PRs #6795 and #6801 (merged 2026-10-16) retranslated 15
Yucatec books, 1,341 pages (`scripts/workers/needs/readable.md`, Yucatec Maya). Kaqchikel stays on Opus.

Neither header was changed, so the 2026-10-14 entry still read `adopted` with `superseded_by: null`.

Found by the status-against-production check in `2026-11-04-experiment-kinds-6553.md` (§7), re-checked
against `origin/main` f193ddebc.
