---
stage: ocr
measure: judged
languages: [la]
scripts: [Latn]
canons: []
n_books: 30
n_pages: 30
verdict: "Latin 3 Flash pages: both corrections beat the stored text on the same 30 pages, one page per book. Opus correction (the cell's live route): 27/30 accepted, 1.04 misleading per 1,000 words. Flash-low correction: 26/29, 1.14. Stored 3 Flash: 21/30, 3.2. Each correction gains 6 accepts and loses 0 (p 0.03). Opus and Flash-low are not distinguishable at n=30."
status: undecided
decision: "No route moved. Evidence for latin-flash3/print and latin-flash3/unknown, both HOLD because the live route had no defect verdicts; the router decision is Derek's (DECISION on #8632)."
feeds: "route"
supersedes: []
superseded_by: null
issue: [8632]
router_evidence: ["latin-flash3"]
defect_rates: "scripts/eval/route-judge-6740/results/latin-flash3-live-route-8632/defect-rates.json"
---
PRIOR ART: scripts/eval/route-judge-6740/results/router-tests-2026-10-26 (the same 30 pages: 3flash and
3flash>agy-flash-low judged then, its verdicts reused here for unchanged texts) and
2026-11-07-router-v3-defect-rule-8283.md (the rule that holds a cell whose live route has no defect verdicts).

## 2026-11-12 · Does the live route for Latin 3 Flash pages beat the alternatives? (#8632 decision 2)

**Why.** The repair queue has 470 pages in latin-flash3/unknown with a serious OCR finding and no route. The table's
latin-flash3/print (692,318 pages waiting) and /unknown (549,086) rows are HOLD because the live route,
`3flash>opus`, had never been judged for defects, so the rule had no comparator. Derek approved route tests in the two
largest no-route cells on spare quota, with no writes (2026-11-12).

**Design.** The 30 pages of router-tests-2026-10-26, one per book (`judge.mjs draw --from`), visible Latin books not
held, stored 3 Flash OCR, interior, 300 or more characters, not handwritten. Three arms:
- `3flash`, as stored;
- `3flash>agy-flash-low`, corrected afresh by agy on the james pool with the #5924 template;
- `3flash>opus-correct`, correct.mjs on Opus, one page a call.

Nothing was kept for a lane or written. The judge was Opus through `claude -p`, blind, one output a call, against the
image. There were 2 wrong-page controls per arm and 6 same-arm repeats, and `paired-arm.mjs check` passed R1–R5
before judging. 38 verdicts were reused from 2026-10-26 for unchanged texts, and the rest were judged now. One agy
correction did not return (29 pages).

| arm | accept | by-book 95% | wrong text | misleading / 1k words | wrong text / 1k | fidelity | control |
|---|---|---|---|---|---|---|---|
| 3flash (stored) | 21/30 | 0.533–0.867 | 4/30 | 3.20 | 1.78 | 4.07 | pass |
| 3flash>agy-flash-low | 26/29 | 0.759–1 | 2/29 | 1.14 | 0.38 | 4.45 | pass |
| 3flash>opus-correct (live) | 27/30 | 0.8–1 | 2/30 | 1.04 | 0.23 | 4.47 | pass |

- `3flash` → `3flash>agy-flash-low`, on 29 shared pages: 10 better, 2 worse; 6 accepts gained, 0 lost (sign test p 0.03).
- `3flash` → `3flash>opus-correct`, on 30 shared pages: 12 better, 0 worse; 6 accepts gained, 0 lost (p 0.03).
- Noise floor: the same output judged twice flipped accept on 0 of 6 pages (mean fidelity difference 0.17).

**Reading.** Either correction removes about two thirds of the misleading errors in stored 3 Flash Latin text. The two
correctors are within one page of each other, which is inside the noise at n=30. One costs an Opus call a page, the
other an agy Flash-low call on subscription. The pages were drawn from the cell's frame, not from the flagged pages,
so this is the cell's rate, not the repair queue's.

### Replicated?

Partly. 3flash and 3flash>agy-flash-low agree with the 2026-10-26 run on the same pages; that run judged no Opus arm.
No second judge family, and no held-out draw.

**Not done.** Greek (greek-flash3/unknown, 371 flagged pages) was not tested. Its row is held by Derek's decision of
2026-10-14 (#6694, Greek stays on lane A), so a result there could not move a route without lifting that hold first.
