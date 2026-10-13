# ai-exposure-6038 — work-level "new to AI" refresh (#6038)

Produced by `scripts/eval/ai-exposure-6038.mjs` (stages ids → draw → controls → packets → gemini/ingest → verify → report).
Write-up: `scripts/eval/experiments/2026-10-06-ai-exposure-refresh-6038.md`.

| file | what |
|---|---|
| `ids-manifest.json` | sha256 and size of the checkpointed id list (the list itself is private: it names hidden books) |
| `walk.jsonl` | every work the seeded walk visited: editions, which edition had text |
| `draw-summary.json` | quotas reached, works walked, share with OCR text |
| `sample.jsonl` | 2,361 works: main 2,000 + strata; `in_sub500` marks the Pro/Haiku subsample |
| `controls.jsonl` | 24 canonical, 22 known, 40 invented decoys |
| `packets-<set>/` | the exact prompts sent (sets: controls, main, sub500, strata) |
| `packets-<set>-out/` | raw Haiku subagent outputs |
| `answers-<set>-<model>.jsonl` | parsed answers per packet |
| `verify.jsonl`, `verify-summary.json` | opening quotes against our OCR, with the cross-book null |
| `posteriors.jsonl` | per work: prior, fused posteriors per arm, answers per model |
| `report.json`, `report.md` | all tables; `report.json.recognition` is the headline |
| `spend.jsonl` | cost of every Gemini call |

OCR text used for the opening check stays outside the repo (`AIEXP_PRIVATE`, default `/root/claude-jobs/ai-exposure-6038-private/texts/`): most sampled books are hidden.
