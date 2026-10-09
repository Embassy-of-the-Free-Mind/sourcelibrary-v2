# ai-exposure-r2-6038 — run 2 of #6038 (fact test, preregistered)

Produced by `scripts/eval/ai-exposure-r2-6038.mjs` (stages prep → packets → gemini/openrouter/ingest → report), which
imports run 1's helpers (`scripts/eval/ai-exposure-6038.mjs`). Preregistration: `scripts/eval/PREREGISTRATION-ai-exposure-r2-6038.md`.
Write-up: `scripts/eval/experiments/2026-10-07-ai-exposure-run2-6038.md`.

| file | what |
|---|---|
| `works.jsonl` | the random 500 with identifiability, parsed catalogue author, masked title, units, century, genre |
| `controls.jsonl` | run 1's 24 canonical, 22 known and 40 decoys + the obscure-known tier (25) |
| `nalanda.jsonl` | 17 works by Nālandā masters + 7 Tibetan commentaries on them |
| `single100-ids.json` | the seeded 100 for the one-per-request arm |
| `packets-<arm>-<set>/` | exact prompts (arms neutral, verify; sets sub500, controls, nalanda, single100) |
| `packets-<arm>-<set>-out/<model>/` | raw subagent outputs (Opus, Haiku) |
| `answers-<arm>-<set>-<model>[-rep2].jsonl` | parsed answers per packet |
| `report.json`, `report.md` | every table; `report.json.primary` is the preregistered answer |
| `per-work.jsonl` | per work: outcome per model, units, flags |
| `eye-identifiability.jsonl` | 40 titles labelled by eye, blind to the rule label |
| `eye-bluffs.jsonl` | every Pro and Opus "yes + wrong author", read by eye |
| `eye-mismatches-posthoc.jsonl` | every remaining numerator mismatch, read by eye (post hoc) |
| `spend.jsonl` | cost of every Gemini and OpenRouter call |
