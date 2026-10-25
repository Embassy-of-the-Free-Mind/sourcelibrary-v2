---
stage: ocr
measure: [judged, accuracy]
languages: [la, lzh, bo, de, grc, ar, he, en, fr, it, nah, es]
scripts: [Latn, Hani, Tibt, Grek, Arab, Hebr]
canons: []
n_books: null
n_pages: null
verdict: "Correction is now a stage of a route: pages made worse and pages made better per draft engine x corrector x language x page kind, from 115 committed counts in 13 experiments (NUTS, 0 divergences). Held out one experiment at a time, the correction rows land inside their 90% predictive interval 87 of 99 times, but re-reads replacing a draft 2 of 12: a re-read's value depends on how good the draft was, which no term carries. A judge from the corrector's own family reports fewer pages made worse (logit -1.44 [-2.46, -0.54]). At P >= 0.9 only Opus correcting Gemini 3 Flash Latin of the most-read books clears its made-worse bar (P 0.94); Opus on lite Latin is at 0.83. Allocating each channel's free week by reads x net gain per unit of capacity, Claude goes 83% to that Latin cell and agy 99% to Flash-low correction of lite Latin; Chinese and Tibetan cells wait 34-65 weeks."
status: informational
decision: "Proposals only: allocation and proposed routing rows in scripts/eval/estimator/chain/results/ for #7170; the #5924, #6560 and #6561/#6871 decisions are answered in capacity terms below (#6740)"
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
`.claude/docs/quality-research-system.md` §3a, §4, §6. No model calls; $0; CPU only (this box and gex45's CPU).

Inbox notes acted on: Derek 20:39Z (A: #4780 prompt × language family; B: NUTS vs SVI for v1; C: unrouted cells with
their smallest gate test) and 21:07Z (D: route-census-6740 rows; not posted yet, so v3 ingests them).

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
  `logit p = mu[r] + corrector[r] (within family: claude, agy, lite, re-read claude, re-read agy) + language[r] + kind[r] + draft[r] + cell[r]`.
  What is observed is p seen through an **instrument offset** (blind cross-family judge = 0, score against a reference
  text, Opus span audit against the leaf with tiles, the same without tiles, by eye) and a **same-family term** (the judge
  and the corrector are one family). Pages of one book move together: design effect 1 + (m − 1) × 0.1. NUTS, 4 × 1,000
  draws, 0 divergences, R-hat ≤ 1.004, 115 rows, 49 cells.
- **`capacity.json` and `cells.json`.** Channel capacities from the meters, and each stage's draw per page. The cells
  each carry a census selector, the route a page waits on, the candidate correctors, and the gate instrument and bar.
- **`volumes-by-draft.mjs`.** A read-only census: pages per live book × stored `ocr.model`, plus the Kanripo screen and
  the guarded-Paddle frame for Chinese. Nine languages, 109K book × bucket rows. The summary is
  `results/census-by-draft-2026-10-25.json`.
- **`allocate_v2.py`, the router and the allocation.** Per cell it picks the §3a route, then plans each channel's
  capacity with a linear programme (scipy HiGHS):
  - maximise Σ read weight × E[net gain] × pages over (cell, route, read tier);
  - subject to each channel's free capacity × H weeks, less the tests reserved from it;
  - H runs from 1 to 260 weeks;
  - read weight = (book read_count + 1) / (corpus mean + 1); a cell's books fall into 20 tiers of equal pages, most-read first.

  Every measured qualifying route enters, so a cell moves to another channel when its own is full.

**The common unit.** Net pages improved per corrected page = P(better) − 2 × P(worse), both as the cell's gate
instrument sees them. A page made worse counts double: readers already trusted that text, and nothing flags the
change. Weights 1 and 4 are in the sensitivity table. This is the one outcome every correction experiment reports.
It counts a 0.5-point CER fix in Chinese the same as a restored negation in Latin; Latin's `misleading` rate is reported
beside it.

**The bar.** P(worse) at most 5% at the cell's gate instrument, with net gain above 0. The 5% is #6694's rule and
#6560's 2 of 40; Siku keeps its own gate's 10%. The instrument is the one the cell's gate used: the cross-family blind
judge for Latin and the stored-text cells (#6694), the leaf audit with tiles for Tibetan (#6560), and the Kanripo
score for Chinese (#6561).

**Two tiers.**
- **Routable:** P(clears) ≥ 0.9, as §3a says.
- **Provisional:** the posterior median is under the bar and P(clears) ≥ 0.5. The preregistered gates were point-estimate
  rules, so this is how those experiments were adopted. A provisional route is allocated, labelled, and given the test
  that would take it to 0.9. Pooled routes (no measured cell) are listed, never routed.

### 1. What the correction model says

| term | posterior median [90%] (logit) | reading |
|---|---|---|
| same-family judge, made worse | **−1.44 [−2.46, −0.54]** | a judge from the corrector's family reports about a quarter of the odds of "worse". #6694: Opus 1/196 vs Gemini 9/196 on the same pages; #7258/#7269: Opus 1/250 vs Gemini 3/59 |
| leaf audit with tiles, made worse | **+1.01 [−0.25, +2.25]** | the #6560 gate's instrument sees more damage than a blind judge; Flash low: 0/30 by identity vs Derge, 10/40 by the audit |
| score against a reference, made worse | +0.35 [−0.75, +1.35] | not separable from a blind judge: no cell has both |
| corrector-level spread τ (made worse) | 1.00 [0.34, 1.80] | correctors differ a lot, even inside a family (Opus vs Haiku) |
| cell spread τ (made worse) | 1.11 [0.84, 1.44] | after corrector, language, kind and draft, cells still differ by about 3× in odds: a new cell is not predictable from its parts |

**Held out one experiment at a time** (`results/chain-v2-loeo.json`; fit on the other 12, predict its rows):

| | rows inside the 90% predictive interval | log score, model vs pooled average |
|---|---|---|
| all | **93 / 115** | −392 vs −1,110 |
| correction, made worse | 50 / 54 | |
| correction, made better | 37 / 45 | |
| **re-read replacing the draft** | **2 / 12** | |

- **Re-reads do not transfer.** With #6560 held out, the model predicts Opus re-reading a Yigdzin folio is worse 5%
  of the time; it was 27 of 30. With #7258 held out, it predicts the Flash re-read of lite Latin worse 71% of the time;
  it was 7 of 250. Whether a re-read helps depends on how good the draft was (a specialist Tibetan draft against a
  weak lite read), and no term carries draft quality. **Route a re-read only on its own cell's measurement.**
- **Chinese tables are not predictable from other kinds.** With #6561 held out, Opus correcting a table page is
  predicted worse on 39% of pages (1 of 40 observed). Tables differ from ordinary pages more than the kind term allows.
- **The Tibetan gate is still a miss.** Even with G4L's own gate in training, Flash low's 10/40 at the leaf audit is
  predicted at 1%. The instrument offset carries G4L's gap (3/30 → 5/40), and Flash's gap (0/30 → 10/40) is larger.
  This is v1's #4763 lesson for correction: a new instrument on new pages has to be measured.

**Simulation from known effects** (`results/chain-v2-sim.json`). The full fit's posterior medians were taken as the
truth. Counts were simulated at the evidence's own design, the model was refit, and this was repeated 8 times.
- The 90% intervals covered the true cell rate 92.6% of the time on average, over 100 cells a replicate (per replicate:
  0.96, 0.98, 1.00, 0.94, 0.88, 0.91, 0.77, 0.97).
- The median absolute error was 0.03–0.08 in rate.
- The instrument offsets were covered in 7–8 of 8 replicates each.
- The 0.77 replicate is the one with R-hat 1.015 at 600 draws.

### 2. Capacity: the meters

| channel | weekly capacity | free share | basis |
|---|---|---|---|
| Claude | 4 accounts | 0.5 → **2 account-weeks** | climits 2026-10-25T20:30Z: team@ 86%, dereklomas@ 51%, derek@sourcelibrary 64%; derek@playpowerlabs unreadable (refresh token invalid) |
| agy | **78,116 calls** | 0.5 → 39,058 | main's meter, 7 days before the 2026-10-19 lock (a lower bound: main only). Second reading 53,478/week (v1, calls.csv 10-13..10-24). Not re-read today: this box cannot reach main |
| GPU (gex45) | 168 card-hours | 0.5 | no correction route draws it: the drafts exist |
| Batch | $35 (dial $5/day) | 1.0 | `set-dial.mjs --show`; envelopes add $18–24/day (spend_daily, last 7/14 days) |

| stage | draw per page | basis |
|---|---|---|
| Opus correct, 10 pages a call (`correct.mjs`) | 4.0 × 10⁻⁵ account-week (range 2.0–6.1) | 1% per 250 Latin pages (#7258); the range is its 9–27 account-weeks for 444K pages |
| Opus correct, 1 page a call (#6561 harness) | 9.0 × 10⁻⁵ | 0.9% per 100 pages, an upper bound on a shared account (#6667) |
| agy corrector | 1.02 calls | #7269 |
| Opus translation, 10 pages a call | 9.2 × 10⁻⁶ | 3% per 3,250 pages (#7263). The zh-translate-route-6871 run reads up to 4 × 10⁻⁵ (weekly 7% → 12% for about 1,200 pages, on an account shared with this job's own session): an upper bound, too shared to use |

A corrected page that has English needs retranslation. That draw is added for the cell's translated share (Latin 0.875;
the #6871 frame 1.0, being translated now).

### 3. Allocation: per cell (`results/allocation-v2.md`)

| cell | pages waiting (read-weighted) | §3a route | P(worse) at the gate [90%] | net gain | P(clears) | capacity / 1K pages | week 1 | first quarter | weeks to drain | top 10% / 50% of reads by week | what waits meanwhile |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Latin, Gemini 3 Flash text (most-read books) | 1,317,806 (4,949,396) | **Opus** | 0.024 [0.009, 0.052] | 0.81 | **0.94** | 0.048 acct-wk | 83% of Claude | 447,856 (Opus) | 43 | 1 / 2 | 869,950 stay on the 3 Flash text |
| Latin, lite text | 861,506 (1,568,440) | Opus (provisional) | 0.028 [0.008, 0.076] | 0.80 | 0.83 | 0.048 acct-wk | 99% of agy, 15% of Claude (retranslation) | 497,358 (**agy Flash-low correction**) | 26 | 1 / 4 | 364,148 stay on lite |
| Chinese, Gemini 3 Flash text | 103,878 (121,280) | Opus (provisional) | 0.022 [0.005, 0.066] | 0.40 | 0.84 | 0.042 acct-wk | — | 10,628 | 43 | 4 / 13 | 93,250 stay on 3 Flash |
| Chinese tables + mixed, new guarded Paddle (#6871) | 22,220 (7,410) | Opus (provisional) | 0.041 [0.013, 0.104] | 0.66 | 0.62 | 0.099 acct-wk | — | 0 | 52 | 52 / 52 | all on Paddle, Opus-translated now |
| Chinese Paddle, Kanripo dice < 0.90 | 453,715 (166,906) | agy Flash high (provisional) | 0.027 [0.005, 0.083] | 0.28 | 0.80 | 1,020 agy calls | — | 0 | 34 | 21 / 34 | all on Paddle |
| Siku stale pages | 24,834 (9,448) | Opus + Siku v2 rule (provisional, 10% bar) | 0.091 [0.051, 0.144] | 0.27 | 0.62 | 0.092 acct-wk | — | 0 | 65 | 65 / 65 | all on Paddle |
| Tibetan, Yigdzin | 280,623 (194,496) | Opus (provisional; its leaf-audit rate is predicted, not measured) | 0.024 [0.003, 0.141] | 0.43 | 0.74 | 0.097 acct-wk | — | 0 | 65 | 26 / 43 | all on Yigdzin |
| German, Gemini 3 Flash | 353,186 (1,359,293) | **none clears**: Opus measured at 0.075 [0.029, 0.156] | | 0.58 | 0.21 | | | | | | all on 3 Flash |
| Greek, Gemini 3 Flash | 419,150 (894,950) | **held**: Derek 2026-10-14, Greek stays on lane A (Opus would clear at 0.94) | 0.011 | 0.70 | 0.94 | | | | | | all on 3 Flash |
| Arabic, Hebrew (3 Flash); German, French (lite) | 30K / 51K / 419K / 151K | **unrouted**: no measured cell (pooled P(clears) 0.69–0.88) | | | | | | | | | all as stored |

- **The allocation does not follow the §3a choice in lite Latin.** §3a picks Opus there, as the cheaper of the two
  provisional routes per share of a free week. But the LP spends Claude on the 3-Flash Latin of the most-read books
  first: read weight 3.8 a page against 1.8. That leaves lite Latin to agy's Flash-low correction (P(clears) 0.68,
  provisional), which has nothing better to do.
  - Read this with #7269: Opus correction was preferred over Flash correction 163–37, and Flash made 11 of 250 pages
    worse against Opus's 1.
  - The net-gain unit (better − 2 × worse against lite) does not see that difference in degree. Valued by misleading
    pages next to Opus (C5: FC 65, O 30), Flash's gain per page is about half of Opus's.
- **The 3-Flash Latin cell is an extrapolation in two ways.** Its evidence is #6694's most-read books (queue ranks
  201–300): 98 Latin pages, 1 and 3 worse under the two judges. The census cell is every live Latin page whose stored
  model is 3 Flash. The read-weighted LP reaches the most-read books first, which is where the evidence is.
- **Weeks are at half of each channel.** The last Claude cell drains at week 65 of the free half. "OCR every book"
  then retranslate is not a capacity the subscriptions have.

### 4. The decisions, in capacity terms (proposals; nothing was acted on)

Each row forces one route on one cell; the LP re-plans everything else.

| decision | whole cell | top 10% / 25% / 50% / 100% of reads done by week (competing / channel to itself) | first quarter | what it displaces in the quarter (pages; net pages improved) |
|---|---|---|---|---|
| **#5924** Opus corrects lite Latin, by reads | 41.4 account-weeks (861,506 pages; #7258 projected 18 for 444K, but the census counts 861K lite pages) | 2 / 3 / 10 / 52 · alone: 0.1 / 0.6 / 2.9 / 20.7 | 173,392 | 3-Flash Latin −99,309 (−78,633); Chinese 3 Flash −5,397. agy, freed, goes to Chinese dice < 0.90: +453,715 (+124,273) |
| **#5924** the same, ahead of every other cell | | 1 / 1 / 3 / 21 | 540,354 | 3-Flash Latin −447,856 (−354,613); Chinese 3 Flash −10,628 |
| **#6560** Flash-low pass over Yigdzin Tibetan, now | 286K agy calls (7.3 free agy-weeks) + 1.9 account-weeks retranslation | 1 / 1 / 2 / 8 · alone: 0.1 / 0.4 / 1.2 / 7.3 | 280,623 | lite Latin −237,490 (−178,113); 3-Flash Latin −36,202 |
| **#6561/#6871** Opus corrects the new Paddle tables, by reads | 2.2 account-weeks (22,220 pages) | 52 / 52 / 52 / 52 · alone: 0.1 / 0.3 / 0.6 / 1.1 | 0 | nothing |
| **#6561/#6871** the same, now | | 1 / 1 / 1 / 2 | 22,220 | 3-Flash Latin −45,874 (−36,323) |

- **#5924, Opus correction for lite Latin.**
  - **Proposal:** yes on the most-read lite books, as the #5924 DECISION's default says, at about 15–25% of the free
    Claude week. That gets the top quarter of lite Latin's reads in about 3 weeks.
  - Its P(clears) is 0.83, so it is provisional, not settled. The cross-family test below (80 pages, 0.3% of a free
    week) is what would settle it.
  - The whole cell is 41 account-weeks, about 21 weeks of the free half of four accounts. Doing it first displaces the
    one cell that clears at 0.9, Opus on the most-read 3-Flash Latin: 448K pages in the quarter.
  - Opus on 3-Flash Latin would clear at 0.9 on 98 pages of most-read books. A wider draw of that cell (40 pages,
    cross-family) should run before it takes 83% of Claude.
- **The 23,953 Paddle Chinese pages (job zh-translate-route-6871).** Its PR #7357 is open.
  - **Running now:** Opus translation passed its 20-page adoption sample (judges 18–2 and 19–1, none invented by eye).
    At 21:09Z, 1,119 of 26,117 pages were written, 16 of 190 books done.
  - **Capacity:** 26,117 × 9.2 × 10⁻⁶ = **0.24 account-weeks**, 12% of one free week, at #7263's rate. The run's own
    usage trace allows up to 1.1 account-weeks. Either way it is small, so it should finish.
  - **If these pages are corrected after translation,** every corrected page needs its English again. The frame's
    translated share is 1.0 in the draw.
- **The Tibetan Flash-low correction pass.** **Proposal: do not run it.**
  - It is measured at the gate instrument: P(worse) 0.083 [0.019, 0.238], P(clears) 0.27. The gate itself was 10 of
    40 worse. G4L does worse still (0.13).
  - Doing it now costs 7.3 free agy-weeks and displaces 237K lite-Latin corrections in the quarter.
  - The only Tibetan corrector predicted under the bar is Opus (0.024 [0.003, 0.141]). That value is predicted through
    the leaf-audit offset, and Opus was never leaf-audited.
  - **Test first:** Opus correction of 80 pages through the same leaf audit, 0.02 account-weeks. The 435-page gate
    volume is the natural frame.
- **Paddle → Opus correction for the newly read Chinese tables (the #6871 frame).** **Proposal: not now; test first.**
  - It is provisional at P(clears) 0.62. The table evidence is #6561 set A (1 of 40 worse by Kanripo CER), and
    held out it does not predict.
  - By reads it comes last: its 190 books are barely read, read weight 0.33 a page.
  - Done now, it takes 2.2 account-weeks: about 1 week of the free half, displacing 46K 3-Flash Latin corrections.
  - These pages are being translated by Opus now, so a correction after translation re-runs their English.
  - **Test first:** 40 frame pages that have a Kanripo leaf, scored mechanically: no judge call, 0.004 account-weeks.

### 5. Sensitivity

| cell | base | agy × 0.7 | agy × 1.3 | Opus@10 draw low / high | harm weight 1 / 4 |
|---|---|---|---|---|---|
| lite Latin | 26 wk; 497K in the quarter | **34 wk; 359K** (Opus 11K + Flash 348K) | **21 wk; 646K** | 21 wk (Opus takes 149K) / 26 wk | unchanged |
| 3-Flash Latin | 43 wk; 448K | 43; 462K | 43; 423K | 26 wk; 734K / 65 wk; 296K | unchanged |
| Chinese 3 Flash | 43 wk | 52 | 43 | 26 / 65 | 43 / 52 |
| Chinese dice < 0.90 | 34 wk | 43 | 26 | 26 / 34 | unchanged |
| new Paddle tables | 52 wk | 52 | 52 | 34 / 65 | unchanged |
| Siku stale | 65 wk | 65 | 65 | 43 / 104 | 65 / 78 |
| Tibetan | 65 wk | 65 | 65 | 43 / 78 | unchanged |

- **The agy cap (±30%) moves only the agy cells:** lite Latin by ±5–8 weeks, Chinese dice < 0.90 by ±8–9.
- **No §3a choice changes with it.** Opus stays cheaper per free-week share in lite Latin at agy × 1.3.
- **The Claude correction draw moves every Claude cell** by −40% to +50%. It is the figure to re-meter, on an account
  with nothing else running.

### 6. Tests reserved from the same budget (the planner's share: 0.036 account-weeks + 449 agy calls, week 1)

| cell | route under test | basis | P(clears) now | pages | instrument | draw |
|---|---|---|---|---|---|---|
| lite Latin | Opus | measured | 0.83 | 80 | cross-family blind judge (agy) | 0.003 acct-wk + 82 agy calls |
| Chinese 3 Flash | Opus | measured | 0.84 | 40 | cross-family judge | 0.002 acct-wk + 41 calls |
| Arabic 3 Flash | Opus | pooled | 0.88 | 40 | cross-family judge | 0.002 + 41 |
| Hebrew 3 Flash | Opus | pooled | 0.77 | 80 | cross-family judge | 0.003 + 82 |
| German lite | Opus | pooled | 0.69 | 80 | cross-family judge | 0.003 + 82 |
| French lite | Opus | pooled | 0.77 | 40 | cross-family judge | 0.002 + 41 |
| Chinese dice < 0.90 | agy Flash high | measured | 0.80 | 80 | Kanripo score | 82 agy calls |
| Tibetan | Opus | measured (by identity), predicted at the leaf audit | 0.74 | 80 | leaf audit with tiles | 0.022 acct-wk |

n is the smallest of {40, 80, 120, …} at which P(worse ≤ bar) would reach 0.9 if the rate is the posterior median: the
posterior as a beta, with n × median added. **Unrouted cells (inbox note C)** are the pooled rows above, and two more:
- **German, 3 Flash.** Opus is measured and fails: 0.075 [0.029, 0.156]. #6694's 5 Gemini-judged German pages are mostly
  old-spelling disputes (halbe-/halb-, Geseze/Gesetze). No size of test clears a 5% bar at that median. The smallest
  useful test is a by-eye ruling on those 5 pages (0 model calls), then 80 pages if they are judge errors.
- **Greek:** held by decision, not by evidence.

### 7. Proposed routing-table rows (for #7170; `scripts/lib/*routing-table.json` not edited)

| id | draft → corrector | status | check |
|---|---|---|---|
| correct-latin-flash3 | Gemini 3 Flash text → Opus (`correct.mjs`, 10 a call), most-read first, Opus CLI retranslation | settled (P 0.94) | made-worse ≤ 5% at a cross-family blind judge |
| correct-latin-lite | lite text → Opus where Claude has room, else agy Flash-low correction | provisional (0.83 / 0.68) | the same; the 80-page cross-family test first |
| correct-chinese-flash3 | Gemini 3 Flash text → Opus | provisional (0.84) | the same; 40 pages |
| correct-zh-frame-6871 | guarded Paddle → Opus (1 a call) | provisional (0.62) | Kanripo score ≤ 5% worse; 40 frame pages first |
| correct-zh-paddle-dice-lt090 | Paddle → agy Flash high | provisional (0.80) | the same; 80 pages |
| correct-zh-siku-stale | Paddle → Opus + Siku v2 rule | provisional (0.62, 10% bar) | the Siku gate |
| correct-tibetan-yigdzin | Yigdzin → Opus | provisional (0.74, predicted) | the #6560 leaf audit; 80 pages first. **Not Flash low** (0.27) |

Full rows, with their `why` figures: `results/allocation-v2.json` → `proposed_rows`.

### 8. Inbox note A: #4780's refusals, prompt × language family

RESULTS_A

### 9. Inbox note B: v1's accuracy and did-not-read models, SVI against NUTS

RESULTS_B

### Limits

- **Net gain is a count of pages**, not of how much each improved. Latin's `misleading` rate is the one measure of
  degree, and only Latin has it.
- **Capacity draws are integer-meter readings on shared accounts.** The Claude correction draw spans 2–6 × 10⁻⁵
  account-weeks a page, and the zh run suggests translation may cost 4× more than #7263's figure. Both need a meter
  reading on an account doing nothing else.
- **agy capacity is main's meter only, from a week ago.** This box cannot read `/root/agy-quota`.
- **Free share 0.5 is an assumption.** This week's Claude accounts are at 51–86%, so the true free share is lower.
- **The census cells are by stored model.** "Most-read" in the 3-Flash cells comes from read weighting, not from the
  evidence's own frame. The #6871 frame mixes table and mixed pages, priced as tables.
- **Not done:**
  - Production route rows from job route-census-6740 (inbox note D): not posted on #6740 by the end of this run, so
    estimator v3 will ingest them.
  - A second-family judge on the Chinese and Tibetan correction cells: their instrument is mechanical or Opus.

Artifacts:
- `scripts/eval/estimator/chain/`:
  - code: `add_correction_rows.py`, `chain_v2.py`, `allocate_v2.py`, `volumes-by-draft.mjs`;
  - inputs: `capacity.json`, `cells.json`;
  - results: `results/chain-v2-{fit,loeo,sim}.json`, `results/allocation-v2.{json,md}`, `results/census-by-draft-2026-10-25.json`.
- `scripts/eval/estimator/ocr/`: `refusal_v2.py`, `nuts_v1.py`, `results/refusal-v2.json`, `results/ocr-v1-nuts-vs-svi.json`.
- Posterior draws and the per-book census: `/data/scratch/sl/jobs/estimator-v2-6740/` (cloudlayer) and
  `gex45:/root/jobs/estimator-v2-6740/`.

To rebuild:
1. `add_correction_rows.py`;
2. `chain_v2.py fit|loeo|sim`;
3. `volumes-by-draft.mjs`;
4. `allocate_v2.py --draws … --volumes …`.
