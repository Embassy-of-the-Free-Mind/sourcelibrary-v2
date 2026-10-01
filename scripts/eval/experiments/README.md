# Experiment log — what we ran, and what it concluded

PRIOR ART: `recommend-experiments.mjs` ranks experiments still *worth running*;
`INDEX.md` lists the scripts that exist. Neither records **what a run concluded**,
which is the thing that evaporates. This is that record.

**Where to write (#5436).** One entry = ONE new file in `scripts/eval/experiments/`,
named `YYYY-MM-DD-<slug>.md`, beginning with the heading `## YYYY-MM-DD · <question>`
(the date in the name and the heading must agree). Never edit `EXPERIMENTS.md`
itself: it is generated from these files on `main` after every merge
(`.github/workflows/eval-ledgers-regenerate.yml`), and CI refuses a PR that
hand-edits it. Why: when every eval PR appended to the same tail of one file, two
PRs on the same day were a textual conflict every time — 6 of 11 conflicting PRs
on 2026-10-01 — and auto-merge never merges a conflicting PR. Two files never
conflict. To read the whole log locally without waiting for main:
`node scripts/eval/build-experiments.mjs --print`.

Standing series (one table, a row per run, e.g. the monthly corpus audit) live in
`_series-<slug>.md` and render before the dated entries; notes about the log itself
in `_note-<slug>.md`, rendered last. The series files are `merge=union` in
`.gitattributes` so two rows appended by two PRs both survive a local rebase.

Newest first in the generated file. One entry per *question*, not per invocation. A
null result and a retraction are both first-class entries — the retractions are the
most valuable rows here, because a wrong number that stays uncorrected in a PR
description is how a mistake becomes doctrine.

**Rare-event discipline.** These runs happen a few times a month at most, so
nobody remembers them and nobody will re-read the code. Two lines here when you
finish is the whole mechanism. If you ran something and did not log it, the next
person pays for it again.

**Format.** Date · question · design · result · *replicated?* · artifact.
The replication column exists because of 2026-09-02, below.
