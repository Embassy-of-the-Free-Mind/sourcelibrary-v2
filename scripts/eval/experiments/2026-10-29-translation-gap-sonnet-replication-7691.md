---
stage: pipeline
measure: [agreement]
languages: [la]
scripts: [Latn]
canons: []
n_books: 1000
n_pages: null
verdict: "A second adjudicator, Claude Sonnet run alone through lean claude -p web search, puts the Renaissance-composed translation gap at 96.8% [95.5–98.0] against the original Gemini+Claude 93.3% [91.3–95.2], and the all-print gap at 88.9% [86.9–90.9] against 84.9% [82.3–87.3]. Sonnet agrees with the dual-adjudicator consensus on 94.7% of 813 works (κ 0.86), with Claude on 97.4% of 311 (κ 0.94), with Gemini on 92.9% of 804 (κ 0.81). Its disagreements run one way: 36 works where it finds no prior translation that the consensus found, 7 the other way. In a sample of 8 of the 36, some are a stricter work boundary (Rolfe's Gentili renders the later expanded text; Camerarius's Aesop compilation) and some are plain misses (Cicero's Catilinarians; a 1741 English Faerno it found and then rejected). Sonnet alone therefore reads as an upper bound: the 93% headline stands and is not inflated by the Gemini pass."
status: informational
decision: "Headline unchanged (93%); the AI-partners footnote cites the replication as the upper end. Bulk web-search adjudication stays on Sonnet, and its own-collection first-translation figure (59% none found, #7598) shares this bias toward missing priors."
superseded_by: null
issue: [7691, 2684, 7598]
router_evidence: "none — an estimate replication, no routing cell"
---
## 2026-10-29 · Does the USTC translation-gap estimate survive a different adjudicator? (#7691)
<!-- PRIOR ART: .claude/docs/translation-gap-paper.md (design, seed 2684, Gemini on 1,000 + Claude on 419, κ 0.82); scripts/analysis/gap-validation-estimate.mjs (the estimator, reused here with --verdicts); scripts/analysis/gap-validation-score.mjs (toBinary rule, copied unchanged). -->

**Design.** The same 1,000 seeded USTC works (300 pipeline-"translated", 700 pipeline-"gap", print 1480–1620), re-keyed O0001… with mulberry32(7691) so the T/G prefix cannot leak the stratum. Same prompt and JSON schema as the Claude pass. One `claude -p --model sonnet` call per work, web search and fetch only (`scripts/analysis/gap-validation-cli-adjudicate.mjs`, the #7598 first-translation search setup), team@ subscription, concurrency 4. Estimated with `gap-validation-estimate.mjs --verdicts … --tag sonnet`: same stratum weights (6,744 / 158,737), post-stratified by Sonnet's own composition era (it agrees with the original era on 960 of 1,000), 5,000-rep bootstrap.

**Run.** 1,000 of 1,000 answered. 145 replies first logged as failures: 106 were intact verdicts whose last JSON string Sonnet left unclosed (`…weak.}`), recovered from the kept reply and now handled by the runner's parser; 33 timeouts or truncated replies were re-run. Sonnet: 269 translated, 702 untranslated, 29 uncertain; 112 marked container (excluded, as in the original).

| | Renaissance-composed gap | All-print gap | well-posed n |
|---|---|---|---|
| Gemini + Claude consensus (2026-06) | 93.3% [91.3–95.2] | 84.9% [82.3–87.3] | — |
| Sonnet alone (this run) | 96.8% [95.5–98.0] | 88.9% [86.9–90.9] | 881 |

Sub-rates: translated-stratum precision 166/224 (Renaissance 37/75); gap-stratum missed translations 55/657 (Renaissance 14/569).

**Replicated?** Yes in direction and magnitude: both instruments put nine in ten or more Renaissance-composed Latin works without an English translation. Sonnet sits higher because it finds fewer priors. Still no human gold standard.

Artifacts: `scripts/analysis/eval-data/gap-validation-sonnet-verdicts.jsonl` (one row per work, reply kept), `scripts/analysis/eval-data/gap-validation-n250-estimate-sonnet.json`.
