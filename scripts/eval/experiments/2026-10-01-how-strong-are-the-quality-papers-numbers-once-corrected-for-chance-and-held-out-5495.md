---
stage: translation
measure: agreement
languages: []
scripts: []
canons: []
n_books: null
n_pages: 327
verdict: "Corrected for chance the two judges agree at kappa 0.56 on sound vs not, and the two-read screen's recall falls from 74% in-sample to 55% held out."
status: informational
decision: "Quality paper text corrected and reader-panel protocol changed before sign-off (#5495)"
superseded_by: null
issue: 5495
---
## 2026-10-01 · How strong are the /research/quality paper's numbers once agreement is corrected for chance and the screen is scored on held-out pages? (#5495)

PRIOR ART: 2026-09-30-were-the-bootstrap-intervals-in-this-file-the-right-5373.md — recomputed bootstrap widths after the RNG fix, not chance correction or held-out scoring; 2026-09-30-translation-corpus-audit-…-5274.md and the #5313 entry are the runs re-analysed here, not replaced.

**Question.** The paper draft (`src/app/research/quality/page.tsx`) reported raw agreement and in-sample screen figures. Re-analysis of the committed runs, no new data, before the paper goes to TU Delft (#4916) and before the reader panel is signed off.

**Design.** `quality-paper-stats.mjs` over committed files only (seed 20261001): the 2026-09-30 translation audit verdicts (Opus, Sonnet, repeat items) and the #5313 two-read `scores.jsonl`. Chance-corrected agreement (quadratic-weighted κ on 1–5; Cohen's κ and Gwet's AC1 on sound ≥ 4 vs not), bootstrap 95% intervals over items; the screen's AUC (Mann–Whitney, bootstrap CI) and a repeated two-fold cross-validation (threshold chosen by F1 on one half, scored on the other, 1,000 folds); Wilson intervals on the small counts the paper quotes. `measure: agreement` throughout, not accuracy.

**Result.**
- **The two judges agree less than "within one point on 107 of 107" suggests.** 1–5 scale: weighted κ 0.73 (0.60–0.83). Sound vs not: 89% observed, κ **0.56** (0.32–0.76), AC1 0.85 (0.75–0.93). Opus is more lenient: 88% sound vs Sonnet 82%.
- **The two-read screen's recall is overstated in-sample.** At 0.7: in-sample recall 74% / 70% (lite / Flash); **held out 55% / 58%**, precision ~27–29% either way. AUC 0.79 (0.70–0.88) / 0.83 (0.77–0.89). κ vs the judge's garble flag 0.29.
- **Leaf signature:** 6/6 pre-known wrong leaves (Wilson 61–100%), 7/7 flagged were wrong leaf (65–100%), 0/258 false alarms (specificity 98.5–100%). Wrong-leaf rate 2/20 = 10% (**2.8–30%**).
- **Judge controls** 15/15 each (80–100%); repeat exact 11/15 (48–89%). Flags confirmed on the scan 20/21 (77–99%).
- **Reader panel sizing:** month 0 has 47 judge-defective pages of 311 (15%). ± 10 pp needs 34 answers at 90% agreement, 78 at 70%, 93 at 50%; under random order 40 defective answers need ~265 answers. → protocol changed before sign-off: alternate defective/sound pages, random 1-in-5 double reads (not disagreement-only — discrepant resolution), estimands and thresholds in `HUMAN-CALIBRATION.md` §7a.

*Grade.* Re-analysis; grades of the underlying runs unchanged. *Decision.* Paper text corrected (abstract screen sentence, §3–§7, an "At a glance" table); panel SAP added for Derek's sign-off. *Replicated?* No — the held-out figures are cross-validation on the same 327 pages, not a new draw. *Cost* $0. *Artifacts:* `results/quality-paper-stats-2026-10-01/` (report.json, report.md), `quality-paper-stats.mjs`, `lib/agreement-stats.mjs`.
