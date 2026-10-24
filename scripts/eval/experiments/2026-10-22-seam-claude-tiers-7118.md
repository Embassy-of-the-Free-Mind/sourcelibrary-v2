---
stage: translation
measure: [judged, judged_vs_reference]
languages: []
scripts: []
canons: []
n_books: 324
n_pages: 2600
verdict: "Haiku cannot screen page joins for the Claude seam lane: its best recall on Opus's 47 major defects is 68% (32/47, passing 42% of joins), 91% only at p≥1, which passes 86%, and the screen then costs more than sending every join to Sonnet. Not installed. Sonnet as the repairer: 98.8% of placed repairs preferred by the blind Opus judge, 0 worse, but verified yield 27.3% against Opus's 36.3% and Gemini's 36.7%. The whole Sonnet lane (repair + 7% Opus sample) measured 4 weekly points per 1,000 joins. On 1,000 nightly joins the placement checks refused 120 of the 183 majors Sonnet found."
status: rejected
decision: "Haiku screen not installed; the Claude lane for Gemini-locked nights stays #7120 Sonnet fallback, unscreened (#7118)"
superseded_by: null
issue: 7118
---
## 2026-10-22 · Claude tiers for seam repair: Haiku screen, Sonnet repair, Opus verify (#7118)

PRIOR ART: `2026-10-15-seams-scale-opus-flashlite-6742.md` gives the 300 Opus-labelled joins and the flash-lite detect
arms D1–D5, whose D1 question this screen copies. `2026-10-16-seam-repair-lean-6742.md` gives Test B: Gemini against
Opus as repairer, with the blind both-orders Opus judge. `2026-10-15-seam-repair-pilot-6742.md` measured Opus at about
0.6 weekly points per 100 joins. #7120 added `lean.mjs run --repairer=sonnet` and the `--fallback` arm. Scripts:
`scripts/eval/seam-tiers-7118/detect.mjs` (new). Test B reuses `gemini-repair.mjs stage/score` and `seam-repair.mjs
repair/verify` unchanged. Results: `scripts/eval/results/seam-tiers-7118/`. Every call went through the box account's
subscription (`claude -p`, sealed). No Gemini and no agy calls were made. Nothing was written to Mongo.

### 1. Screen: is this join defective? (300 joins, Opus labels as reference)

Prompt: D1 packed, 10 joins per call (`p_defect` 0–100). Positives by Opus: 131 any defect, 47 major (severity major),
39 "major4" (omission, drift, duplication or broken syntax, labelled major). Pack size on 60 joins: Haiku with 10 per
call had κ 0.33 and major AUC 0.80; with 20 per call, κ 0.15 and major AUC 0.67. Pack 10 was kept.

| arm | AUC any | AUC major | own call: agree / κ | own call: major recall | plants caught | goods flagged | list $ / 100 joins |
|---|---|---|---|---|---|---|---|
| Haiku 4.5, thinking on (CLI default) | 0.71 | 0.68 | 70% / 0.35 | 49% (23/47) | 18/30 | 2/30 | 1.04 |
| Haiku 4.5, thinking off (`MAX_THINKING_TOKENS=0`) | 0.59 | 0.59 | 57% / 0.06 | 23% | 6/30 | 1/30 | 0.50 |
| Sonnet 5.5 | 0.82 | 0.87 | 79% / 0.56 | 87% (41/47) | 30/30 | 2/30 | 1.27 |
| *bar (#6742: agy Flash vs Opus)* | | | *91% / 0.82* | | | | |

Threshold rows: "pass" is the share of joins a screen sends on to the repairer.

| arm, p_defect ≥ | pass | major recall | any recall | any precision |
|---|---|---|---|---|
| Haiku ≥ 1 | 86% | 91% (43/47) | n/a | n/a |
| Haiku ≥ 5 | 83% | 87% (41/47) | n/a | n/a |
| Haiku ≥ 10 | 42% | 68% (32/47) | 60% | 63% |
| Haiku ≥ 30 | 23% | 49% (23/47) | 41% | 78% |
| Sonnet ≥ 10 | 54% | 94% (44/47) | 78% | 63% |
| Sonnet ≥ 30 | 29% | 87% (41/47) | 60% | 89% |

**The bar is not met.** To reach ≥ 90% major recall, Haiku has to pass 86% of joins. Haiku costs $1.04 per 100 joins
and the Sonnet repair it would feed costs $1.04–1.43 per 100 joins, so the screen saves nothing unless it passes fewer
than about 27% of joins. At that pass share it catches 49% of majors. Haiku's scores are bimodal: most joins get 0–5
and almost all the rest get 65–95. Its misses are majors it calls clean, with confident reasons ("Transition flows
naturally" on an Opus omission). Sonnet meets the recall bar at p ≥ 10, but a Sonnet screen costs about the same as
a Sonnet repair, which labels the join anyway. Haiku with thinking off is cheaper and close to chance.

### 2. Sonnet as repairer, Opus verify (Test B on the 300)

Sonnet ran the opus-reference PROMPT with 30 joins per call (`seam-repair.mjs repair --model=sonnet --pack=30`). The
blind Opus judge saw every placed repair in both orders, with 10 A/A pairs (`verify --arm=sonnet`).

| repairer | labelled defective | placed | verified (preferred both orders) | worse | yield /300 | Opus majors verified | real-stratum majors verified |
|---|---|---|---|---|---|---|---|
| Sonnet 5.5 | 96 | 83 | 82 (98.8%) | 0 | 27.3% | 31/47 | 17/30 |
| Opus 5.5 (self-judged ceiling) | 131 | 114 | 109 | 0 | 36.3% | 38/47 | 22/30 |
| Gemini 3.8 Flash (agy) | 136 | 118 | 110 | 1 | 36.7% | 34/47 | 18/30 |

A/A: 10/10 tie/tie. Sonnet's placed repairs are as good as Opus's. It finds fewer defects: 19 defective of 120 on the
random stratum, where Opus found 35. This repeats the pilot (45 vs 61 repairs per 100 joins).

Restricted to the joins a screen passes (`detect.mjs screened`): Sonnet behind Haiku ≥ 10 verifies 56 joins and 21/47
majors, against 82 and 31/47 unscreened. Behind Haiku ≥ 1 it verifies 79 and 28/47.

### 3. Cost

List-price USD is `total_cost_usd` from each call. It is not billed: everything ran on the subscription. Weekly points
come from the box account's `climits` poll, which has a resolution of 1 point and is shared with other jobs on the
account.

| arm | list $ / 100 joins | weekly points / 100 joins |
|---|---|---|
| Haiku screen, thinking on, 10/call | 1.04 | ≈ 0.36* |
| Haiku screen, thinking on, 20/call (60 joins) | 0.69 | ≈ 0.24* |
| Haiku screen, thinking off, 10/call | 0.50 | ≈ 0.18* |
| Sonnet screen, 10/call | 1.27 | ≈ 0.44* |
| Sonnet repair, Test B excerpts (1,500 chars), 30/call | 1.43 | ≈ 0.50* |
| Sonnet repair, runner windows (`lean.mjs`), 30/call | 1.04 | **measured as a lane, below** |
| Opus verify of every placed repair (Test B) | 1.97 | ≈ 0.69* |
| Opus verify, the runner's 7% sample | 0.10 | ≈ 0.03* |
| **Lane: `lean.mjs run --repairer=sonnet`, 1,000 nightly joins, run alone** | **1.14** | **0.4 (4 points: 11% → 15%, 18:05–18:30 UTC)** |

\* Converted at the lane's measured 0.35 points per list dollar (4 points / $11.42). That is an upper bound: the
account was shared, and this job's own session spent from it. The screens and Test B ran concurrently, from 17:35 to
18:05 UTC, and moved the account from 8% to 11% weekly for $19.2 of list price. The 5-hour session meter went from 35%
to 54% for the 1,000-join lane.

### 4. The lane on 1,000 pending nightly joins (dry run, scratch dir)

The 1,000 joins were the first pending candidates of `/mnt/HC_Volume_105839809/seam-lean-6742`: tranche joins in the
24 most-read books. Sonnet labelled 725 defective (4 replies unparsed), 183 of them major. Placement kept 537. The 7% blind Opus sample
preferred 38/38 in both orders, with A/A tie/tie. The write plan held 447 joins (606 pages); 90 were refused at the
store. **Of the 183 majors, 48 would be written, 15 were refused at the store, and 120 were refused by placement**:
edit-too-large 36, drops-content-words 49, touches-more-than-3-sentences 19, not-at-edge 7, no-repair 9. An omission
that needs a missing sentence put back is often larger than the edge bound allows, and on this sample the placement
checks reject majors more often than capacity limits them. The brief kept PREFER_FLOOR, MAX_LOST and the refusals
unchanged; changing them is a separate decision.

### 5. Throughput (box account, team@)

- Other jobs used the account at about 3.5 points/day this week (0% at the 10-20 reset, 7% on 10-22 at 14:00), about
  25 points a week. Under the runner's 60% stop, about **35 points/week** are left for seams.
- At 0.4 points per 100 joins, that is about **8,750 joins/week, about 1,250/night**. The cron's `--max-joins=2500`
  would hit 60% after about four nights, and the runner would then skip nights, as it is designed to.
- That rate writes about 48 majors per 1,000 tranche joins, roughly **420 majors/week**. The ~480K major joins are out
  of reach of this lane: Sonnet finds 66% of Opus's majors, and placement then keeps 26% of the majors it finds. A full
  sweep of the 4.40M prose joins would take about 500 weeks on this account.
- More accounts: per account with S spare points under 60%, about S × 250 joins/week. cloudlayer (derek@playpowerlabs)
  went from 46% to 49% in two days this week, so it has about 10 points/week of its own use and could add about 12K
  joins/week, which cuts any ETA by about 2.4×. l7a (derek@sourcelibrary) was at 91% (76 → 91 in one day) and adds
  nothing under 60% at that pace.
- For comparison, the Gemini lane spends about 0.01 Claude points per 100 joins (the 7% sample only), so its limit is
  agy quota: about 2,500 joins a night, roughly 17.5K a week. The Claude lane is the floor for nights when agy is
  locked. It cannot replace the Gemini lane.

### Limits of this measurement

- Weekly points have a resolution of 1 point on a shared account. Per-arm points are list price converted at one
  measured ratio. Haiku may weigh differently from Sonnet against the limit.
- The screen was measured on #6742's 1,500-character excerpts, not on the runner's tighter windows. Haiku's failure is
  large enough that a re-cut is unlikely to change the conclusion. `detect.mjs --windows=tight` exists but was not run.
- Opus's verified count on its own repairs is self-judged, as it was in #6742.
