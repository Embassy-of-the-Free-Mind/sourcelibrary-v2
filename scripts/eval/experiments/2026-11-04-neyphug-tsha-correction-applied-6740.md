---
stage: ocr
measure: none
languages: [bo]
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "The 2026-10-26 NO-GO (nothing written; the volume keeps its Yigdzin read) no longer matches production: the agy Flash-low correction was applied to the volume, and the next day Opus retranslated 738 of its 739 corrected leaves (#7495), with leaf 128 withheld for an invented line."
status: informational
decision: "Records a production change made elsewhere; supersedes 2026-10-26-tibetan-flash-correct-neyphug-tsha-6740.md (#6553)"
feeds: none
supersedes: [2026-10-26-tibetan-flash-correct-neyphug-tsha-6740.md]
superseded_by: null
issue: [6553, 6740, 6948]
router_evidence: "none — records a change already made, no route compared"
defect_rates: "none — nothing judged"
---
PRIOR ART: `2026-10-26-tibetan-flash-correct-neyphug-tsha-6740.md` — the entry this one supersedes; found by `2026-11-04-experiment-kinds-6553.md` §7.

## 2026-11-04 · The Flash-low correction of Neyphug rGyud Tsha was written after all (#6553)

The 2026-10-26 entry failed its preregistered gate (10 of 40 pages worse, controls 84%) and wrote nothing.
The volume's pages now carry the correction (`ocr.pipeline` tib-correct-6560), and
`2026-10-27-opus-retranslate-flash-corrected-tibetan-6948.md` (PR #7495) records the retranslation of
738 of the 739 corrected leaves. Leaf 128 keeps an invented line from the correction and its English is
withheld (book held `tib-flash-invented-line-6948`).

The gate result itself stands as measured. What changed is the decision, and no header recorded it.

Found by the status-against-production check in `2026-11-04-experiment-kinds-6553.md` (§7), re-checked
against `origin/main` f193ddebc.
