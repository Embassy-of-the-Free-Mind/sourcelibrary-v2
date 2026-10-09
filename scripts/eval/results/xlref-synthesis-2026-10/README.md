# #5695 synthesis — served English against published human translations, all tracks

Write-up: `scripts/eval/experiments/2026-10-04-translation-vs-reference-synthesis-5695.md`.

- `build.mjs` reads each track's per-page rows (`xlref-t1..t5-2026-10/`) and recomputes the served-arm figures with one set of definitions (in its header). No model calls.
- `summary.json`: per track and per language: n, mean with bootstrap interval, median, share ≥ 4 with Wilson interval, reversal pages per 100, omission share, the three defect classes with a major defect on the most pages, the paired Flash − Lite difference, and the six-dimension profile where the track stored it per page (T1, T3, T5).
- `served-pages.jsonl`: one row per served page (321).

`measure`: judged against a human reference (two blind Opus judges). It is not accuracy.

T4's rows are in PR #5735. Until it merges, run `node build.mjs --t4 <path to its pages.jsonl>`; the committed outputs were built that way.
