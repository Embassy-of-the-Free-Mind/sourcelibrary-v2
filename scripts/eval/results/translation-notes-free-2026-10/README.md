# translation-notes-free-2026-10 (#5919)

Prompt v13 (run twice) against `v13-plain`, the same prompt with its notes instructions removed in memory, on the
40 reference pages and 8 gallery-pool pages of the #5698 draw (`../translation-prompt-v17-2026-10/sample.jsonl`).
Write-up: `scripts/eval/experiments/2026-10-06-translation-notes-free-5919.md`. Rule: issue #5919.
Scripts: `scripts/eval/translation-notes-free/`.

| file | what |
|---|---|
| `prompt-v13-plain.txt` | the edited prompt in full, as sent (md5 `655488d8ecd524d7f3139fe9aeec50f5`) |
| `arms.jsonl` | 144 model outputs (page × arm): text, model, tokens, cost, prompt row |
| `records.jsonl` | the 48 pages in harness shape, with the three arms as candidates |
| `mechanical.json` | string checks per page and arm (P3, P4), paired CIs against v13-a |
| `results-fidelity.json`, `fidelity-verdicts-j{1,2}.jsonl`, `fidelity-key.json` | the #5695 harness, two blind Opus judges; controls and gate inside |
| `results.json` | the preregistered rule applied (P1, P2, Decision), by judge, model and language |

Measures: fidelity is judged against a human reference (two judges); the mechanical rows are exact counts.
Neither is accuracy in the eval-design §2 sense.

To rebuild from the working directory (not committed): `score.mjs --pack`, `score.mjs`,
`translation-vs-reference/score.mjs --packet work/fidelity --out results-fidelity.json --seed 5919`, `score.mjs --rule`.
