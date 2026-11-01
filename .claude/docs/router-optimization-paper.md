<!-- PRIOR ART: .claude/docs/quality-research-system.md (the loop's design: evidence store, estimator, planner, router; this doc restates its purpose as configuration search and adds validation and the paper); .claude/docs/paper-corpus-certification-4916.md and https://ocr-quality-paper.vercel.app/draft.md (the TU Delft paper on measuring quality without ground truth; this paper is the decision system that runs on those instruments); .claude/docs/research-agenda-ai-quality.md (what we want to find out); .claude/docs/eval-design.md (the rules one measurement follows). None of them states how we know the router works. -->

# The router as a search for configuration optima: purpose, validation, paper

**Read this when** you change the router (`scripts/eval/estimator/router-table/`), design a router test, or write about it. Tracking: #7263. Audit and plan: the #7263 comments of 2026-11-01.

## Purpose

For each kind of page (a **cell**: language × script × task), find the cheapest **configuration** that meets the quality bar, ship it, and keep checking that it is still the best.

- **A configuration** is engine × prompt × read mode × correction chain × settings (thinking level, pages per call).
- **The objective** is dollars per accepted page, subject to the quality bar.

The router serves three readers:

| reader | what they get |
|---|---|
| the pipeline | a routing row per cell |
| readers and partners | how far to trust the text they are served, on /quality |
| the field | the response surface: which factors move quality per dollar, and by how much |

## Where it stood on 2026-10-31 (`2026-10-31-correction-pass-7818.json`)

- **The search space.** 109 cells hold 5.2M waiting pages. 15 cells are decided (10 switch, 5 keep), covering 1.66M pages.
- **Thin evidence.** 344 route evaluations, with a median n of 8 judged pages; 191 have n < 10. 27 cells have one route measured.
- **The router does not drive production.** The routing tables last changed on 10-26. The only check is a warn-only `routeCheck` in `scripts/batch/cli-ocr-lane.mjs`.
- **The decision rule is biased.** Every candidate is gated at P ≥ 0.9 within 0.08 of the bar, and the cheapest passer wins. That rule has no multiplicity control, so it favours lucky winners.
- **The judge is unvalidated.** Opus is the sole judge, including of Opus text. There is no gold reference.

## Validation: how we know it is working

The router works if three things hold, each with a number we can check:

- its predictions come true on fresh pages;
- its decisions are rarely wrong;
- the text readers are served gets better per dollar.

Each check below has a pass bar set before the data. A failing check stops the router's decisions from shipping; it does not just get noted.

| # | question | test | pass bar | layer |
|---|---|---|---|---|
| V1 | Does the estimator predict cells it has not seen? | Leave-one-cell-out and leave-one-language-out CV, weighted by books | held-out calibration slope 0.8–1.2; log predictive density beats the flat prior | offline |
| V2 | Is the judge right? | Opus verdicts vs gold derived from human transcriptions (CHURRO-DS) and planted errors, per language | sensitivity and specificity ≥ 0.85 per routed language; self-preference (DBG) interval includes 0, or is corrected for | offline |
| V3 | How often is the decision rule wrong? | Simulate the rule on the cell's real n and route count at known true rates | false switch (true gap > margin) ≤ 5% per cell decision | offline |
| V4 | Does a switch reproduce? | A confirmation run on fresh books, paired, before the routing row ships | the winner stays within the margin on the fresh draw | before shipping |
| V5 | Did the shipped switch help? | Served-quality draw in that cell before and after (one page per book, ≥ 30 books) | acceptance not worse; $ per accepted page lower | after shipping |
| V6 | Is the optimum still optimal? | Monthly canary draw per shipped route | no drop beyond the margin; a drop reopens the cell | ongoing |
| V7 | Is the whole library getting better? | The served-quality draw of #7866 (5 pages a book, stratified), monthly | the share of bad live books falls; it was 43% (36–51%) on 2026-10-31 | the outcome |

- **V1–V3 decide whether the machinery can be trusted at all.** They run first: jobs `heldout-estimator-7263` and `judge-cal-churro-7263`, plus the simulation in the build-fix job.
- **V4–V6 are per decision.**
- **V7 is the one number that says the system is working.** It is also the headline on /quality.

## What to build (order)

1. **Shared strength.** An additive engine + language + script model, partially pooled. Its weight is set by V1, not by a fixed 5-page cap.
2. **Judge correction.** Prediction-powered intervals that use the V2 calibration.
3. **A best-arm planner.** Top-two Thompson sampling, weighted by pages waiting, with a Bayesian stopping rule. It replaces hand-picked tests and the fixed n floors.
4. **Paired designs.** Every candidate in a test reads the same books.
5. **Binding.** A decision that passes V4 opens the routing-row PR, which is on the hold list. `routing-drift.mjs` audits `current.json`. `routeCheck` is set to refuse once V1–V3 pass.
6. **Widen the space.** Add prompt, thinking level and pages per call.

## Prior art (searched 2026-11-01)

- **Hierarchical Bayesian bandits.** Hong, Kveton, Zaheer, Ghavamzadeh, AISTATS 2022.
- **Best-arm identification.** Russo 2016 (arXiv 1602.08448); Shang et al. 2020, top-two Thompson sampling (arXiv 1910.10945).
- **Routing and cascades.** Dekoninck et al. (arXiv 2410.10347), with a survey at arXiv 2603.04445. FrugalGPT and RouteLLM route per query; we route per cell, because a single page carries too weak a quality signal (#7866: AUC 0.66).
- **Judge correction.** Prediction-powered inference (Angelopoulos et al. 2023). On reporting a judge with a calibration set: arXiv 2511.21140.
- **Self-preference.** arXiv 2410.21819; the DBG score, arXiv 2506.02592.
- **Historical OCR gold.** CHURRO-DS (Stanford, EMNLP 2025, arXiv 2509.19768): 99,491 pages with human transcriptions, 46 language clusters.

## The paper

**Working title:** *Finding the cheapest adequate configuration across a hundred page types: a Bayesian router for corpus-scale AI digitization.*

**Relation to #4916.** #4916 builds the instrument (agreement, calibration, failure taxonomy, judge). This paper is the decision system that runs on it. It cites #4916 for the instruments and does not re-argue them. The V2 judge calibration is shared: it is also #4916's missing human calibration.

**Claim.** At corpus scale a library cannot test every configuration on every kind of page. With partial pooling across cells, a calibrated model judge and best-arm planning, it finds near-optimal configurations with far fewer judged pages than cell-by-cell testing, and we show the decisions hold on fresh pages and improve served quality.

**Sections.**
1. The problem: 109 cells, a noisy judge, quota prices that move hourly.
2. Method: the cell model, the judge correction, the planner, the confirmation runs.
3. Validation: V1–V3.
4. The response surface: which factors matter.
5. Deployment: V4–V7, before and after.
6. Negative results:
   - per-page signals do not support per-query routing here;
   - a cheapest-passer rule without multiplicity control picks weak routes;
   - the estimator that failed held-out prediction (v1).

**Data.** The router evidence rows, the dated tables, and the V2 gold set (licence permitting).

**What must exist before drafting.** The results of V1, V2 and V3. Each result lands as one record in `scripts/eval/experiments/`, citable by both papers.
