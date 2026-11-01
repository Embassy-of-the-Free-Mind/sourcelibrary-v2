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

## The parameter space (from `2026-10-31-correction-pass-7818.json`)

**Context: the kind of page, which we do not choose.**

| dimension | values |
|---|---|
| language | 25 (German 19 cells, Chinese 12, Latin 9, French 7, Greek 5, Arabic 5, …) |
| script type | print 41 cells, manuscript 40, unknown 28 |
| task | OCR (read, correct) or translation |
| existing read | the engine that already read the page (lite, 3 Flash, Paddle, Yigdzin, …) |

- **Size.** 109 cells over 47 base kinds of page hold 5.2M waiting pages.
- **Largest cells:**

  | cell | pages waiting |
  |---|---|
  | Latin print, lite | 835K |
  | Latin print, 3 Flash | 692K |
  | Chinese manuscript, Paddle | 454K |
  | German print, lite | 410K |
  | Tibetan manuscript, Yigdzin | 273K |

**Configuration: what we choose.**

| dimension | values seen |
|---|---|
| first read | Flash-Lite, 3 Flash, agy 3.8 Flash-low, GPU engines (Paddle, LightOn, PERO, GLM, Yigdzin), Opus |
| correction | none, agy Flash-low, Opus, a diff-QA variant |
| pages per call | 1, 4, 8 |
| input | image, text, image + text |
| prompt | mostly unrecorded (85% of pages) |
| thinking level | rarely varied |
| channel (who pays) | paid API, Gemini subscription (agy), Claude subscription, GPU box |

- 45 distinct configurations have been measured.
- The realistic space is about 120 configurations a kind of page before prompts, so about 6,000 combinations overall.
- 344 measurements have been made (about 5% of that), median n = 8.

**Objective and constraints.**
- **Minimize** dollars per accepted page. Quota is priced at its share of the fee.
- **Quality floor:** acceptance within 0.08 of the best measured route. Wrong text no worse than the best route's rate + 2 points.
- **Capacity:** each account's weekly limit, and GPU throughput.
- **Policy, stated separately from the statistics:**
  - on print, Opus is the bar and never a candidate;
  - Opus is the planned route for Greek manuscripts.

**Known flaws in the space.**
- **The cell includes the existing read.** "Latin print, lite" and "Latin print, 3 Flash" are the same kind of page, so their evidence is split. Better: describe the page by language, script and condition, and treat the first read as a choice.
- **Policy lives inside `build.py`** as exceptions, so the optimum is constrained without saying so.

## Search method

**Today.**
- Tests are chosen by hand in job briefs. Only 3 cells name a next test.
- Pilots run 20–30 pages on one or two configurations.
- Production lanes add evidence through the nightly lane-judge sampler (`scripts/eval/lane-judge-sampler.mjs`). That is exploitation data, biased toward routes already served.

**Planned.**
1. **Rank cells by value of information:** pages waiting × the probability that the decision changes × the cost gap between the top two candidates. A cell where a decision moves 410K pages outranks one that moves 2K.
2. **Within a cell, best-arm identification by top-two Thompson sampling** (Russo 2016). Sample from each configuration's posterior, measure the best and its closest challenger, and stop when P(the pick is within the margin of the best) ≥ 0.95 or the expected loss falls below a set floor. This replaces the fixed n floors (10 to HOLD, 30 to decide).
3. **Screen in two stages.** Run 10 pages on every plausible configuration. Then run 30 paired books on the top two or three. This is successive halving: cheap rounds prune the space.
4. **Pair.** Every configuration in a test reads the same books and pages, which removes the book-to-book variance (ICC 0.38).
5. **Confirm (V4).** The winner is re-run on fresh books before its routing row ships, to guard against the winner's curse.
6. **Explore with production traffic (V6).** Each month, a small share of a cell's pages goes to the runner-up. This catches a changed optimum when a model updates.

## Statistical methods

**Today (`build.py`).**
- **Model:** a Beta-binomial on accepted k of n per cell × route. n is scaled to books (effective n).
- **Prior:** v1/v2 means on 24 routes and flat on 230, worth 7 pages.
- **Gate:** P(acc_route ≥ acc_bar − 0.08) ≥ 0.9. The bar is the best measured Opus route (print), or the best measured route (manuscript).
- **Wrong-text bar:** relative, the best route + 2 points.
- **Pick:** the lowest median expected dollars per accepted page among the routes that pass.
- **Defect rule** (since 10-31): MQM-weighted defects per 1,000 words where measured, with acceptance as a floor. It decides about 3 of 109 cells.

**Planned.**
- **Prior mean from a partially pooled logit:** engine + draft + language + writing system + print/manuscript, no interaction. It is worth about 5 pages: V1 measured 5.2–6.4 held out (PR #7878).
- **Judge correction.** Per stratum, the judge's sensitivity and specificity, measured on gold (V2, PR #7880), correct k/n through prediction-powered inference.
  - Calibrate on real reads, not only planted errors: the two corrected k/n in opposite directions in #7880.
- **Multiplicity.** Decide by the joint posterior probability that the pick is within the margin of the true best, over all candidates. Do not run independent per-route gates. Check the rule by simulation at real n and route count (V3): false switch ≤ 5% per decision.
- **The unit is the book.** One page per book for cell rates. 5 pages per book for book-level claims (reliability 0.75 at ICC 0.38). A book random effect when pages share books.
- **Loss.** Expected cost + λ × expected wrong text, with λ stated. This replaces the hand-set margins once λ is agreed.
- **Report** intervals, n in books, and dates. Never a bare rate.

## Measurement considerations

- **The judge is the instrument, and it is imperfect.**
  - Print: sensitivity 0.82, specificity 0.85, κ 0.64. Latin and German are weaker.
  - Manuscripts: κ 0.29, and self-preference +0.43 on Opus-written text (#7880).
  - Opus-written manuscript routes cannot win on the Opus judge alone. A non-Claude second judge is needed.
  - Recalibrate on a fixed gold set monthly, because judge models update.
- **One outcome, one definition.** Four verdict scales are pooled as "accepted" today. Fix one primary outcome (accept against the image, fixed rubric) and one secondary (defects per 1,000 words). Never mix scales inside a k/n.
- **Gold has limits.**
  - CHURRO-DS is research-only, and its languages and documents are not ours (domain shift).
  - Planted errors are synthetic and calibrate differently from real ones.
  - Use both, and report which.
- **Agreement is not accuracy.** Two models agreeing is evidence, not truth (`.claude/docs/eval-design.md`). Run the A-vs-A noise floor before reading a small difference.
- **Memorization.** Canonical texts score higher because models recite them (`paper/reading-or-reciting-chr2027.md`). Exclude or stratify famous passages in tests.
- **Test frame vs served frame.**
  - A pilot's pages may not look like the cell's waiting pages. Draw tests from the waiting pages.
  - Study frames (Paddle dice < 0.90, English pre-1800) are applied to every page of a lane: say so.
- **Provenance.**
  - 85% of pages record no prompt, so their configuration cannot be identified. Every writer stamps engine, prompt, read mode and lane (#7389).
  - Evidence without a stamp is not counted.
- **Cost measurement.**
  - Subscription quota is priced at its share of the fee. Counting idle quota as $0 is a scheduling rule, not a saving.
  - Meter readings jump minute to minute: read them hours apart.
  - Pages per call changes cost per page and must be part of the configuration.
- **Failures count.** Refusals, format failures and empty reads are outcomes of the configuration (cost per *usable* page), not missing data.
- **Drift.** Preview models and prompts change silently. Date-weight evidence, and expire it when the engine version changes.

## Decisions (Derek, 2026-11-01: "defaults")

What the optimum is:
1. **A wrong page is priced.** Loss = cost per page + λ × P(wrong text), with λ = 20 × the cost of a good read (about $0.02 a page at current prices). It replaces the hand-set margins (8 points; best route + 2% wrong text) once the build job's joint gate lands.
2. **An absolute bar as well as a relative one.** A route must reach ≥ 90% of pages accepted against the image, not only come close to the best route in its cell. A cell where no route clears it is flagged for a new engine or prompt, not routed.
3. **The outcome is severe defects per 1,000 words** (Derek, 2026-11-01). A defect is severe when it changes what the English translation would say: a wrong word, name or number that changes the sense; invented text; another leaf's text; a missing line. Spelling variants, abbreviations, long s, punctuation and line breaks do not count, as long as the translation's meaning survives. Where a typed reference exists, test this directly: translate the machine read and the reference with the same model, then compare the two English texts for meaning. Elsewhere, the judge's MQM `misleads` + `wrong_text` classes stand in. Report per book and weighted by reads, judge-corrected. Page acceptance is the instrument that decides a cell; it is not the goal.

What a route costs:

4. **Subscription quota is priced** at fee × the share of quota used, never $0.

What it may do on its own:

5. **A switch that passes V4 ships by itself** and is logged. A switch that adds a paid lane, a new cron or spend above the floor comes to Derek.
6. **A standing R&D allowance**: about 10% of subscription quota a month plus at most $10 of paid flash-lite, spent by value of information (the cells with the most pages riding on the answer).

Scope:

7. **OCR first, then translation**, through the same machinery.
8. **Manuscripts get a second, non-Claude judge** (Gemini on the CLI) before an Opus-written route can win. Manuscript cells stay on HOLD until V2 passes there.

### How far to trust the 43%

#7866 found "43% of live OCR'd books bad (36–51%)". /quality states it as "57% of books passed" (PR #7885). Derek doubted it (2026-11-01). Its error can run either way, and nothing yet says which way:
- **The judge raises false alarms.** On CHURRO pages under 1 wrong character in 100, Opus accepted 82%, so it flagged 18% of near-clean texts (#7880). At that rate a clean book is called bad (≥ 2 of 5 pages flagged) about 22% of the time.
- **The judge also misses errors.** On real machine reads over that line, it turned down only 38% (18–61%). So many bad pages pass. This is why /quality says the pass figure is "more likely too high than too low".
- **The two bars differ.** V2 calibrated at 1% CER; #7866's "bad" is "not accepted, or any wrong-text span". Neither correction can simply be applied to the other. The honest range is wider than the printed CI, which covers sampling only.
- **It counts books, not reading.** One Chinese lane (`zh-paddle-dice-lt090`, 11,049 volumes) is 23% of the frame, and 29 of the 71 bad books are Chinese. A volume nobody opens weighs the same as a book read daily.
- **It is the transcription, not the English.**

What holds regardless:
- The bad books are mostly badly wrong, not marginal. Only 18 of the 71 sit at exactly 2 of 5 pages, and the median is 135 MQM points per 1,000 words.
- The ranking results (AUC 0.66, ICC 0.38) do not depend on where the bar sits.

To settle the number, calibrate the judge at #7866's own bar, on real reads with a typed reference: the PPI step under "Statistical methods". Use about 100 pages, split across print and manuscript.

**A human baseline.** Human-typed editions (DTA, Wikisource, EEBO-TCP, CHURRO's transcriptions) get the same judge against the same images, about 60 pages. A flag on human text is either a real typist or edition error or a judge false alarm. Each flag is adjudicated: a second Opus pass on the cropped span, plus Gemini. That yields two numbers:
- the human severe-defect rate, the honest comparator for "is machine text good enough?";
- the judge's false-alarm rate on near-clean text.

Job `router-defaults-calib-7263` runs both. Until it lands, V7 reports the figure with this caveat, and the read-weighted version beside it.

## Words used here

- **Cell**: the kind of page, language × engine already stored × script (print, manuscript, unknown).
- **Route**: one way to produce the text, engine × prompt × read mode × correction chain × pages per call × channel.
- **Accepted**: Opus, with the page image, says the text is a faithful transcription under the fixed rubric. One scale; the four older verdict scales are mapped onto it, not pooled.
- **Wrong text**: a span that is not on the page (invented, another leaf, a wrong reading that changes meaning).
- **Decided**: the gate says one route is the cheapest adequate one for the cell. **HOLD**: not enough evidence. **Switch**: decided, and the winner differs from what production runs.
- **Served**: what production actually stores and shows, as opposed to a test read.

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
| V7 | Is the whole library getting better? | The served-quality draw of #7866 (5 pages a book, stratified), monthly | judge-corrected severe defects per 1,000 words fall, set against the human-typed baseline; both reported raw and read-weighted (see "Decisions") | the outcome |

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
