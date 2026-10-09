---
stage: translation
measure: [preference, judged]
languages: [la, de]
scripts: [Latn]
canons: []
n_books: 9
n_pages: 63
verdict: "Repaired batch lane ties production on seam fluency (19-18, inside the A/A gap), but the repair echoes untranslated source on 2 of 63 seams and invents bridging text"
status: rejected
decision: "No flip of the batch + seam-repair lane; echo and omission gates added (PR #5089)"
superseded_by: null
issue: 4681
---
## 2026-09-25 — Batch + seam-repair lane vs production, judged for REAL this time (#4681) — TIE on fluency; the repair step has fidelity defects the judge cannot see

Same nine shadow runs as the 2026-09-24 decisive draw, re-packeted after PR #5077 (the harness now substitutes
the repair) and after fixing `readerText` to strip the OCR front-matter wrappers the way the site does — a
repair mirrors `<scan-quality>…<page-num>` and showed the judge "good German printed text 65" on one arm
only (arm-identifying, blinding broken). 111 blinded mid-flow junctions (63 S1/P, 48 S1/S2), 8 Sonnet
judges, tag `translation-batch-seam-repaired`. Subscription judges; $0 API.

| pair | n | tie | decided | split | share |
|---|---|---|---|---|---|
| S1/S2 (same lane twice, A/A floor) | 48 | 27 (56%) | 21 | 8–13 (p=0.38) | — |
| S1/P, repaired lane vs production | 63 | 26 (41%) | 37 | lane 18 – production 19 (p=1.0) | production 51.4% |

**Fluency at the seam: tie.** The gap (19–18) is inside the A/A gap (13–8). Point estimate under the 60%
limit; at n=37 the CI still reaches it.

**Hand read, 18 junctions against the source OCR** (all 7 length-flagged + 4 P + 4 S1 + 3 ties): 14 verdicts
hold; j037 and j061 are ties the judge decided; **j040 and j033 are lane wins the judge got backwards** —
the repaired seam *invented* a bridging phrase ("all the angelic choirs", not on the page) and expanded a
"Gloria" rubric into a full doxology the page does not carry, and the judge rewarded the fluency. The
new completeness flag (`seam_len`) caught a real production defect (j089: production's p.25 is 784 chars
of the wrong passage; lane correct) and three lane ones (j103 repair dropped the carried sentence, ~60
words; j050 lost the verb of a split word; j105/j060 below).

**The repair step echoes untranslated source on 2 of 63 seams (3.2%) — and the DRAFT on those pages did
not.** Token-overlap of the first 60 words with the OCR ≥0.6: lane j105, j060 (both 1.0); draft 0/63;
production 0/63. `chooseSeamText`'s health check let a Latin page through as a "repair". Issue filed.

**Read:** on the judge's question the lane ties production. On fidelity the repair introduces three
defect classes (echo, omission of the carried sentence, fabricated bridge) at a rate a junction judge
cannot see and a length flag only partly catches. Not a flip; the repair needs an echo/omission gate
before it is judged again. Files: `results/translation-batch-seam-repaired-*`, report
`…-report-2026-09-25.json`. Cost $0. Record: #4681.
