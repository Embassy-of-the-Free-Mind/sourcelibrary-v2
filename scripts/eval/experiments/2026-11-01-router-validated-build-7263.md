---
stage: ocr
measure: none
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "The router's decision rule failed V3: at each cell's real n and candidate count, with every candidate truly 0.09 below the bar, it picked one of them in up to 45% of a cell's decisions (15 of 43 decidable cells over 5%, mean 9.6%). Two causes: no multiplicity control over the K candidates, and, where no Opus bar is measured, a reference chosen by the same draws it is compared with. Bonferroni or Šidák by K (10 to 13 cells still over 5%) and a joint-set rule (14 to 15) fix only the first. Gating each pickable route against the draw-by-draw maximum of the reference routes at 1 - 0.03 / K fixes both: worst cell 3.6%, mean 0.5%, every cell under 5%. The price is power: P(picking a candidate that truly ties the bar) falls from 0.155 to 0.052 averaged over cells. With V1 (the #7878 pooled prior, worth 5 pages, for all 355 routes) and V2 (an Opus-written route cannot win in a stratum where the judge prefers Opus text) the rebuilt table changes 12 cell decisions against 2026-10-31-correction-pass-7818: 4 from evidence pooled since, 6 from V1, 1 from V2, 3 from V3 (one of those then held by V2)."
status: adopted
decision: "rules.json: prior.pooled in force (worth 5 pages), judge_validity in force (#7880 strata), switch.multiplicity = max-bonferroni alpha 0.03. current.json moves to 2026-11-01-validated-7263, with latin-blank/print and german-blank/print kept on 7818 (evidence changes nobody decided) and Derek's two #7853 cells unchanged. The routing tables in scripts/lib/ are untouched (PR #7888)."
superseded_by: null
issue: [7263, 7878, 7880, 6740]
router_evidence: "none — no page judged; changes the prior and the decision rule over the evidence already in rules.json"
defect_rates: "none — no page was judged for defects"
---
## 2026-11-01 · Can the router's decisions be trusted? Pooled prior (V1), a judge-validity gate (V2) and the decision rule's error rate (V3) (#7263)

Part of #7263. This is the build-fix job of the R&D plan of 2026-11-01. The pass bars come from `.claude/docs/router-optimization-paper.md` (PR #7883). V1 rests on #7878 (`2026-11-01-hierarchical-heldout-7263.md`) and V2 on #7880 (`2026-11-01-judge-calibration-churro-7263.md`). The problems come from the stats audit on #7263 (2026-11-01).

No DB writes, no paid API, no model calls. `scripts/lib/*-routing-table.json` is untouched: the router stays advisory, and this moves recommendations, not pages.

PRIOR ART:
- `scripts/eval/estimator/heldout/` (#7878): `Design`, `fit_hyper`, `fit`, `predict` and `factors.py` are imported unchanged by `router-table/pooled_prior.py`.
- `router-table/fit_prior.py` fits the v1/v2 prior. It is kept, because that prior is now the table's sensitivity (`prior_model` still carries it, so `fit_prior.py` and `heldout.py`'s "table" baseline keep working).
- The audit's hand simulation (one route at n = 30 at the margin passes about 15%; one of six, 49%). It committed no code. `v3_sim.py` imports `build.decide()` and `build.gate()` rather than re-implementing them.
- `build.py --before` and `lane-judge-sampler.mjs rebuild()` list changed decisions. Both compare whole decision strings, so a `(k/n: why)` label change reads as a flip (56 of them on 2026-11-01). Neither attributes a change to a step. `router-table/decision_diff.py` compares class + route and walks a chain of attribution builds.

### 1. What changed in `scripts/eval/estimator/router-table/`

**V1, the prior.** Every route's prior mean is now the partially pooled logit of #7878: engine + draft + language + writing system + script type, with no engine × script interaction (#7878 found no support for one).
- `pooled_prior.py` fits it on the table's tested routes (258 routes, book-scaled eff k of n, as #7878). It takes the hyperparameters from the full fit, then predicts each route with its whole base cell left out.
- So a cell's own evidence enters the posterior once, and the mean is exactly the prediction #7878 scored held out.
- The prior is worth 5 pages (`rules.json prior.pooled`). That is #7878's recommendation: 5.2 for a new language, 5.5 for a new base cell, 6.4 for a new script split.
- Before, 314 of 355 routes had a flat Beta(1, 1) prior; now all 355 have a pooled mean. The v1/v2 prior (worth 7) is kept as the table's "other prior" sensitivity.
- `pooled-prior-2026-11-01.json` holds the means. A route the file does not name gets the flat prior and a WARNING.
- Refit after a backfill: `pooled_prior.py <table>.json --out <file>`. The evidence counts do not depend on the prior, so one build is enough to refit from.

**V2, the judge-validity gate** (`build.judge_gate`, `rules.json judge_validity`).
- `judge_validity` stores #7880's per-stratum sensitivity, specificity, κ and DBG with 95% intervals: print, manuscript, and per language.
- Where a stratum's DBG interval excludes 0 (`ocr/manuscript`: +0.43, +0.20 to +0.66), a route written on the judge family's channel (claude) cannot win keep or switch. Its decision becomes **HOLD (judge not valid: self-preference)**.
- The exception is a judge of another family clearing the route: `second_judges` holds that judge's k/n, and the route must reach P(acc ≥ 0.8) ≥ 0.9. The list is empty today.
- Print passes (DBG −0.02, −0.18 to +0.12).
- `ocr/unknown` and every translation stratum are **unmeasured**. They are shown as such and do not hold. #7880 drew print and manuscript OCR only, and the old −0.11 to −0.13 translation figure has no gold.
- V2's accuracy bar (sensitivity and specificity ≥ 0.85) is not met on print either (sensitivity 0.82). It is stored, not gated.

**V3, the decision rule** (`build.gate`, `rules.json switch.multiplicity`): section 2.

**The audit's two latent crashes.**
- `pool_sources()`, the evidence pooling, moved to module level so it can be tested. It now drops a source with no judged pages, which used to raise ZeroDivisionError in the book scaling. A route whose sources scale to 0 books is untested.
- `usd_per_page()` prices a paid stage with `api_usd: None` at infinity, so the route can never be the cheapest. It used to raise TypeError.

**Tests** (`test_pick.py`: 28 pass, 16 before). New ones cover:
- the two crashes;
- V2: manuscript Opus keep and switch hold; print, unknown, translation, non-Claude writers and UNTESTED do not; a second judge of another family clears the route, and a Claude second judge does not;
- V3: `gate_p`; K candidates need more evidence than one; with no bar, a 5-page route is no longer its own reference; and a `v3_sim` run (six candidates at n = 30 on the boundary: over 10% under the old rule, ≤ 5% under the new one).

`tests/unit/router-binding-7809.test.ts` passes 19/19 with the moved pointer.

**Attribution.** `build.py --off v1,v2,v3` turns steps off for the attribution builds; `--out-dir` writes them outside the repo. With all three off the build reproduces main's decisions in every cell (checked).

### 2. V3: the simulation, and the rule it chose

`v3_sim.py` runs `build.decide()` itself, in every cell the k/n rule can decide (43). Each route keeps:
- its real book-scaled n;
- its prior;
- its price (stages + page sizes at the default plan fee, in memory only);
- whether it is the bar.

Each replicate draws k ~ Binomial(n, p_true) and forms the posteriors. Wrong text is set to 0, so the wrong-text gate passes everyone (least favourable). 1,000 replicates, 2,000 draws.

The true rates:
- **Boundary.** The reference at its posterior mean (clipped to 0.5–0.97); every candidate 0.08 + 0.01 below it. Any pick the gate passes is a false pick. This is the V3 number.
- **Estimates.** The table's posterior means taken as the truth.
- **Power.** The cheapest candidate truly equal to the reference, the others at the boundary.

A false pick is a route the GATE passed and the rule then picked, keep or switch. The fallback (nothing passes, so keep the current route) is not counted as a pick.

| rule | worst cell | mean over cells | cells over 5% | false pick at the estimates | power |
|---|---|---|---|---|---|
| **before**: P ≥ 0.9 against the best by mean | 45.1% | 9.6% | 15 | 1.5% | 0.155 |
| Bonferroni, P ≥ 1 − α/K, α 0.10 / 0.05 / 0.03 / 0.02 | 44.1% | 6.7 / 6.0 / 5.8 / 5.7% | 13 / 11 / 10 / 10 | 1.2% | 0.10–0.08 |
| Šidák, α 0.05 / 0.03 | 44.1% | 6.0 / 5.8% | 11 / 10 | 1.2% | 0.09 / 0.08 |
| joint set: the largest S with P(all of S within) ≥ 1 − α, α 0.10 to 0.02 | 45.1–44.1% | 9.6–6.6% | 15–14 | 1.2–1.4% | 0.15–0.10 |
| max-bonferroni α 0.10 | 18.2% | 1.9% | 6 | 0.2% | 0.082 |
| max-bonferroni α 0.05 | 5.9% | 0.9% | 2 | 0.1% | 0.063 |
| **max-bonferroni α 0.03 (in force)** | **3.6%** | **0.5%** | **0** | 0.1% | 0.052 |
| max-bonferroni α 0.02 / 0.01 | 2.1 / 1.3% | 0.4 / 0.2% | 0 | 0.0% | 0.045 / 0.036 |

**Where the old rule failed** (boundary rate, K):
- german-blank 45%, K 9; german-blank-fraktur 44%, K 7; latin-blank 43%, K 6; english-gpu-7263 39%, K 7;
- latin-lite/print 36%, K 4; german-blank-antiqua 35%; french-blank 33%; german-gpu-7263 32%; latin-gpu-7263 29%;
- french-gpu-7263 17%; italian-gpu-7263 16%; german-lite/print 14%; french-lite/print 7%; tibetan-yigdzin/manuscript 7%; tibetan-tr/manuscript 6%.

**Why the K-adjusted p was not enough.** The worst cells (the `*-blank`, the GPU cells and the manuscripts) have no measured Opus bar. There the reference is the route with the best posterior MEAN, and it passes against itself.
- A bad route with a lucky draw becomes the reference, and then it is "within the margin" of itself on 5 pages.
- Lowering the per-candidate p cannot touch that.
- **max-bonferroni** gates every route that can be picked, including the best by mean, against the draw-by-draw maximum of the reference set: the Opus bar routes where measured, else every other measured route. The threshold is 1 − α / K.
- Where one Opus route is the bar, this is the old pairwise test at a K-adjusted p, and paired evidence is still used.

**Why α = 0.03.** It is the largest α with every cell at or under 5%. At 0.05, french-blank (5.9%) and latin-lite/print (5.1%) are just over.

**Per cell**, under the rule in force: the `V3` section at the end of `2026-11-01-validated-7263.md`, and `rows[].v3` in its `.json`. Every cell passes.

**What it costs.** A tie must now be shown, not assumed.
- italian-gpu-7263/print has four routes at 30/30 to 39/40 and no Opus arm. A 30/30 route reaches P = 0.9931 against the per-draw best of its peers, short of 1 − 0.03/5 = 0.994. Nothing passes, and the cell falls back to keeping `lite`.
- At n ≈ 30 a route and five candidates, a no-bar cell cannot decide. It needs roughly 50 or more books a route, or a paired design (#7701), which is far tighter.
- Power stays high where n is large and the bar is Opus: german-lite/print 0.90, latin-lite/print 0.46.

**Caveats.**
- Paired evidence is simulated as independent. For a route that truly ties, paired draws are tighter, so a paired cell's real false-pick rate is at most this.
- The boundary is the least favourable case for one gap. It is not the sup over every mix of gaps.
- The **defect rule** (decision_rule; it decides 5 cells now: the k/n rule reaches keep/switch and the defect rule overrides) has its own acceptance floor at P ≥ 0.5 within 0.05. That floor is NOT multiplicity-controlled, and V3 does not cover it. Its notion of a wrong pick (more defects per word, not lower acceptance) needs its own simulation.

### 3. The decision diff against 2026-10-31-correction-pass-7818

`decision_diff.py 2026-10-31-correction-pass-7818.json evidence=<main, V1-V3 off> V1=<+V1> V2=<+V2> V3=2026-11-01-validated-7263.json`

12 cells change decision; 4 more change only the candidate a HOLD names.

| cell | pages waiting | 10-31 | now | why |
|---|---|---|---|---|
| tibetan-yigdzin/manuscript | 272,550 | switch yigdzin>agy-flash-low | **HOLD** (judge not valid) → yigdzin>opus | **V3, then V2.** agy 53/59 against Opus 51/59, no bar in a manuscript cell. Against the per-draw best of the other two, neither clears 1 − 0.03/2, so the rule falls back to keep the current yigdzin>opus. V2 then refuses to keep an Opus route on a judge that prefers Opus manuscript text by +0.43. |
| french-lite/print | 143,663 | HOLD → lite>agy-flash-low | keep lite>opus | **evidence**, then **V3**. #7853's read@4 55/60 made it switch to agy-flash-low@4-read. Against lite>opus (299/307) at 1 − 0.03/3 it does not clear the gate. **The live pointer is not moved**: current.json keeps this cell on Derek's #7853 decision (2026-11-01-reread-7853). |
| german-tr-flash3/unknown | 98,795 | HOLD → flash3 | keep flash3 | **V1.** opus-cli 12/13 under its pooled prior (0.83, 5 pages) clears the HOLD bar (p80 0.90). No agy route clears the Opus gate, so the designed fallback applies: keep the served route. |
| sanskrit-lite/print | 36,624 | HOLD → agy-flash-low-read | keep lite | **V1.** lite>opus 224/250 (10 books) with its pooled prior (0.93) reaches p80 0.91. Nothing else clears the gate, so it keeps the served lite. See section 5: `keep` here means "no cheaper route clears the Opus bar", not "lite is good" (42/250). |
| german-tr-lite/unknown | 13,760 | HOLD → flash-lite | keep flash-lite | **V1**, as german-tr-flash3/unknown (opus-cli 12/13, p80 0.91). |
| russian-lite/unknown | 0 | switch agy-flash-low-read | HOLD | **V1.** 11/11 against a pooled prior of 0.59 (Cyrillic agy reads, 5 pages): p80 0.82 < 0.9. The audit's "russian-lite on 11/11" thin switch. |
| english-gpu-7263/print | 0 | switch gpu-glm>agy-flash-low | switch gpu2>agy-flash-low+diff | **V1.** Two routes at k = n (45/45, 55/55) and nearly the same price. The prior moves the median acceptance that divides the price. |
| italian-gpu-7263/print | 0 | switch gpu2>agy-flash-low+diff | keep lite | **V1** (gpu>agy-flash-low instead), then **V3**: four routes at 30/30 to 39/40, no Opus arm. None clears 1 − 0.03/5 against the per-draw best of the others (30/30 reaches 0.9931 against 0.994), so it keeps the current route, which is untested here. |
| zh-6561-served/manuscript | 0 | keep paddle>opus | **HOLD** (judge not valid) | **V2.** paddle>opus 17/18, Opus-written, in a manuscript cell. |
| latin-blank/print | 0 | switch pero>agy-flash-low-written | HOLD (defects: the pick moves with the misleads weight) | **evidence** since 10-31. Not V1–V3, and kept on 7818 in current.json. |
| german-blank/print | 0 | keep agy-flash-low@4-written | HOLD (defects: the pick moves with the misleads weight) | **evidence** since 10-31. Not V1–V3, and kept on 7818 in current.json. |
| zh-paddle-dice-lt090/unknown | 0 | (no row) | HOLD → paddle | **evidence**: a new script split. |
| arabic-flash3/unknown, hindi-lite/print, german-blank-antiqua/print, german-blank-fraktur/print | 9,073 / 65 / 0 / 0 | HOLD | HOLD | V1 changes which candidate the HOLD names (german-blank-fraktur first by evidence). |

**By step:**
- V1 moves 6 decisions;
- V2 moves 1, plus the hold on tibetan-yigdzin after V3;
- V3 moves 3;
- evidence moves 4.

**Overall:** decided cells go from 17 (7 keep, 10 switch) to 16 (10 keep, 6 switch). Pages under a keep/switch decision go from 1.66M to 1.68M.

**Under the old v1/v2 prior** (the table's sensitivity) 11 cells decide otherwise; they are listed in the table's prior paragraph.

### 4. current.json

`table` → `2026-11-01-validated-7263`. In `cells`:
- latin-blank/print and german-blank/print stay on 7818. Their change comes from evidence pooled since 10-31, under the defect rule, and V1–V3 do not move them. The 2026-11-01 note on #7853 already said nobody decided them.
- french-lite/print and german-lite/print stay on Derek's #7853 table.

The waivers are unchanged.

`scripts/audit/router-binding.mjs --crontab=infrastructure/gex45-crontab`, before and after: every served cell keeps its status (OK / UNDECIDED / waived). The list of decided cells no cron line serves grows from 3 to 5:
- tibetan-yigdzin/manuscript leaves it (now HOLD);
- german-tr-flash3/unknown, german-tr-lite/unknown and sanskrit-lite/print join it (fallback keeps).

### 5. Not done here, and why

- **`keep` as a fallback.** "None qualifies: keep" is the rule Derek set on 2026-10-28 (keep the served route when no agy / GPU route clears the Opus bar). With V1 it now names routes far below the bar: sanskrit-lite/print keeps lite at 42/250, and italian-gpu-7263 keeps an untested lite. A label such as `keep (fallback: no candidate clears the gate)` would stop a reader taking it as an endorsement. It changes a label `router-binding.mjs` reads, so it is a separate PR.
- **The defect rule's multiplicity** (section 2).
- **V2 beyond self-preference.** It needs judge correction (paper step 2, PPI) and calibration on translation and unknown-script pages. #7880 showed that one sensitivity/specificity pair does not transfer.
- **A second, non-Claude judge** on the manuscript cells, so an Opus-written manuscript route can be decided at all. That cell of work is #7809.

### Reproduce

```
RT=scripts/eval/estimator/router-table
python3 $RT/build.py --name 2026-11-01-validated-7263 --before $RT/2026-10-31-correction-pass-7818.json
python3 $RT/pooled_prior.py $RT/2026-11-01-validated-7263.json --out $RT/pooled-prior-2026-11-01.json
python3 $RT/v3_sim.py $RT/2026-11-01-validated-7263.json --variants in_force --reps 1000 --draws 2000 --annotate
python3 $RT/v3_sim.py <a V1+V2 build> --reps 1000 --draws 2000          # every rule variant (section 2), about 11 min at 10 procs
for s in "v1,v2,v3" "v2,v3" "v3"; do python3 $RT/build.py --name off-${s//,/-} --off $s --out-dir /tmp; done
python3 $RT/decision_diff.py $RT/2026-10-31-correction-pass-7818.json evidence=/tmp/off-v1-v2-v3.json V1=/tmp/off-v2-v3.json V2=/tmp/off-v3.json V3=$RT/2026-11-01-validated-7263.json --md
python3 -m unittest scripts/eval/estimator/router-table/test_pick.py
```
