# Experiment log — what we ran, and what it concluded

PRIOR ART: `recommend-experiments.mjs` ranks experiments still *worth running*;
`INDEX.md` lists the scripts that exist. Neither records **what a run concluded**,
which is the thing that evaporates. This is that record.

Append-only, newest first. One entry per *question*, not per invocation. A null
result and a retraction are both first-class entries — the retractions are the
most valuable rows here, because a wrong number that stays uncorrected in a PR
description is how a mistake becomes doctrine.

**Rare-event discipline.** These runs happen a few times a month at most, so
nobody remembers them and nobody will re-read the code. Two lines here when you
finish is the whole mechanism. If you ran something and did not log it, the next
person pays for it again.

**Format.** Date · question · design · result · *replicated?* · artifact.
The replication column exists because of 2026-09-02, below.

---

## 2026-09-02 — Does OCR prompt v17 reduce fabrication vs v15?

- **Design.** Paired, k=5 runs per (page, arm), page as unit of analysis,
  positive + negative controls, decision rule pre-registered.
  `scripts/eval/prompt-ab.mjs`.
- **Result.** **INCONCLUSIVE, and the first-pass finding was retracted.** A
  single run per arm showed v17 cutting a fabricated page from 24,108 → 1,286
  body chars. At k=5 that page's SD was **±10,222** — the "finding" was one draw.
- **Replicated?** **No — it reversed.** Two independent k=5 runs put the runaway
  loop on *opposite arms*:

  | | run 1 | run 2 |
  |---|---|---|
  | p.118 v15 | 16,264 ±0 | 554 ±65 |
  | p.118 v17 | 348 ±4 | 16,232 ±0 |

  ~16.2k is the **output-token cap**: a degenerate repetition loop running to
  truncation. It lands on either arm, and within a batch of 5 it is all-or-none
  (±0, agreement 1.000), which is exactly what makes one batch look decisive.
  Arms verified distinct by `content_hash`.
- **What this means for method.** Body-length *means* are the wrong estimator
  when the failure is a categorical catastrophe. Needed: a repetition classifier,
  **loop rate as a Bernoulli outcome**, length statistics on non-looped runs
  only, and tens of runs per arm. k=5 cannot estimate a rate this volatile.
- **Artifacts.** `results/prompt-ab-v15-v17-{lacuna,blank}-2026-09-02.json`,
  `…-lacuna-2026-09-02-amended.json`. PR #4610, issue #4195.

## 2026-09-02 — Does #4195's blank-page narrowing work?

- **Design.** Same harness, `--cases blank`.
- **Result.** **Yes, on the faint-mark page** — v17 classifies Kitāb al-Bulhān
  p.4 as `text` on 5/5 runs where v15 said `blank`. I had reported the opposite
  from a single run.
- **Replicated?** Single k=5 run; stable within it (5/5), not repeated across
  sessions.
- **Counter-finding.** v17 **over-declines** elsewhere: p.197's legible Latin
  note ("Nihil hic deesse videtur") becomes a `<lacuna>`. That is the trade
  #4195 warned about, running in the direction nobody was watching.
- **Consequence.** v17 not promoted; PR #4605 labelled `blocked`.

## 2026-09-02 — Is a similarity gate a workable way to stop duplicated work?

- **Design.** Replay all 2,043 watched files as if newly created; sweep the
  block threshold; require the four real duplications of that day to keep firing.
  `.claude/hooks/calibrate-prior-art-guard.mjs`.
- **Result.** **No.** Four rounds of tuning could not get the firing rate below
  ~30% while keeping the true positives:

  | threshold | would block | true positives |
  |---|---|---|
  | 0.60 | 49.1% | 2/2 |
  | 0.70 | 33.2% | 1/2 |
  | 1.00 | 29.9% | 1/2 |

  In a repo organised into families (`ft-*`, `build-*`, `report-*`) the base rate
  of legitimate similarity is high, so a ranked filter's precision tracks it.
- **Consequence.** The gate was redesigned to be **unconditional** — declare
  prior art in any new file under watched roots — with the similarity list
  demoted to advisory. Nothing to tune, nothing to argue about.
- **Two ways the probe lied before it worked**, both worth remembering: it
  replayed existing paths that the guard skips and reported a reassuring **0%**;
  and it invoked a hook path that did not exist, where `else allowed++` counted
  every failed spawn as a pass. A probe needs a positive control, and absence of
  a signal is not evidence of a pass.
- **Artifact.** PR for `.claude/hooks/prior-art-guard.mjs`.

---

## Older runs — not yet back-filled

`results/` holds dated artifacts going back to 2026-04 (calibration scorecards,
blank-page study, revision-agreement pilots, cross-model comparisons, the
occlusion pilot). Their conclusions live in
`.claude/docs/ocr-quality-measurement-loop.md`,
`.claude/docs/ocr-memorization-paper.md` and the issues that commissioned them —
**not** here. Back-filling them is worthwhile but has not been done, and this
section exists so nobody reads the gap as "nothing was run before September".
