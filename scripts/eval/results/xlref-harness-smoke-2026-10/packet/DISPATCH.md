# Dispatch — scripts/eval/results/xlref-harness-smoke-2026-10/packet

One Opus subagent per chunk (model: opus), at most 8 at a time. GATE chunks first; run `score.mjs --gate-only` and stop if it fails.
Each subagent prompt is exactly the line below (the judge must not be told which arms exist, which item is a control, or where key.json is).

## gate

- [j1] Read /data/scratch/sl/sourcelibrary/.claude/worktrees/job-xlref-harness/scripts/eval/translation-vs-reference/JUDGE-PROMPT.md and follow it exactly. INPUT_FILE=/data/scratch/sl/sourcelibrary/.claude/worktrees/job-xlref-harness/scripts/eval/results/xlref-harness-smoke-2026-10/packet/packets/j1/gate-01.jsonl OUTPUT_FILE=/data/scratch/sl/sourcelibrary/.claude/worktrees/job-xlref-harness/scripts/eval/results/xlref-harness-smoke-2026-10/packet/verdicts/j1/gate-01.jsonl
- [j2] Read /data/scratch/sl/sourcelibrary/.claude/worktrees/job-xlref-harness/scripts/eval/translation-vs-reference/JUDGE-PROMPT.md and follow it exactly. INPUT_FILE=/data/scratch/sl/sourcelibrary/.claude/worktrees/job-xlref-harness/scripts/eval/results/xlref-harness-smoke-2026-10/packet/packets/j2/gate-01.jsonl OUTPUT_FILE=/data/scratch/sl/sourcelibrary/.claude/worktrees/job-xlref-harness/scripts/eval/results/xlref-harness-smoke-2026-10/packet/verdicts/j2/gate-01.jsonl

## main

- [j1] Read /data/scratch/sl/sourcelibrary/.claude/worktrees/job-xlref-harness/scripts/eval/translation-vs-reference/JUDGE-PROMPT.md and follow it exactly. INPUT_FILE=/data/scratch/sl/sourcelibrary/.claude/worktrees/job-xlref-harness/scripts/eval/results/xlref-harness-smoke-2026-10/packet/packets/j1/main-01.jsonl OUTPUT_FILE=/data/scratch/sl/sourcelibrary/.claude/worktrees/job-xlref-harness/scripts/eval/results/xlref-harness-smoke-2026-10/packet/verdicts/j1/main-01.jsonl
- [j2] Read /data/scratch/sl/sourcelibrary/.claude/worktrees/job-xlref-harness/scripts/eval/translation-vs-reference/JUDGE-PROMPT.md and follow it exactly. INPUT_FILE=/data/scratch/sl/sourcelibrary/.claude/worktrees/job-xlref-harness/scripts/eval/results/xlref-harness-smoke-2026-10/packet/packets/j2/main-01.jsonl OUTPUT_FILE=/data/scratch/sl/sourcelibrary/.claude/worktrees/job-xlref-harness/scripts/eval/results/xlref-harness-smoke-2026-10/packet/verdicts/j2/main-01.jsonl
