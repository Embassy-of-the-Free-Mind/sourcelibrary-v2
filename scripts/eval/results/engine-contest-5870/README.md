# engine-contest-5870 — open OCR engines vs the Flash re-read, scored by the English (#5870)

Write-up: `scripts/eval/experiments/2026-10-05-engine-contest-5870.md`. Driver: `scripts/eval/engine-contest-5870/contest.mjs`.
Rule: `scripts/eval/routing-eval/rules/translation-lift-v1.json`. Run file: `scripts/eval/routing-eval/runs/engine-contest-5870.json`.

| file | what |
|---|---|
| `sealed.json` | the 26 A5 print pages (11 Greek ≤ 1699, 7 Persian, 8 Arabic), image URL and the sha256 of the bytes Kraken read. Committed before any engine ran (ee9f87c34) |
| `prompt.json` | sha256 of the rule file as preregistered |
| `outputs-kraken.jsonl` | every Kraken read: text, model, DOI, licence, seconds |
| `translations-kraken.jsonl` | the Lite v13 English of each Kraken read (Batch) |
| `harness-results.json` | `translation-vs-reference/score.mjs` output: gate, arms `served` / `flash` / `kraken`, pairs, agreement, per page. Private-reference quotes clipped |
| `results.json` | routing-eval shape: per page `fidelity` and `catastrophic` per arm (input to `decide`) |
| `routing-eval.json`, `.md` | `routing-eval.mjs decide` with the rule: verdict per group, negative control, the lift table |
| `lift.json` | lift over today's English by script and served engine, page-points per $1K, Kraken wall clock, the A5 plan repriced |
| `spend.json` | the two Batch jobs, tokens, cost; Kraken CPU seconds |

The flash and served arms' English is A5's (`results/reocr-lift-2026-10/translations.jsonl`, arms `lite-reocr` and `lite-ocr`).
Judge packets and raw verdicts are not committed: four pages carry an in-copyright reference. They rebuild with
`contest.mjs records --out <outside the repo> --private <the T2 and T4 track records>` and
`build-packet.mjs --seed 5870 --controls-per-type 2 --chunk 7`.

Reproduce, $0: `contest.mjs results` → `routing-eval.mjs decide --results results.json --rule …/translation-lift-v1.json` → `contest.mjs lift`.
