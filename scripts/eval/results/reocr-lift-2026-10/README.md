# reocr-lift-2026-10 — does a real re-OCR lift the English? (#5700 A5)

Write-up: `scripts/eval/experiments/2026-10-04-reocr-lift-5700.md`. Scripts: `scripts/eval/reocr-lift-5700/`.

| file | what |
|---|---|
| `track-pages.jsonl` | the 109 #5695 track pages with a corrected transcription or a served score ≤ 3: served OCR, corrected text, open reference text, each track's own fidelity (`load-tracks.mjs`). In-copyright reference texts are absent (6 pages) |
| `curve.json`, `curve.md` | step 1, $0: CER of the served OCR × the fidelity gain from the corrected text, 99 pages (`curve.mjs`) |
| `enriched.jsonl` | per page: image read, book context, which model and prompt made the served OCR (`pilot.mjs enrich`) |
| `reocr.jsonl` | every fresh read: arm `reocr` (109), `reocr2` (30, the A-vs-A repeat), `reocr-display` (23, leaf check from `display_photo`), with outcome and tokens |
| `translations.jsonl` | every translation arm's text: `{lite,flash}-{ocr,reocr,reocr2,corr}`, prompt v13, temperature 0 |
| `ocr-score.json` | the fresh read vs the served OCR against the corrected text; A-vs-A distance; the two different-leaf pages (`ocr-score.mjs`) |
| `results.json` | harness output (`translation-vs-reference/score.mjs`), 93 pages, two judges; written with `--force`, reason in `lift.json` `gate` |
| `gate-supplementary.json` | the second gate, on corrected-text candidates |
| `lift.json`, `lift.md` | the real lift beside the by-eye ceiling, by served engine, script, CER bin, cause, print/manuscript (`lift.mjs`) |
| `sizing-counts.jsonl`, `sizing.json`, `sizing.md` | exact served translated pages per book by `ocr.model` × `script_type`, and the priced, ranked strata (`sizing.mjs`) |
| `judged-pages.json`, `packet-manifest.json`, `spend.json` | which pages were judged and why not; packet seed and chunk list; tokens and realtime cost per arm |

The judge packets and raw verdicts are not committed: six pages carry an in-copyright reference. They rebuild from
`build-records.mjs` (with the tracks' local records as `--private`) and `build-packet.mjs --seed 5700 --chunk 5`.

Reproduce, $0: `load-tracks.mjs` → `curve.mjs` → `ocr-score.mjs` → `lift.mjs` → `sizing.mjs price`. Paid stages (`pilot.mjs ocr|translate`) need a
`reocr-lift-5700` envelope (`set-scope.mjs --tag reocr-lift-5700 --books reocr-lift-5700 --budget N --lanes reocr-lift-5700`).
