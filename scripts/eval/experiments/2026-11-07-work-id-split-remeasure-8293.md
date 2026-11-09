---
stage: metadata
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 798
n_pages: null
verdict: "After the 102-cluster split, a fresh-seed draw of 100 clusters from each repaired route finds a different work in 3/100 model-merged clusters (3.0% [1.0–8.5]; 2.0% on clear calls) and 3/100 legacy seeds (3.0% [1.0–8.5]). Neither point estimate is under about 2%, and n=100 cannot show it either way. Every one of the six uniform-sample hits is a cluster the apply deliberately left out: four have a settled first-translation card and two were read as arguable. No clear, ungated cluster was missed. Planted gate 60/60, controls 30/30."
status: informational
decision: "No further repair in this job. What remains is the 23 settled-card clusters (FT lane) and the 31 arguable ones (a person), listed on #8293; applying the gated four alone would bring both uniform samples to 0/100 or 2/100."
superseded_by: null
issue: [8293, 8291]
router_evidence: "none — catalogue-identity work, no OCR or translation route"
feeds: repair
---
## 2026-11-07 · After the split, is each repaired work_id route under about 2% different-work clusters? (#8293)
<!-- PRIOR ART: 2026-11-07-work-id-overmerge-audit-8291.md (the first measure, same instrument) and 2026-11-07-work-id-split-census-8293.md (the census and split list); overmerge-audit.mjs is reused unchanged. -->

**Why.** #8293 is done when each repaired route is under about 2%. The 102-cluster split (sweep `reviewed-work-splits-2026-11-07`, 208 books) was applied on 2026-11-07, and this run re-measures afterwards.

**Frame.** I took a fresh export of live books (`visible: true`, `pages_count > 0`): 71,243 books, 50,064 ids and 5,390 clusters with 2+ books. The seed is **`overmerge-8293-remeasure-2026-11-07`**. From the instrument's draw I kept the two repaired routes. The model-merge route with no second judge has 1,951 clusters and 6,345 books; I drew 100 uniform plus the instrument's 14-cluster top-up of clusters with 6+ books. The legacy-seed route has 162 clusters and 617 books; I drew 100 uniform instead of the default 50, as the brief asked, which is 62% of the route. Read-only.

**Gate, read before any rate.** The planted set is new: `scripts/eval/work-recall/overmerge-planted-8293-remeasure.jsonl`. Its candidates excluded both earlier planted sets. An Opus reader read every candidate first. Of 36 easy candidates it kept 30. Of 85 hard ones it kept 30: most rejections were editions, numbered disputations of one series, or volumes. Of 38 controls it kept 30. Result: **60/60 caught [94–100]**, also 60/60 on the strict count. The controls came back 30/30 `all_same_work`, with 0 false alarms. Passed.

**Judge.** `overmerge-audit.mjs judge`, which runs `claude -p --model sonnet` on the subscription with the prompt unchanged, made 51 calls with 0 failures. Model route: same 64, volume-or-part 17, container 20, different 4, unsure 9. Legacy route: same 19, volume-or-part 65, container 6, different 8, unsure 2.

**Read.** Two Opus readers read all 99 clusters on the `readlist` packet, route-blind. The packet held every flagged cluster plus the instrument's 30 same and 20 volume-or-part controls. Labels: same 38, container 31, volume-or-part 22, different work 8. They read OCR on 10 clusters and opened page images on 2. Labels: `scripts/eval/work-recall/overmerge-remeasure-read-8293.jsonl`.

| route | uniform n | different work | clear only | container | books in affected clusters (bootstrap) | before (#8291) |
|---|---:|---|---|---:|---|---|
| model merge, no second judge | 100 (+14 top-up) | **3, 3.0% [1.0–8.5]** | 2, 2.0% [0.6–7.0] | 14 | 4.3% [0.8–9.1] | 8/100, 8.0% [4.1–15.0] |
| legacy seed | 100 of 162 | **3, 3.0% [1.0–8.5]** | 3, 3.0% | 9 | 6.4% [0–15.9] | 4/50, 8.0% [3.2–18.8] |

**What remains is the deliberate hold-out list.**
- Model route, uniform sample:
  - `local:a:charles-estienne:fountain-little-orchard-thicket-woods`: a clear split, gated by a settled FT card.
  - `local:a:trajano-boccalini:auss-parnasso-politischer-probier-stein`: called arguable by the census reader.
  - `local:a:gilbert-cousin:aliquot-cognati-epistolae-gilberti-nozereni`: called arguable by the census reader.
- Legacy route, uniform sample: `corpus-hermeticum`, `vinci-notes-sketches-anatomy-horse` and `leibniz-correspondence`. All three are clear splits gated by a settled FT card.
- Model route, top-up (not counted in the rate), two clusters the census did not settle:
  - Porphyry *De abstinentia*: the census reader called it a container. Here the OCR shows the BSB 1453 MS is a sermon/gluttony tract.
  - `local:n:petrus:iv-libri-sententiarum`: the census judge did not flag it. The page images show a 34-page 1488 book that holds only the appended *articuli*.

None of the uniform hits is a clear, ungated cluster that the census missed. If the four settled-card clusters were applied, both uniform samples would show 0/100 (legacy) and 2/100 (model, the two arguable). 0/100 has an interval of [0–3.7], so n=100 can show the point estimate but cannot prove a rate under 2%.

**Not done here.** No further repair, as the brief asked. The 23 settled-card clusters, the 31 arguable ones and the two top-up finds are listed on #8293 with owners. Containers (14% and 9%) remain out of scope (#3258).
