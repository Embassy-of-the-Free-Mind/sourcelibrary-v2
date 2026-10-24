# seam-tiers-7118 — results (#7118)

Write-up: `scripts/eval/experiments/2026-10-22-seam-claude-tiers-7118.md`. Script: `scripts/eval/seam-tiers-7118/detect.mjs`.
Reference set: `../seams-6742/` (300 joins with Opus labels). Every call went through the `claude -p` subscription. List
price is `total_cost_usd`, which was not billed.

| file | what |
|---|---|
| `detect-{haiku-p10,haiku-p20,haiku-p10-nt,sonnet-p10}.jsonl.gz` | the screen: one row per join (`p_defect`, `defect`, `reason`). `p20` covers 60 joins; `nt` is thinking off |
| `calls.jsonl.gz` | every screen call: model, joins, seconds, tokens, list USD |
| `screen.json` | `detect.mjs score`: AUC, recall/precision at p ≥ 10…90 for any defect, major and major4, κ, plants, goods, cost |
| `screened.json` | `detect.mjs screened`: Test B verified repairs per arm, on all joins and on the joins each screen passes |
| `testb/repair-sonnet.jsonl.gz`, `verify-sonnet.jsonl.gz`, `calls-sonnet.jsonl.gz`, `test-b.json` | Test B for Sonnet (30 joins per call), the blind Opus judge in both orders with A/A, and `gemini-repair.mjs score --arms=sonnet,opus,gemini` |
| `lean-sonnet-dry-run/` | `lean.mjs run --repairer=sonnet` on 1,000 pending nightly joins in a scratch dir, no `--apply`: `runs.jsonl` (the tally, with weekly 11% → 15%), repairs, the 7% verify sample, calls, store refusals, and `majors-placement.txt` (where each major ended up, by label) |

Re-score: `detect.mjs score --out=DIR --arms=...` with the detect files unpacked into DIR. For Test B, run
`gemini-repair.mjs stage --out=T`, unpack `../seam-lean-6742/test-b/*.gz` and `testb/*.gz` into T (renaming
`calls-sonnet` to append to `calls.jsonl`), then `gemini-repair.mjs score --out=T --arms=sonnet,opus,gemini`.
