# seams-6742 — results (#6742)

Write-up: `scripts/eval/experiments/2026-10-15-seams-scale-opus-flashlite-6742.md`. Scripts: `scripts/eval/seams-6742/`.

| file | what |
|---|---|
| `frame-summary.json` | exact frame: 4,777,862 eligible breaks on 19,105 live, non-held books (2026-10-15), exclusions by reason |
| `census-signals.jsonl.gz` | 2,000 drawn breaks (one per book) + 114 short-page skips: every deterministic signal, lane, model; edge texts stripped (the 300 Opus items carry theirs) |
| `census-summary.json` | per-book and break-weighted signal rates, Wilson / book-bootstrap CIs, strata |
| `items.jsonl.gz` | the 300 junctions exactly as shown to every model (four edge excerpts, ≤1,500 chars each; planted items already broken) |
| `key.jsonl.gz` | per item: stratum (random / flagged / good / plant), plant kind, census signals, lane, model |
| `labels.jsonl.gz` | Opus reference labels + minimal repairs (`repairCheck`: does the repair's old text sit at the edge) |
| `detect-D1..D5.jsonl.gz` | flash-lite detect arms |
| `repair-R1..R3.jsonl.gz` | flash-lite repair arms |
| `verify-R1.jsonl.gz`, `verify-R3.jsonl.gz` | D4 run again on each repaired join (the apply gate) |
| `judge-packets.jsonl.gz` | pair → (item, arm, order) map; texts are rebuilt by `judge-repairs.mjs build` from items + repairs |
| `judge.jsonl.gz`, `judge-unchanged.jsonl.gz` | blind Opus pairwise verdicts; arms whose repair was null or did not apply |
| `spend.jsonl.gz` | every Gemini call, tokens and list-price USD |
| `report.json` | every number in the write-up (`score.mjs`) |
| `PROMPT.md`, `JUDGE-PROMPT.md` | the Opus reference and judge prompts |

Re-score from these files: gunzip into a directory (census-signals → `census.jsonl`), copy `repair-set.json`, and
`node scripts/eval/seams-6742/score.mjs --census=DIR/census.jsonl --frame=scripts/eval/results/seams-6742/frame-summary.json --out=DIR`.
