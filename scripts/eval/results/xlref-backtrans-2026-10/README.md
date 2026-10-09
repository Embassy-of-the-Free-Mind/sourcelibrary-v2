# xlref-backtrans — reference-free detectors against the judges' labels (#5695 extra test)

The write-up is `scripts/eval/experiments/2026-10-03-reference-free-reversal-detectors-5695.md`. Short version: the
detectors cannot screen the library. The best one (D3, direct contradiction check, Flash-Lite) has recall 83 % [70–91]
on judged reversals at precision 18 % [15–22], flagging 50 % of pages.

| file | what |
|---|---|
| `set.jsonl` | 150 served pages (47 with a judged reversal + 103 random others), source, our English, the judges' labels, `weight` for the case-control reweighting, `order` (first 60 = stop-rule sample). No reference text. |
| `set-summary.json` | the 434-page universe by track and language |
| `raw/d3.jsonl`, `raw/d2-back.jsonl`, `raw/d2-check.jsonl` | one model output per line (per page); `*-plant.jsonl` are the planted-control runs; `raw/plants.json` is the key; `raw/cost.json` the spend |
| `results.json` | every detector × target, by track and by language, AUCs, the planted control, cost, and `per_page` |
| `results-first60.json` | the same on the first 60 pages (the stop rule) |
| `d1-latin-check.json` | the $0 Latin negation check (20 pages, then the whole Latin track) |
| `gallery.md` | 5 catches, 5 false alarms, 5 misses, read by eye |

Rebuild: `build-set.mjs` → `run-detectors.mjs` → `score.mjs` in `scripts/eval/translation-vs-reference/backtrans/`
(usage in each file's header). T1 and T4 inputs came from PR branches #5721 and #5735 (`--t1-dir`, `--t4-dir`).
