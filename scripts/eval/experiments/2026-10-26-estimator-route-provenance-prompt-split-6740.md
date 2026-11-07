---
stage: ocr
measure: [none]
languages: []
scripts: []
canons: []
n_books: 134592
n_pages: 30569186
verdict: "With the prompt in a route's key, 8 of 36 production routes split on recorded prompts (14 if the top-level prompt_version labels are taken at their word), and 136 of the 2,090 did-not-read cells pooled more than one recorded prompt (72 of the 86 material ones are Flash-Lite OCR, v16 against v19.1). 85% of the pages in those cells have no prompt recorded at all."
status: informational
decision: "Estimator rows now carry provenance (provenance.mjs); v2/v3 adopt routeKey = engine x prompt id@version x read mode. No routing change, no production write."
superseded_by: null
issue: [6740]
---
PRIOR ART: `scripts/eval/experiments/2026-10-25-route-census-production-evidence-6740.md` — the same census keyed on
the stored engine only; this re-extracts it with each text's provenance. `scripts/lib/write-provenance.mjs` — the
page-side `engine` block read here.

## 2026-10-26 · Do estimator routes pool reads made under different prompts? (#6740)

Derek, 2026-10-26: "no data provenance on this? and the prompts used?" Every estimator row file keyed a route on the
engine name alone, and the v1 #4780 held-out miss was a prompt difference (no context line). Read-only on Mongo, no
model calls, $0.

**Design.** `route-census.mjs` (this PR) re-ran its `books` stage (134,592 books, 30.6M pages) grouping each book's
pages by the provenance of their text (`pages.<field>.engine.*`: prompt id, version, template hash, CLI, API, read
mode, job, code version), `revisions-prov` (every superseded read in `page_revisions`, grouped in Mongo) and `refs`.
`--stage=emit-prov` keys each cell engine × prompt id@version × read mode (`provenance.mjs routeKey`; CLI version,
job and code version are covariates) and writes `ocr/results/route-census-6740/prov/`. A route's prompt counts as
**recorded** when the page carries a `gemini-engine/1` (or specialist) block. A top-level `prompt_version` with no
engine block is kept as `label:<v>` and counted as not recorded: write-provenance.mjs rule 2 (a label is not a
record: realtime-ocr stamped `v5.2026-02` while sending the DB default). "Material" = a key holding ≥ 5% of a cell's
recorded pages.

**Routes that split** (field × engine with ≥ 20 pages, live + superseded): 36.
- On recorded prompts: **8 split, 2 materially**:
  - Flash-Lite OCR: 439K pages under v16 (`6a98b8a0…`), 307K under v19.1 (`6ac02220…`).
  - agy 3.8 Flash low OCR: 1,733 pages under the zh bake-off prompt (`paddle-zh-guarded-lane.mjs`), 1,066 under v19.1 (`cli-ocr.mjs`).
- With the labels taken at their word: **14 split, 11 materially**. Flash OCR shows 27 distinct labels; its top four
  (`v5.2026-02` 2.5M, `v5.1.2026-03` 0.98M, `12` 0.71M, `v3.2026-02` 0.18M) are 4.4M of its 4.8M pages.

**Pooled cells that mixed prompts** (the 2,090 live did-not-read cells of `failures.jsonl`):
- On recorded prompts: **136 mixed, 86 materially**. 72 of the 86 are Flash-Lite OCR (v16 + v19.1 in one cell; e.g.
  Latin before 1700 print, 216K pages: 93K v16, 81K v19.1). Flash translation has 6, Flash OCR 4, Flash-Lite
  translation 4.
- With labels: 1,001 mixed, 741 materially.

**Legacy share per cell** (pages with no recorded prompt ÷ pages): 1,489 cells fully legacy, 432 partly, 169 fully
recorded. Page-weighted: 85.1% (OCR 85.6%, translation 84.5%). By route:

| route | cells | pages | no prompt recorded |
|---|---|---|---|
| ocr gemini-3-flash-preview | 567 | 4.10M | 97.0% |
| translation gemini-3-flash-preview | 307 | 2.42M | 80.7% |
| translation gemini-3.1-flash-lite-preview | 319 | 2.17M | 99.9% |
| ocr gemini-3.1-flash-lite-preview | 264 | 1.75M | 100% |
| translation gemini-3.1-flash-lite | 182 | 1.17M | 64.2% |
| ocr gemini-3.1-flash-lite | 307 | 0.97M | 38.1% |
| ocr ia-ocr | 17 | 0.31M | 0% (the Archive takes no prompt: `n/a`) |

**Accuracy cells** (`ocr-table`, 29 chart × engine cells): one mixed. Latin × Flash-Lite has 18 reference pages read
under v19.1, 7 under v16 and 2 under labels. Pooled, its median CER mixes two prompts.

**Legacy experiment rows.** Every committed estimator row (5,316), and every row the builders write (today: 20,966
translation page rows, 126 cell means, 11,934 OCR Pareto rows), is labelled `legacy-not-recorded` plus what its experiment's own files state (`provenance-legacy.json`, 316
entries, each read from the file named). Pooling under one engine id with different prompts is common there too:
- Translation arm `O` (Opus) covers at least five setups (context request, v13 no-context, 10 pages per call in #6559).
- xlref L31/FP arms had the previous page in t1/t3/t4 and not in t2/t5 (the #4780 shape).
- Flash-Lite OCR appears under v16 (gate-4763), v19.1 (gate-7341, #6544), v10/12 (reocr-5700) and the generic
  Pareto prompt.
- `#6560` / `#6561` sources pool a correct arm (image + draft) with a re-read arm (image) under one engine.

**Replicated?** No: one census on 2026-10-26.

**Artifact.** `scripts/eval/estimator/ocr/results/route-census-6740/prov/`:
- `failures-prov.jsonl.gz`: 3,981 rows, 601 with the prompt recorded.
- `ocr-table-prov.jsonl`: 597 rows.
- `reads-prov.jsonl`: 179 route keys, live + superseded.
- `splits.json.gz`: the report above, per route and per cell.

Raw run: `/root/jobs/estimator-provenance-6740/run/` on gex45.
