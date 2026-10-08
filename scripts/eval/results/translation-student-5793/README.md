# translation-student-5793 — results

Experiment: `scripts/eval/experiments/2026-10-04-translation-student-latin-lora-5793.md`. Preregistration: `scripts/eval/PREREGISTRATION-translation-student-5793.md`. Code: `scripts/eval/translation-student-5793/`.

| file | what |
|---|---|
| `counts.json` | data build counts (pre-sample → exclusions → train/dev/test) |
| `base-choice/` | 20 dev pages, Qwen3-8B vs Gemma-3-12B zero-shot, one blind Opus judge, source only |
| `records.jsonl` | the 71 judged records (T1 pages, PD references, arms lite/base/student after `cleanTranslation`) |
| `packet-key/`, `verdicts/` | harness packet key and both judges' raw verdicts |
| `results.json` | `translation-vs-reference/score.mjs` output (gate passed) |
| `summary.json` | `translation-student-5793/report.py`: the preregistered gate, paired Δ, invention, strata |
| `gallery.md` | student arm: best / median / worst pages, source and reference beside |
| `outputs/` | raw model outputs for dev + test (base Qwen, Gemma, student), with H100 timings |
| `throughput/` | RTX PRO 4000 Blackwell (the GEX45 GPU) vLLM timings, bf16 and FP8, 364 pages |
| `training/` | training progress log, summaries, package versions |

Training pairs are private (#4320) and are not here. The adapter is in R2 under `private/models/translation-student-5793/` (an unlisted key; the public image host serves any key, so the full key is not published).
