---
stage: ocr
measure: [judged, accuracy]
languages: [la, lzh, bo, de, grc, ar, he, en, fr, it, nah, es]
scripts: [Latn, Hani, Tibt, Grek, Arab, Hebr]
canons: []
n_books: null
n_pages: null
verdict: "Correction is now a stage of a route: pages made worse and made better per draft engine x corrector x language x page kind, from 115 committed counts in 13 experiments. With Opus as the assumed reference (Derek, 2026-10-25), no cheaper corrector yet matches Opus at P >= 0.9 in any of 13 cells, so every cell routes to Opus and the free half of four Claude accounts binds: 78 weeks for lite Latin, 104-130 for Chinese and Tibetan, while agy sits idle for correction. Eleven 30-page tests (0.04 account-weeks + 330 agy calls) would decide whether agy can take part: if they confirm, lite Latin drains in 43 weeks and Tibetan in 21. Held out one experiment at a time, the correction rows land inside their 90% interval 87/99 times but re-reads 2/12. A prompt x language-family term fixes v1's #4780 miss (0/6 -> 12/12 languages covered). NUTS widens v1's accuracy intervals by 1.29x (median) and leaves did-not-read unchanged (0.95x)."
status: informational
decision: "Proposals only: allocation and proposed routing rows in scripts/eval/estimator/chain/results/ for #7170; #5924, #6560 and #6561/#6871 answered in capacity terms below (#6740)"
superseded_by: null
issue: [6740, 7263, 7170, 5924, 6560, 6561, 6871, 4763, 4780]
---
## 2026-10-25 · Estimator v2: chained routes (draft → corrector → translator) routed on quality, cost and time (#6740)

PRIOR ART: `2026-10-24-ocr-estimator-v1-cost-per-usable-page-6740.md` (§3a per cell: cheapest measured route clearing
the bar; its two stated gaps, capacity not modelled and reads only, are what this closes);
`scripts/eval/estimator/ocr/failures_v0.py` (made-worse rates per route string × script, no draft engine, no pages made
better); `planner/planner_v0.py` (capacity only as a filter: an engine whose subscription cannot carry a language's whole
queue is dropped, which is how Opus fell out of Chinese, #7357); `routing/derive_routes.py` ("correction lanes are not
routed by a table"); #7263 (the plan: the capacity term, correction as a stage). Design:
`.claude/docs/quality-research-system.md` §3a, §4, §6. No model calls; $0; CPU only (this box, and gex45's CPU pinned
off the GPU job's cores).

**Inbox notes acted on.**

| time (Z) | note | what it changed |
|---|---|---|
| 20:39 | A: #4780 prompt × language family | §8 |
| 20:39 | B: NUTS against SVI for v1 | §9 |
| 20:39 | C: every unrouted cell with its smallest gate test | §6 |
| 21:07 | D: route-census-6740 rows | §10 |
| 22:19 | **Override** (Derek, 21:20Z: "I don't even believe in the judge family effect. Assume Opus is ok; we are mostly looking for enhanced cost") | the router objective is now the cheapest route a reader would accept as matching Opus; Opus is the fallback in every cell; the judge-family term and Gemini-judged rows do not move routing; route-judge-6740's qualitative rates are an outcome where they land (none had landed: §10). §3–§7 are the post-override routing |

### What was built (`scripts/eval/estimator/chain/`)

- **Evidence, in the existing format.** `add_correction_rows.py` adds 91 k-of-n rows to
  `ocr/failure-observations.jsonl` and tags its 26 correction rows with the cell keys (`draft`, `corrector`,
  `language`, `kind`, `instrument`, `experiment`). Two new rates beside `made_worse`: `made_better` and `misleading`
  (the #5924 reader rule). Per-language splits of a pooled row carry `subset_of`, and judges v0 has no catch rate for
  carry `chain_only`; `failures_v0.py` skips both, so no page is counted twice there.
  - Sources: #6694 q300 (by language), #6561 and #6667 (Chinese table / ordinary / disagree pages; Opus, Sonnet, Haiku,
    Pro, Flash high, Opus re-read), the Siku pilot (v1 and v2 prompts, v2 held out), #6560's four Tibetan files (30
    folios each, plus both 435-page gate audits), #7258 and #7269 (Latin lite: Opus correction, Flash-low correction,
    Flash re-read, the second-family judge), #7275 (lite as corrector, both prompts, no-image control) and the
    Florentine gate on #6865 (30 better / 0 worse).
  - **#6694's counts are over changed pages** (196 judged; B changed 809 of 976). An unchanged page is neither better
    nor worse, so its n is scaled to all pages (n / 0.829), as the other counts are.
- **`chain_v2.py`, the model.** Per rate r and cell (draft, corrector, language, kind):
  `logit p = mu[r] + corrector[r] (within family) + language[r] + kind[r] + draft[r] + cell[r]`.

  What is observed is p seen through an **instrument offset**: the blind judge reading with the image is the reference;
  the others are a score against a reference text, the Opus span audit against the leaf with tiles, the same without
  tiles, and by eye. Pages of one book move together, entered with design effect 1 + (m − 1) × 0.1. Two fits:
  - **The model check** (all rows, plus a same-family judge term): 115 rows, 49 cells. NUTS, 4 × 1,000 draws,
    0 divergences, R-hat ≤ 1.004.
  - **The routing fit** (`--opus-reference`, after the override): the 9 Gemini-judged rows are left out (they stay in
    the file as data), and there is no judge-family term, so "blind judge" means an Opus reader. 106 rows; 0
    divergences, R-hat ≤ 1.004, in-sample PPC 106/106.
- **`capacity.json` and `cells.json`.** Channel capacities from the meters, and each stage's draw per page. The cells
  each carry a census selector, the route a page waits on, the candidate correctors and the gate instrument.
- **`volumes-by-draft.mjs`.** A read-only census: pages per live book × stored `ocr.model`, plus the Kanripo screen and
  the guarded-Paddle frame for Chinese. Nine languages, 109K book × bucket rows. The summary is
  `results/census-by-draft-2026-10-25.json`.
- **`allocate_v2.py`, the router and the allocation.**
  - **Per cell:** the cheapest route that **matches Opus**, else Opus. A route matches Opus when its net gain is within
    max(0.05, 10% of Opus's) of Opus's, in ≥ 90% of draws.
  - **The candidates:** each corrector, and "serve the draft". The draft costs nothing and matches Opus where Opus
    gains little.
  - **Price:** share of the channel's free week per page.
  - **Allocation:** a linear programme (scipy HiGHS) over each channel's free week, valued by read weight × net gain
    per unit of capacity. It runs over horizons of 1 to 260 weeks. The planner's tests are reserved from the same budget.

**The common unit.** Net pages improved per corrected page = P(better) − 2 × P(worse), both as the cell's gate
instrument sees them:
- Opus reader for Latin and the stored-text cells;
- Opus span audit with tiles for Tibetan;
- Kanripo score for Chinese.

A page made worse counts double: readers already trusted it, and nothing flags the change. Weights 1 and 4 are in the
sensitivity table. Net gain counts pages, not degree: a 0.5-point CER fix in Chinese counts the same as a restored
negation in Latin.

### 1. The model check: what the correction evidence supports

| term (full fit) | posterior median [90%] (logit) | reading |
|---|---|---|
| same-family judge, made worse | −1.44 [−2.46, −0.54] | Opus 1/196 vs Gemini 9/196 on the same #6694 pages; Opus 1/250 vs Gemini 3/59 on #7258. **Not used for routing (override).** |
| leaf audit with tiles, made worse | +1.01 [−0.25, +2.25] | the #6560 gate's Opus audit sees more damage than identity against Derge: Flash low 0/30 by identity, 10/40 by audit |
| score against a reference, made worse | +0.35 [−0.75, +1.35] | not separable from a blind judge: no cell has both |
| corrector spread τ (made worse) | 1.00 [0.34, 1.80] | correctors differ a lot, even inside a family (Opus against Haiku) |
| cell spread τ (made worse) | 1.11 [0.84, 1.44] | after corrector, language, kind and draft, cells still differ about 3× in odds: a new cell is not predictable from its parts |

**Held out one experiment at a time** (`results/chain-v2-loeo.json`; fit on the other 12, predict its rows):

| | rows inside the 90% predictive interval |
|---|---|
| all | **93 / 115** (log score −392, against −1,110 for the pooled average) |
| correction, made worse | 50 / 54 |
| correction, made better | 37 / 45 |
| **re-read replacing the draft** | **2 / 12** |

- **Re-reads do not transfer.**
  - With #6560 held out, the model predicts Opus re-reading a Yigdzin folio is worse 5% of the time; it was 27 of 30.
  - With #7258 held out, it predicts the Flash re-read of lite Latin worse 71% of the time; it was 7 of 250.
  - Whether a re-read helps depends on how good the draft was, and no term carries draft quality. **Route a re-read
    only on its own cell's measurement.**
- **Chinese tables are not predictable from other kinds.** With #6561 held out, Opus correcting a table page is
  predicted worse on 39% of pages, against 1 of 40 observed.
- **The Tibetan gate is still a miss.** Flash low's 10/40 at the leaf audit is predicted at 1%, even with G4L's gate in
  training. A new instrument on new pages has to be measured, as v1 found for #4763.

**Simulation from known effects** (`results/chain-v2-sim.json`). The full fit's posterior medians were taken as the
truth. Counts were simulated at the evidence's own design, the model refit, 8 times over.
- The 90% intervals covered the true cell rate 92.6% of the time on average, over 100 cells a replicate (0.77–1.00).
- The median absolute error was 0.03–0.08 in rate.
- The instrument offsets were covered in 7–8 of 8 replicates each.

### 2. Capacity: the meters

| channel | weekly capacity | free share | basis |
|---|---|---|---|
| Claude | 4 accounts | 0.5 → **2 account-weeks** | climits 2026-10-25T20:30Z: team@ 86%, dereklomas@ 51%, derek@sourcelibrary 64%; derek@playpowerlabs unreadable (refresh token invalid) |
| agy | **78,116 calls** | 0.5 → 39,058 | main's meter, 7 days before the 2026-10-19 lock (a lower bound: main only). Second reading 53,478/week (v1, calls.csv 10-13..10-24). Not re-read: this box cannot reach main |
| GPU (gex45) | 168 card-hours | 0.5 | no correction route draws it: the drafts exist |
| Batch | $35 (dial $5/day) | 1.0 | `set-dial.mjs --show`; envelopes add $18–24/day (spend_daily, last 7/14 days) |

| stage | draw per page | basis |
|---|---|---|
| Opus correct, 10 pages a call (`correct.mjs`) | 4.0 × 10⁻⁵ account-week (range 2.0–6.1) | 1% per 250 Latin pages (#7258); the range is its 9–27 account-weeks for 444K pages |
| Opus correct, 1 page a call (#6561 harness) | 9.0 × 10⁻⁵ | 0.9% per 100 pages, an upper bound on a shared account (#6667) |
| agy corrector | 1.02 calls | #7269 |
| Opus translation, 10 pages a call | 9.2 × 10⁻⁶ | 3% per 3,250 pages (#7263). zh-translate-route-6871 reads up to 4 × 10⁻⁵ (weekly 7% → 12% for about 1,200 pages, on an account shared with this job's session): an upper bound, too shared to use |

- **Retranslation.** A corrected page that has English needs retranslation. That draw is added for the cell's
  translated share (Latin 0.875; the #6871 frame 1.0).
- **Production throughput is far below capacity** (route-census-6740 `capacity.json`, 60 days to 2026-10-24):
  - Opus OCR wrote 32,526 pages (busiest day 11,843);
  - Opus translation wrote 22,722 pages;
  - agy Flash-low translation wrote 88,320 pages.
- **Opus correction vs agy, per free week.** At 10 pages a call, Opus correction costs less of the free week per page
  than an agy one-page-a-call corrector: 1/41,600 against 1/38,300 before retranslation, and 1/33,000 with it.
  Batching makes Claude the cheaper channel per page.

### 3. Allocation: per cell (`results/allocation-v2.md`)

| cell | pages waiting (read-weighted) | route | net gain / page [90%] | P(worse), Opus-judged | capacity / 1K pages | week 1 | first quarter | weeks to drain | top 10% / 50% of reads by week |
|---|---|---|---|---|---|---|---|---|---|
| Latin, Gemini 3 Flash text (most-read books) | 1,317,806 (4,949,396) | **Opus** | 0.83 [0.60, 0.96] | 0.005 | 0.048 acct-wk | 88% of Claude | 264,356 | 78 | 1 / 2 |
| Latin, lite text | 861,506 (1,568,440) | **Opus** | 0.80 [0.71, 0.87] | 0.004 | 0.048 acct-wk | — | 87,293 | 78 | 4 / 17 |
| German, Gemini 3 Flash | 353,186 (1,359,293) | **Opus** | 0.75 [0.23, 0.96] | 0.004 | 0.049 acct-wk | — | 93,127 | 78 | 3 / 6 |
| German, lite | 418,603 (843,556) | Opus (pooled cell) | 0.77 [0.15, 0.97] | 0.005 | 0.049 acct-wk | — | 42,094 | 104 | 3 / 17 |
| French, lite | 151,443 (473,237) | Opus (pooled cell) | 0.77 [0.14, 0.97] | 0.005 | 0.049 acct-wk | — | 24,078 | 104 | 2 / 8 |
| Hebrew, Gemini 3 Flash | 51,360 (290,359) | Opus (pooled cell) | 0.71 [0.14, 0.96] | 0.005 | 0.048 acct-wk | 6% of Claude | 15,537 | 104 | 1 / 1 |
| Arabic, Gemini 3 Flash | 30,244 (201,378) | Opus (pooled cell) | 0.72 [0.13, 0.97] | 0.004 | 0.049 acct-wk | 4% of Claude | 7,608 | 104 | 1 / 1 |
| Chinese, Gemini 3 Flash | 103,878 (121,280) | **Opus** | 0.51 [0.07, 0.91] | 0.005 | 0.042 acct-wk | — | 5,231 | 104 | 8 / 17 |
| Chinese tables + mixed, new guarded Paddle (#6871) | 22,220 (7,410) | **Opus** | 0.67 [0.51, 0.79] | 0.038 (Kanripo score) | 0.099 acct-wk | — | 0 | 104 | 104 / 104 |
| Chinese Paddle, Kanripo dice < 0.90 | 453,715 (166,906) | **Opus** | 0.27 [0.08, 0.45] | 0.058 | 0.092 acct-wk | — | 0 | 130 | 104 / 104 |
| Siku stale pages | 24,834 (9,448) | **Opus + Siku v2 rule** | 0.27 [0.14, 0.39] | 0.090 | 0.092 acct-wk | — | 0 | 104 | 104 / 104 |
| Tibetan, Yigdzin | 280,623 (194,496) | **Opus** | 0.45 [0.15, 0.73] | 0.015 (leaf audit, predicted) | 0.097 acct-wk | — | 0 | 104 | 43 / 104 |
| Greek, Gemini 3 Flash | 419,150 (894,950) | **held**: Derek 2026-10-14 (#6694), Greek stays on lane A | 0.73 (Opus) | 0.004 | | | | | |

**No cheaper route matches Opus at P ≥ 0.9 in any cell**, and serving the draft does not either: Opus's gain is above
the margin everywhere, even in Chinese dice < 0.90 (0.27). So every cell routes to Opus. The nearest cheaper routes,
P(matches Opus):

| cell | cheaper route | P(matches Opus) |
|---|---|---|
| Tibetan | agy Flash-low correction | 0.80 |
| lite Latin | agy Flash-low correction | 0.77 |
| Tibetan | lite (production prompt) | 0.72 |
| Chinese dice < 0.90 | agy Flash high | 0.65 |
| German lite / French lite / German 3 Flash | agy Flash low (pooled) | 0.62 / 0.59 / 0.55 |
| lite Latin | agy Argon low (pooled); the Flash re-read | 0.60; 0.53 |

- **Read with #7269:** Opus correction was preferred over Flash-low correction 163–37 by Opus readers. Flash's 11/250
  worse pages against Opus's 1 are why it falls short.
- **The free Claude half binds and agy sits idle for correction.** In the first quarter, Claude is 99.9% used and
  agy's correction share is 0. The plan drains in 78 weeks for the Latin and German cells and 104–130 for the rest.
  "Correct everything with Opus" is about two years of half of four accounts.
- **The 3-Flash cells are extrapolations.** Their evidence is #6694's most-read books (queue ranks 201–300). The
  read-weighted LP reaches the most-read books first, which is where that evidence is.

### 4. The decisions, in capacity terms (proposals; nothing was acted on)

Each row forces one route on one cell; the LP re-plans everything else.

| decision | whole cell | top 10% / 25% / 50% / 100% of reads done by week (competing / channel to itself) | first quarter | what it displaces in the quarter (pages; net pages improved) |
|---|---|---|---|---|
| **#5924** Opus corrects lite Latin, by reads (this is the base plan) | 41.4 account-weeks (861,506 pages: the census counts 861K lite pages, not #7258's 444K) | 4 / 4 / 17 / 78 · alone: 0.1 / 0.6 / 2.9 / 20.7 | 87,293 | nothing (it is the base) |
| **#5924** the same, ahead of every other cell | | 1 / 1 / 3 / 21 | 540,330 | 3-Flash Latin −264,356 (−214,763); German 3 Flash −93,127; German lite −42,094; French lite −24,078; Hebrew −15,537; Arabic −7,608; Chinese 3 Flash −5,231 |
| **#6560** Flash-low pass over Yigdzin Tibetan, now | 286K agy calls (7.3 free agy-weeks) + 1.9 account-weeks retranslation | 1 / 1 / 2 / 8 · alone: 0.1 / 0.4 / 1.2 / 7.3 | 280,623 | German 3 Flash −22,441; French lite −8,539; Hebrew −4,568; 3-Flash Latin −2,809; Arabic −1,386 (the retranslation's Claude share) |
| **#6561/#6871** Opus corrects the new Paddle tables, by reads | 2.2 account-weeks (22,220 pages) | 104 / 104 / 104 / 104 · alone: 0.1 / 0.3 / 0.6 / 1.1 | 0 | nothing |
| **#6561/#6871** the same, now | | 1 / 1 / 1 / 2 | 22,220 | German 3 Flash −22,441; French lite −8,539; 3-Flash Latin −8,600; Hebrew −4,568; Arabic −1,386 |

- **#5924, Opus correction for lite Latin.** **Proposal: yes, most-read first.** This is the #5924 DECISION's default.
  - Under the override it is simply the route: Opus matches Opus, and no cheaper corrector does yet.
  - By reads, lite Latin shares the Claude week with 3-Flash Latin of more-read books (read weight 3.8 a page against
    1.8). The top 10% of lite Latin's reads are done by week 4 and half by week 17.
  - Putting it ahead of everything does the whole cell in 21 weeks. That moves 264K 3-Flash Latin corrections out of
    the quarter.
  - **What would halve the queue:** the 30-page test of agy Flash-low correction (§6). If it matches Opus, lite Latin
    moves to agy and drains in 43 weeks, not 78.
- **The 23,953 Paddle Chinese pages (job zh-translate-route-6871; PR #7357 open).**
  - **Running now:** Opus translation passed its 20-page adoption sample (judges 18–2 and 19–1, nothing invented by
    eye). At 21:09Z, 1,119 of 26,117 pages were written, 16 of 190 books done.
  - **Capacity:** 26,117 × 9.2 × 10⁻⁶ = **0.24 account-weeks**, 12% of one free week, at #7263's rate. The run's own
    usage trace allows up to 1.1. Either way it is small: let it finish.
  - **A correction of these pages after translation** re-runs their English. The frame's translated share is 1.0 in
    the draw.
- **The Tibetan Flash-low correction pass.** **Proposal: not as a pass; test it against Opus first.**
  - Against Opus it is close: P(matches Opus) 0.80. Opus under-corrects Tibetan (net gain 0.45; 47% of planted errors
    left in #6560), and Flash low gains more (0.57) but makes more pages worse at the leaf audit (0.081 against 0.015).
  - Done now, the pass takes 7.3 free agy-weeks, which agy has idle. It also takes 1.9 account-weeks of retranslation.
  - **The test** is 30 pages through route-judge-6740 against Opus (31 agy calls + 0.003 account-weeks). If it
    confirms, Tibetan drains in 21 weeks instead of 104.
  - #6560's own NO-GO (10 of 40 worse at the leaf audit) stands until then.
- **Paddle → Opus correction for the newly read Chinese tables (the #6871 frame).** **Proposal: Opus is the route,
  but last by reads.**
  - Its 190 books are barely read (read weight 0.33 a page), so it comes up in week 104 of the plan.
  - Done now, it is 2.2 account-weeks: about 1.1 weeks of the free half, displacing 45K pages of other cells.
  - Correcting before the zh translation run reaches these books would avoid retranslating them. That run is going now.
  - #6561 set A (1 of 40 worse) is the only table evidence. Held out, it does not predict (§1). Production has 1 served
    table correction (route-judge-6740's draw), so a 40-page Kanripo-scored check of frame pages should come first.

### 5. Sensitivity (weeks to drain; pages in the first quarter)

| cell | base (all Opus) | if every test confirms | confirmed, agy × 0.7 | confirmed, agy × 1.3 | Opus@10 draw low / high | harm weight 1 / 4 |
|---|---|---|---|---|---|---|
| lite Latin | 78; 87K | **43; 241K** | 43; 209K | **34; 259K** | 43 / 130 | **26** / 78 |
| 3-Flash Latin | 78; 264K | 43; 396K (Opus 304K + agy 92K) | 52; 330K | 43; 452K | 43 / 130 | 65 / 78 |
| German 3 Flash | 78; 93K | 52; 142K | 52; 124K | 43; 160K | 43 / 130 | 65 / 78 |
| German lite | 104; 42K | 52; 84K | 52; 84K | 43; 105K | 43 / 130 | 65 / 104 |
| French lite | 104; 24K | 52; 38K | 52; 31K | 43; 46K | 43 / 130 | 65 / 104 |
| Chinese 3 Flash | 104 | 52 | 65 | 52 | 43 / 130 | 65 / 104 |
| Hebrew / Arabic 3 Flash | 104 | 52 | 52 | 43 | 43 / 130 | 65 / 104 |
| new Paddle tables | 104 | 65 | 65 | 52 | 52 / 130 | 65 / 104 |
| Chinese dice < 0.90 | 130 | 52 | 65 | 52 | 78 / 208 | 104 / 130 |
| Siku stale | 104 | 65 | 65 | 65 | 65 / 156 | 78 / 130 |
| Tibetan | 104; 0 | **21; 98K** | 26; 98K | 21; 98K | 65 / 156 | 34 / 104 |

- **The agy cap (±30%) does not move the base plan at all.** No agy route matches Opus, so agy carries no correction.
  Once the tests confirm, it moves the agy-routed cells by up to 9 weeks (lite Latin 43 → 34 at × 1.3; 3-Flash Latin 43
  → 52 at × 0.7).
- **The Claude correction draw moves everything by −45% to +65%.** It is the figure to re-meter, on an account doing
  nothing else.
- **The harm weight matters for Flash low.** At weight 1, Flash-low correction matches Opus in lite Latin and Tibetan
  (26 and 34 weeks). At 4, nothing changes from the base.

### 6. Tests, from the same budget (the planner's share: 0.037 account-weeks + 307 agy calls)

Every cheaper route with P(matches Opus) 0.5–0.9, or on an idle channel, gets the route-judge-6740 test: 30 pages,
one Opus reader against Opus on the same page, 1.25 Opus calls a page.

| cell | route under test | basis | P(matches Opus) now | draw |
|---|---|---|---|---|
| Tibetan | agy Flash-low correction | measured | 0.80 | 31 agy calls + 0.003 acct-wk |
| lite Latin | agy Flash-low correction | measured | 0.77 | the same |
| Tibetan | lite, production prompt | measured | 0.72 | $0.05 + 0.003 acct-wk |
| Chinese dice < 0.90 | agy Flash high | measured | 0.65 | 31 agy calls + 0.003 acct-wk |
| German lite / French lite / German 3 Flash / 3-Flash Latin | agy Flash low | pooled | 0.62 / 0.59 / 0.55 / 0.52 | the same, each |
| lite Latin | agy Argon low; the Flash re-read | pooled; measured | 0.60; 0.53 | the same, each |
| Tibetan | agy Argon low | measured | 0.54 | the same |

**Unrouted cells (inbox note C).** Under the override none is unrouted: Opus is every cell's fallback. The cells whose
Opus route is **pooled** (no measured cell) are German lite, French lite, Hebrew 3 Flash and Arabic 3 Flash. They route
to Opus on the assumption that Opus is fine everywhere. The smallest check that makes one measured is a 30-page Opus
correction with an Opus reader: 0.003 account-weeks + 0.0012 for the corrections. Greek is held by decision, not by
evidence.

### 7. Proposed routing-table rows (for #7170; `scripts/lib/*routing-table.json` not edited)

| id | draft → route | fallback | when a test confirms |
|---|---|---|---|
| correct-latin-flash3 | Gemini 3 Flash text → Opus (`correct.mjs`, 10 a call), most-read first, Opus CLI retranslation | Opus | Flash-low correction on agy for the overflow |
| correct-latin-lite | lite text → Opus | Opus | agy Flash-low correction (the test at 0.77) |
| correct-german-flash3, correct-chinese-flash3 | stored text → Opus | Opus | — |
| correct-german-lite, correct-french-lite, correct-hebrew-flash3, correct-arabic-flash3 | → Opus (pooled: measure 30 pages) | Opus | agy Flash low |
| correct-zh-frame-6871 | guarded Paddle → Opus (1 a call), after a 40-page Kanripo check | Opus | — |
| correct-zh-paddle-dice-lt090 | Paddle → Opus | Opus | agy Flash high (0.65) |
| correct-zh-siku-stale | Paddle → Opus with the Siku v2 rule | Opus | — |
| correct-tibetan-yigdzin | Yigdzin → Opus | Opus | agy Flash-low correction (0.80) |

Full rows, with their `why` figures: `results/allocation-v2.json` → `proposed_rows`.

### 8. Inbox note A: #4780's refusals, prompt × language family

`ocr/refusal_v2.py` keeps refusal_v1's terms: language, period, Gutenberg match, Archive downloads, Archive text online.
It adds one term: **prompt × language family**. The prompt is either the pipeline's prompt with the document-context
line or a prompt without it; the families are English, Latin, German and Romance (French, Italian). The term is
identified by #4780's own rows.

Data:
- the published census, `dataset/refusal-census-v1`: 8,955 public books, 33,197 refused of 1,726,106 lite page attempts,
  all with the context line. The full 17,519-book census is on Hetzner main;
- the #4763 gate's lite pages, from gex45's `en-numbers-4763/scores.jsonl`: 17 of 122 refused, no context line;
- #4780: 623 one-page-per-book lite reads, no context line, 147 refused.

NUTS, 2 × 600 draws per fit, R-hat ≤ 1.017, 0 divergences. Result: `results/refusal-v2.json`.

| check | #4780 fitted? | all 623: observed / predicted [90%] | languages inside 90% |
|---|---|---|---|
| v1's structure (no prompt × family term) | no | 147 / **79 [51, 111]** | **0 of 6**. Latin 34 vs 11 [5, 19], German 39 vs 6 [2, 11], French 40 vs 12 [5, 20]; English 27 vs 49 [32, 67] |
| prompt × family, split halves of #4780's books, fit on one, predict the other | half | 72 / 78 [62, 94] and 75 / 76 [60, 93] | **12 of 12** |
| prompt × family, leave one language out | 4 languages | — | **5 of 5**, but wide where the family has no other row: English 27 vs 94 [19, 153], Latin 34 vs 25 [1, 103], German 39 vs 10 [0, 47]. Where a sibling stays in, it is tight: French 40 vs 40 [21, 62], Italian 7 vs 6 [2, 11] |
| full fit (in sample) | all | 147 / 152 [129, 175] | 6 of 6 |

**What the term says.** The logit change from leaving the context line out is:

| family | change [90%] | odds |
|---|---|---|
| English | +0.41 [+0.12, +0.68] | ×1.5 |
| Latin | **+2.20 [+1.84, +2.54]** | ×9 |
| Romance (French, Italian) | **+2.49 [+2.14, +2.84]** | ×12 |
| German | **+3.30 [+2.90, +3.68]** | ×27 |

- **For routing:** a lane that sends non-English pages to Flash-Lite without the context line sees about 10–27 times the
  refusal odds the census measures. The context line is part of the route, not a detail of it.
- **For a new language family:** its effect has to be measured, not borrowed. The leave-one-language-out intervals for
  English, Latin and German span most of the range.
- **Other terms:** Archive text online +0.17 [+0.05, +0.27]; Gutenberg match +0.43 [+0.24, +0.62].

### 9. Inbox note B: v1's accuracy and did-not-read models, SVI against NUTS

`ocr/nuts_v1.py` fits v1's two models unchanged (`model_ocr_v1.py`) on one table, both ways.
- **The table:** v1's 11,934 Pareto rows, rebuilt today, plus every #4763 gate arm reachable from here: the Archive
  text and lite, and the **five GPU arms** of gex45 task `15-en-numbers-4763` (finished 2026-10-24 21:44Z, after v1).
  The GPU arms are PaddleOCR-VL with and without layout, MinerU2.5, olmOCR-2 and GLM-OCR: 854 gate rows in all.
- **The gap:** the agy arm's per-page file is on Hetzner main only, so agy is not in this table.
- **Where it ran:** NUTS on gex45's CPU, pinned to cores 4–19 and niced. The GPU job's utilisation stayed at 90–98%.

| model | SVI (v1's inference) | NUTS | NUTS / SVI interval width, median [p10, p90] over 174 chart × engine cells |
|---|---|---|---|
| did not read | AutoNormal, 15,000 steps, 51 s | 4 × 1,000 draws, R-hat 1.011, 1 divergence, 197 s | **0.95 [0.56, 1.65]**: not systematically narrow. 31 cells wider by more than 1.5×, 32 narrower by more than 1.5× |
| accuracy (hurdle) | AutoNormal, 15,000 steps, 166 s | 4 × 500 draws, **R-hat 1.154** (not converged), 0 divergences, 1.9 h | **1.29 [0.85, 2.51]**: wider in 134 of 174 cells. English 1880–1930 date-dense: olmOCR-2 2.2×, lite 2.6×, Archive text 2.1× |

NUTS_LONG

**The GPU arms on the #4763 cells**, v1's rule (the cheapest measured route within the bars, P ≥ 0.9). Here "P" is
P(clears both bars) for a route, from `results/ocr-v1-gpu-arms-english-routes.json`.

| cell | SVI | NUTS |
|---|---|---|
| English pre-1880 date-dense | **olmOCR-2 (GPU)**, P 0.91 | **olmOCR-2**, P 0.92 |
| English 1880–1930 prose | olmOCR-2 | olmOCR-2 (P 0.99) |
| English pre-1880 prose | olmOCR-2, P 0.92 | **Flash-Lite**: olmOCR-2 falls to 0.90 |
| **English 1880–1930 date-dense** (the #4763 cell) | **none clears both bars**: olmOCR-2 0.49, MinerU 0.35 | **none**: olmOCR-2 0.43, MinerU 0.33 |

- **On numbers, the GPU arms beat every route v1 had** (S4, per number printed). NUTS fits [90%]:
  - MinerU 0.128 [0.107, 0.152];
  - GLM-OCR 0.136;
  - olmOCR-2 0.140;
  - Archive text 0.169;
  - Flash-Lite 0.281.
- **Every GPU arm read every page:** did-not-read 0/34.
- **Why no route clears S4:** the character bar is set by Flash-Lite's E[CER] (0.033). olmOCR-2's 0.040 [0.024, 0.074]
  clears it in about half the draws.
- **agy is missing from this table.** v1 routed S1 and S2 to agy, so these cells compare the GPU arms with Flash-Lite and
  the Archive's text only.

### 10. Inbox note D: production route rows; route-judge-6740

- **route-census-6740 landed** (PR #7375, merged 2026-10-25 23:04Z; `ocr/results/route-census-6740/`).
  - **Nothing from it entered the correction model.** No production correction pair lands on a reference page; the
    census says so itself. Its 52 reference pairs are re-reads outside v2's cells.
  - **Its throughput rows are in §2:** production delivers far below the subscriptions' capacity.
  - **Its 596 accuracy rows and 1,193 did-not-read rows** belong to the v1 OCR models, and the long NUTS run above
    predates them. Estimator v3 ingests them.
- **route-judge-6740** (PR #7376) has built its Opus-judge instrument but judged no page: its account is above 85%
  weekly until the 2026-10-27 reset.
  - Its defect rates by taxonomy class are not available, so they are not an outcome here.
  - Its design (30 pages per route, one Opus reader against Opus) is what §6's tests use.

### Limits

- **Opus is the assumed reference (Derek's override), not a measured one.** The routing fit has no judge-family term.
  The model check estimates one at −1.44 on made-worse verdicts; if it is real, Opus correction's P(worse) is
  understated by about that much.
- **Net gain counts pages, not degree.** Latin's `misleading` rate is the one measure of degree, and only Latin has it.
- **Capacity draws are integer-meter readings on shared accounts.** Claude correction spans 2–6 × 10⁻⁵ account-weeks a
  page, and the zh run suggests translation costs up to 4× #7263's figure. agy is main's meter from a week ago. The
  free share of 0.5 is an assumption: this week's Claude accounts are at 51–86%.
- **The census cells are by stored model.** "Most-read" in the 3-Flash cells comes from read weighting, not from the
  evidence's own frame. The #6871 frame mixes table and mixed pages, priced as tables.
- **Not done:**
  - the agy arm of the #4763 gate in note B;
  - the full refusal census in note A;
  - route-census's v1 rows (v3);
  - route-judge's defect rates (not yet measured).

Artifacts:
- `scripts/eval/estimator/chain/`:
  - code: `add_correction_rows.py`, `chain_v2.py`, `allocate_v2.py`, `volumes-by-draft.mjs`;
  - inputs: `capacity.json`, `cells.json`;
  - results: `results/chain-v2-{fit,opus-fit,loeo,sim}.json`, `results/allocation-v2.{json,md}`, `results/census-by-draft-2026-10-25.json`.
- `scripts/eval/estimator/ocr/`:
  - code: `refusal_v2.py`, `nuts_v1.py`, and `build-ocr-table-v1.py` (now takes the GPU arms);
  - results: `results/refusal-v2.json`, `results/ocr-v1-nuts-vs-svi.json`, `results/ocr-v1-gpu-arms-english-routes.json`.
- Posterior draws and the per-book census: `/data/scratch/sl/jobs/estimator-v2-6740/` (cloudlayer) and
  `gex45:/root/jobs/estimator-v2-6740/`.

To rebuild:
1. `add_correction_rows.py`;
2. `chain_v2.py fit [--opus-reference] | loeo | sim`;
3. `volumes-by-draft.mjs`;
4. `allocate_v2.py --draws <opus-reference draws> --volumes …`.
