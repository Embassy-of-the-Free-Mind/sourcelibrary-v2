# Non-canonical OCR eval — v0.2 landed, and a data-loss incident (2026-07-19)

Context: #3235. Merged as **PR #3271** (squash `eb2d1fbc`). Supersedes the
continuation runbook `.claude/handoffs/2026-07-19-noncanon-eval-continuation.md`
for everything under its "Then, in order" section — all five steps are done.

## What shipped

- `scripts/eval/report-arms.mjs` — within-page/within-model analysis of the
  scorecard's tagged arms. Arms ride on the model field (`flash@w600`,
  `lite@annotated`), so each is a contrast against the untagged baseline.
- Observations rebuilt: **40 pages, 1,077 observations, 921 reference-scored**.
- `scripts/eval/dataset/v0.2/` + datasheet: 40 pages, 40 references (20 with
  redistributable text, 20 sha256-pointered), 921 runs.
- `.claude/docs/ocr-memorization-paper.md` Results rewritten against the new n.
- Standing paid-experiment queue posted as a comment on #3235.

## The result that changed the paper

**The pooled canonical-vs-non-canonical gap did not survive tripling the page
count.** pro +2.2pp at n=23 → +1.19pp at n=40; flash (−1.31pp) and mistral
(−1.95pp) inverted outright. Cause is mechanical, not mysterious: the pages added
in workstream 1 (Teubner Greek, 19th-c German) are *cleaner* than the canonical
pages they pool against, so the pooled statistic tracked page mix.

The claim now rests **only on same-book contrasts**, where canonical still beats
non-canonical for every model on the 1580 Virgil (1.0–5.4pp). Only **two** books
in the set print both classes. Expanding that count is worth more than ten more
unmatched pages, and it is the top follow-up.

Two arms also landed. Resolution: flash-lite is flat within 0.6pp across a 27×
range; flash is non-monotonic and its swings track **truncation**, not legibility
(a Hebrew page improves 50.2% → 95.2% when downscaled to 600px as truncation falls
100% → 0%). Prompt: the production annotation contract costs ≈1pp unconditional
accuracy with alignment unchanged; the canonicity interaction's sign disagrees
across models, so none is claimed.

The outcome-battery ranking inversion held throughout: conditional accuracy ranks
Pro first, unconditional puts flash-lite and the production pipeline ahead of it.

## The incident (this is the part worth reading)

Two sessions worked the same worktree at once. At 15:12 the other session ran a
`git reset` while a **detached nohup sweep was appending to a tracked file** in
that worktree — `scripts/eval/results/scorecard-outputs-2026-07-19.jsonl`. The
reset restored the committed 325-line version and destroyed ~96 lines: eight
completed works, ≈$1.20 of paid model calls. Only the human-readable summary log
survived; the raw model text the observations build needs was gone.

Second-order damage: the detached experiment driver was waiting on the file
reaching 469 lines, a condition that could then never be met. It only proceeded
because its author had also coded a "sweep process gone" escape hatch.

Recovery: re-ran the 8 works (4 models × 3 runs) plus 2 missing Philo pro runs
(~$2, Derek-approved), then deduped the outputs file on (work, model, run) —
5 duplicate rows removed, 895 → 890.

**Three things generalize:**

1. A detached job writing into a worktree makes every git operation in that
   worktree destructive. `git status` shows the file as modified, which reads as
   "uncommitted work," not as "live append target."
2. A wait condition on an absolute line count is not robust to truncation.
   Wait on the producer's liveness, or on a per-unit completeness check.
3. `--dangerously-skip-permissions` sessions can do this without a prompt. The
   snapshot loop that saved the rest of the run (copy new lines to scratchpad
   every 15s) is a cheap habit for any long append-only job.

## State / what's next

- Everything merged; worktree clean; nothing in flight.
- `recommend-experiments.mjs` is **stale**: it re-proposes the resolution and
  prompt arms that already ran, and splits one truncation hypothesis into five
  rows (it treats each `@tag` as a separate model). Small fix, not done here.
- Honest next priorities: free regression-verify audit (20 candidates); flash
  truncation at 2× maxTokens (~$0.85); more same-book pairs (free page hunting).
- Kept for a strong model / Derek: paper claims, novelty positioning, Zenodo/HF
  publication and dataset naming.
