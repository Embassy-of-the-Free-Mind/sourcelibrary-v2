---
stage: pipeline
measure: [agreement, stability]
languages: []
scripts: []
canons: []
n_books: 24
n_pages: 96
verdict: "Script-launched reviewers agree with the interactive run (serious-flag kappa 0.85-0.90) about as well as with themselves (0.92) at $0.15-0.20 a page; both preregistered conditions pass."
status: adopted
decision: "run-reviewers.sh adopted; shelf-overview skill step 3 now uses the runner (#6174)"
superseded_by: null
issue: 6174
---
## 2026-10-07 · Can a script run the shelf-overview reviewers instead of an interactive session, and how consistent are the reviewers when run again? (#6174)

PRIOR ART: `overview-2026-10-07-eternity2` (#6090), the run being repeated. `.claude/skills/shelf-overview/SKILL.md` step 3
launches reviewers as subagents of an interactive session. No earlier entry measured reviewer test–retest agreement.

**Why.** QA on subscription is limited by cost per page read. In the 2026-10-06 shelf-overview session, the
reviewers were about 19% of the spend; the orchestrating session re-reading its own context was the rest. If a plain
script can launch the same reviewers, the cost per page falls to the reviewers' own, and one account-week covers
several times more reading. That only matters if the verdicts are as good, and "as good" needs a noise floor: how
much two runs of the *same* reviewers disagree.

**Design (preregistered on #6174 before any run).**
- **Sample.** The frozen `overview-2026-10-07-eternity2` packets: 6 strata, 24 books, 96 pages.
- **O.** The original reviews (2026-10-06), six Opus subagents of an interactive session.
- **S1, S2.** The same REVIEWER.md + OVERVIEW-ADDENDUM prompt, launched by `scripts/eval/spot-check/run-reviewers.sh`
  as `claude -p --model opus`. One call per stratum, all six in parallel, no session.
- **Rule.** Adopt the runner if (1) cost ≤ $0.35/page and (2) per-page serious-flag agreement S–O is no more than 10
  points below S1–S2.
- **Measures.** "Serious" is defined exactly as in `overview-score.mjs`.
  - Cohen's κ on the per-page serious flag (95% CI resampling books) and on wrong-leaf.
  - Spearman ρ on the 1–5 OCR and English scores.
  - Jaccard overlap of serious error classes on pages both runs call serious.
  - Linear-weighted κ on the per-book show / caveat / don't verdict.
  - Fleiss' κ across all three runs.

**Result: agreement** (`scripts/eval/results/spot-check/overview-2026-10-07-eternity2/reruns-6174/agreement.md`).

| pair | serious agree | serious κ [95% CI] | wrong-leaf κ | OCR ρ | EN ρ | class Jaccard | verdict agree | verdict wκ |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| O–S1 | 93% | 0.85 [0.73, 0.96] | 1.00 | 0.92 | 0.92 | 0.57 | 22/24 | 0.86 |
| O–S2 | 95% | 0.90 [0.77, 0.98] | 1.00 | 0.91 | 0.88 | 0.55 | 21/24 | 0.79 |
| **S1–S2 (noise floor)** | 96% | 0.92 [0.83, 0.98] | 1.00 | 0.92 | 0.92 | 0.67 | 23/24 | 0.93 |

Fleiss' κ across O, S1 and S2 on the serious flag: **0.89**. The serious-page rate was 51%, 52% and 54%.

**Result: cost** (`claude -p` `total_cost_usd`, API-equivalent; ≈ $25.2 per weekly point, ±50%, #6174).
- **S1: $18.87, $0.197/page.** This includes $2.28 for a call that ended without writing its file, plus its $2.21
  rerun.
- **S2: $14.45, $0.151/page.**
- Each run took 6–13 minutes wall time and cost about 0.6–0.75 of a weekly point.
- **O: reviewer subagents $20.2 ($0.21/page).** The whole session was $105. That session also hid books, opened a PR
  and wrote the report, so ~$1.10/page is the cost of *running a shelf overview interactively*, not of
  orchestration alone.

**Answer.** **Both conditions pass. Adopt `run-reviewers.sh` for shelf-overview (and the curation check).**
- **Cost:** $0.15–0.20 per page, under the $0.35 bar.
- **Agreement:** S–O is within 1–3 points of S1–S2 on the serious flag. Launching reviewers from a script changes
  nothing measurable.

**What the repeated measures say about the reviewers themselves.**
- **Whether a page has a serious error is a stable judgement:** κ ≈ 0.9 run to run, 4–7 pages in 96 flip. The
  wrong-leaf call never flipped.
- **Which error it is, is much less stable:** class Jaccard 0.55–0.67. A defect class built on one run's labels
  inherits that noise. This is one more reason the sprint's rule requires ≥ 3 distinct books and a model-free
  detector before a class counts.
- **Book verdicts move by one step on 1–3 of 24 books,** almost always show ↔ caveat. Treat a single run's caveat
  boundary as soft.
- **Consistency is not accuracy.** All three runs are the same model with the same brief, so they share blind
  spots: three agreeing runs can be equally wrong. The external anchors are still the human readers (#5800, #5406)
  and the published-reference judges.

**Failure mode found.** 1 of 12 headless calls finished "successfully" without writing its output: it stopped to ask
whether to retry a slow download. `run-reviewers.sh` now checks for the file and retries once.

**What changed.**
- `scripts/eval/spot-check/run-reviewers.sh`, `review-agreement.py` and `run-cost.py`.
- Shelf-overview skill step 3 now uses the runner.
- #6174: a check row can carry its run's `total_cost_usd`.
