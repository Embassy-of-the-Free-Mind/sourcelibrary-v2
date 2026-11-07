---
stage: ocr
measure: [none]
feeds: route
landed: scripts/lib/router-binding.mjs
languages: []
scripts: []
canons: []
n_books: 0
n_pages: 0
verdict: "V3 FAILS on 11 of the 13 cells decide_defects compares: at the boundary a route truly past a gate is picked 18-47% of the time, against a 5% bar. Only french-blank/print (3.9%) and english-blank-pre1800/unknown (0.0%) pass. At the n the cells hold, power is also low (1-50%)."
status: adopted
decision: "A rule pick over the bar is not auto-bound: the nightly planBind pins the cell where it runs. A menu default, a held-over live route and a person's planned decision are not rule picks, and V3 does not gate them. Tightening the gates is open (DECISION on #8283)."
superseded_by: null
---

## 2026-11-07 — V3 on the one rule: the false-pick rate of `decide_defects` at each cell's real n (#8283)

**Question.** `decide_defects` replaced the k/n rule on 2026-11-06 and nothing had simulated it. How often does it pick a route truly worse than the bar by more than the gate's margin?

**Method.** `scripts/eval/estimator/router-table/v3_sim.py` imports `build.decide_defects`, no re-implementation, and runs it on table `2026-11-06-one-rule-8283`: 2,000 replicates a cell at each cell's acceptance n and defect exposure. No model calls, no pages. The boundary is the worse of two configurations: every other rated route just past gate 1 (wrong text +0.16 per 1,000 words), or just past gate 2 (acceptance -0.06). Paired evidence is simulated as independent.

| cell | rule says | candidates | false pick, boundary | estimates | power | auto-bound? |
|---|---|---|---|---|---|---|
| latin-flash3/print | switch pero>agy@4 | 3 | 32.6% | 0.1% | 27.5% | no |
| german-lite/print | keep lite>opus | 2 | 32.6% | 0.0% | 46.5% | no |
| german-flash3/print | keep 3flash>opus | 2 | 34.6% | 5.7% | 47.8% | no |
| german-tr-lite/print | switch opus-cli | 1 | 47.3% | 0.0% | 50.0% | no |
| tibetan-yigdzin/manuscript | switch yigdzin>agy | 2 | 28.0% | 0.0% | 38.6% | no |
| zh-paddle-dice-lt090/manuscript | HOLD paddle>opus | 3 | 32.8% | 0.0% | 16.0% | no |
| chinese-flash3/print | keep 3flash>opus | 1 | 18.1% | 0.0% | 30.9% | no |
| latin-blank/print | HOLD agy@4-written | 4 | 36.7% | 5.6% | 24.5% | no |
| german-blank/print | HOLD agy@4>agy@4-written | 9 | 22.9% | 0.1% | 12.1% | no |
| german-blank-fraktur/print | keep agy@4-written | 4 | 38.8% | 0.0% | 12.4% | no |
| german-blank-antiqua/print | HOLD lighton-written | 3 | 36.7% | 17.9% | 12.2% | no |
| french-blank/print | HOLD agy-written | 4 | 3.9% | 0.1% | 1.4% | yes |
| english-blank-pre1800/unknown | keep scans-only | 1 | 0.0% | 0.0% | 0.0% | yes |

The other 109 cells have no rule pick to be false.

**What it does not say.** The boundary is the least favourable truth, not the likely one: with the table's own estimates as the truth, the rate is under 6% in all but one cell. It measures the rule's margins at these n, not whether any route is good. Reports: issue comment on #8283 (2026-11-07), and rows[].v3 in every table the nightly rebuild builds.
