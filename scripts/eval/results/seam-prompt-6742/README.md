# seam-prompt-6742 — results (#6742)

Write-up: `scripts/eval/experiments/2026-10-16-seam-prompt-candidate-6742.md`. Harness and preregistration:
`scripts/eval/seam-prompt-6742/`.

| file | what |
|---|---|
| `build.json` | junctions kept (254 of 300) and why the rest were dropped |
| `reads.jsonl.gz` | every translation read: junction id, arm (P, P2, C), side (N, N1), text, prompt ref, sent hash, seconds |
| `joinjudge.jsonl.gz` | blind Opus join verdicts: pair, comparison (C-P, P2-P, P-P identical), order, which arm was P, better, P/Q defect flags, note |
| `pagejudge.jsonl.gz` | blind Opus whole-page verdicts, same shape (no defect flags) |
| `calls.jsonl.gz` | every Claude CLI call: stage, pairs, seconds, tokens, list-equivalent USD |
| `report.json` | every number in the write-up and the registered rule's output (`ab.mjs score`) |

Re-score: copy these into a directory with `ctx.jsonl` rebuilt by `ab.mjs build`, gunzip, and run `ab.mjs score --out=DIR`.
