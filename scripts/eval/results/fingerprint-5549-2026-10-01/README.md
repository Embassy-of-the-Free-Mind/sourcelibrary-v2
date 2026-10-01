# fingerprint-5549-2026-10-01

PRIOR ART: `scripts/eval/results/translation-recitation-5523-2026-10-01/` — the same layout for the sister study (recitation of a published translation); this one asks models to continue a transcription.

Run of `scripts/eval/fingerprint-5549.mjs` (#5549). Write-up: `scripts/eval/experiments/2026-10-01-fingerprint-test-do-models-continue-our-transcriptions-with-our-misreads-5549.md`.

| file | what |
|---|---|
| `items.jsonl` | 68 items: `arm` (ours / ours-shared-with-archive / archive-control), `ours` (the misread), `correct` (printed, from the image), `prefix` (what the model saw), `published_text`, `ours_predictable` |
| `drops.jsonl` | every candidate dropped and why (not located in served text, split numbers, re-OCR'd, per-book cap) |
| `continuations-<model>.jsonl` | raw continuations; Gemini rows carry tokens and USD; error rows are retried and the last good row is scored |
| `packets-v2/`, `packets-v2-out/` | the Haiku subagent packets (prefix only) and their outputs; no two items of one book in a packet |
| `packets/`, `packets-out/`, `v1-leaky-continuations-claude-haiku.jsonl` | the FIRST Haiku pass — leaky (sibling items shared a packet and Haiku copied their prefixes); kept for provenance, not scored |
| `scores.jsonl`, `report.json`, `report.md` | per-item class (ours / correct / other) and every cell with Wilson + book-cluster bootstrap intervals |

Rebuild needs the #5224 page texts restored (`results/numbers-5224/ARTIFACTS.md`); `--stage=score` alone needs nothing.
