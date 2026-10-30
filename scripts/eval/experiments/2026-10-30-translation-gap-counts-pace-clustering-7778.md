---
stage: pipeline
measure: [agreement]
languages: [la]
scripts: [Latn]
canons: []
n_books: 1000
n_pages: null
verdict: "On the n=1000 USTC Latin sample, about 96% of Renaissance-composed works have no English translation when counted as works (3.8% [2.5–5.3] translated, paper reading), against 93.6% as clusters and about 91% as editions. Our clusters split famous works: a translated cluster's work spans 5.8 [4.8–7.0] clusters, an untranslated one's 2.1 [1.9–2.4]. Over-merge is 1.9% [1.0–3.0]. Source Library's 6,420 readable clusters are 12.4% [10.4–14.9] of the validated prior in clusters, and about a quarter in works; two-thirds is outside every interval. The matcher finds 11–25% of translated Renaissance works. First English translations of Renaissance Latin run a few dozen works a year (23–52 across readings, 1980–2025), so the rest would take thousands of years (central 3,000–10,000); 7,000 years is not a floor. The scorer counts partial priors as translated, against the paper's rule; the strict reading lowers the Renaissance translated share from 6.4% to 4.3% (clusters)."
status: informational
decision: "Donor copy uses the six figures in translation-gap-paper.md §10 and retires 'two-thirds as much as every earlier translator', '~40 a year … 7,000 years' and '~2,000 works ever translated'. The 42 matcher-missed translations that pass the gate are staged (source gap_validation, #7769 shape), not written to translation_catalogs. Headline not re-issued on the strict reading."
superseded_by: null
issue: [7778, 2684, 7691, 7751, 7769]
router_evidence: "none — an estimate, no routing cell"
---
## 2026-10-30 · Counts, pace and clustering checks on the translation-gap sample (#7778)
<!-- PRIOR ART: scripts/analysis/gap-validation-estimate.mjs (rates only, window only; its strata, weights and bootstrap are reused); scripts/translation-layer/11-work-graph.mjs (a whole work graph, hand-checked at n=40; used as a candidate source); #7769 staged shape for the staged rows. -->

**Design.** No new adjudication of the translation question. The 1,000 seeded works (seed 2684) are read three ways: the published consensus (*paper*), the same consensus with `partial` priors counted as untranslated (*strict*), and Sonnet alone (#7691). Counts use the window's per-stratum rates and era shares, applied to the full pools (9,830 / 356,375 clusters). Pace: the first English translation cited for each of the 79 Renaissance-composed works found translated, dated by hand. Clustering audit: one `gemini-3.1-flash-lite` call per sampled cluster (titles only; about $0.16) on its member titles and up to 30 same-author clusters. Sonnet judged the first 131 before the box's Claude account hit its pace guard. Edition level: each cluster weighted by its edition count.

**Run.** Scripts: `scripts/analysis/gap-validation-counts.mjs`, `-cluster-audit.mjs`, `-stage-translations.mjs`. Flash-lite answered all 1,000. On the 131-cluster overlap, Sonnet and flash-lite agree on split versus no split 124 times, with Jaccard 0.70 on the same-work sets; flash-lite flags over-merge 13 times to Sonnet's 2. Of 78 matcher-missed translations, 42 pass the staging gate (two instruments plus a live link that names the work) and 36 are held. Gemini's cited Google Books ids were often invented.

| Renaissance-composed, print 1400–1700 (extrapolated) | paper | strict | sonnet |
|---|---|---|---|
| translated works | 9,348 [6,197–12,941] (3.8%) | 6,988 [4,108–10,254] (2.8%) | 5,725 [3,046–8,880] (2.4%) |
| translated clusters | 20,241 [14,356–26,827] (6.4%) | 13,789 (4.3%) | 9,218 (3.0%) |
| first translations a year, works, 1980–2025 | 52 [19–94] | 39 [14–71] | 23 [2–53] |
| years to finish, works | 4,568 [2,508–12,288] | 6,118 [3,307–17,781] | 10,127 [4,436–100,512] |

**Process note.** The first version of the staging script inserted 37 rows into `translation_catalogs` after an inbox note forbidding it had arrived (00:08Z), but before the job re-read the inbox. They were deleted by id minutes later. The table is back to 40,538 rows, and the script now has no database write path.

Artifacts: `scripts/analysis/eval-data/gap-validation-counts.json`, `-cluster-audit-flash-lite.jsonl`, `-cluster-audit.jsonl`, `-translation-years.json`, `-staged.jsonl`, `-catalog-rows.json`.
