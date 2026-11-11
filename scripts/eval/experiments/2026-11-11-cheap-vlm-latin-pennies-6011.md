---
stage: ocr
measure: accuracy
languages: [la]
scripts: [Latn]
canons: []
n_books: null
n_pages: 145
verdict: "No. GLM-5.3-Flash (0.926) and Qwen3.7-Flash (0.917) both read Latin print worse than Gemini 3 Flash (0.947 [0.937, 0.955]); neither comes within Flash's interval. The cheapest GLM endpoint invents text on 31 of 145 pages."
status: informational
decision: "None: a measurement, no routing change and no chart change (#6011)"
feeds: none
defect_rates: "none — CER against typed references only; nothing was judged for defects (an engine screen, no route compared)"
superseded_by: null
issue: 6011
---
<!-- PRIOR ART: 2026-10-07-ocr-engines-full-sets-wave2-6011.md (wave 2: the same Latin set, references, scorer and generic prompt; this adds two OpenRouter arms beside its engines). -->
## 2026-11-11 · The pennies test: do the cheapest Chinese vision models read Latin print as well as Gemini Flash? (#6011)

- **Question.** Two Chinese vision models now cost a few cents per million tokens on OpenRouter: `z-ai/glm-5.3-flash` and `qwen/qwen3.7-flash`. Do they read Latin print as well as Gemini 3 Flash, on wave 2's Latin panel?
- **Answer: no, neither does.**
  - GLM-5.3-Flash on Z.AI's own endpoint scores **0.926 [0.916, 0.936]**. Flash scores 0.947 [0.937, 0.955]. GLM is worse on 118 of 145 pages and better on 21. Its median page has 1.2 points more CER than Flash's, with interval [0.8, 1.8].
  - Qwen3.7-Flash scores **0.917 [0.907, 0.928]**. It is worse than Flash on 122 pages and better on 13, with a median of +2.2 points [1.5, 2.7].
  - Both land around last year's open 8B model (Qwen3-VL 8B, 0.922): under Flash-Lite (0.933), over DeepSeek-OCR (0.904).
- **The cheapest GLM endpoint does not read the page.**
  - At the brief's price ($0.04/M in), GLM-5.3-Flash is served only by Relace, and Relace takes no images: OpenRouter removes it for any image request. The cheapest endpoint that accepts images is Wafer (`wafer/us`, $0.042/M in, $0.184/M out).
  - On Wafer, **31 of the 145 pages produce text that does not align with the page's reference**. Two of them read by eye: one is fluent invented Latin on a page that the Z.AI endpoint transcribes correctly (the *Principia* preface), and the other replies "The image is too degraded to transcribe reliably."
  - Its median (0.900) hides this. Its mean accuracy is 0.717.
  - The same model on Z.AI's own endpoint misplaces 2 pages. So the cheap endpoint's deployment is at fault, not the model.
- **Cost:**
  - Qwen3.7-Flash: **$0.15 per 1,000 pages**.
  - GLM on Wafer: $0.35 per 1,000 pages.
  - GLM on Z.AI: $1.09 per 1,000 pages.
  - These are OpenRouter's billed `usage.cost`, over each arm's 158 pages. Wave 2 measured Sonnet at $16.18 per 1,000 Latin pages.
- **Measure:** accuracy, as 1 − median CER against the typed references, scored by `benchmark-score.mjs`. The interval is a page bootstrap of the median (B = 2,000), as in waves 1 and 2. Pages are paired: every engine is scored on the same 145 pages.
- **Grade:** confirmatory size (145 pages, 4 strata). It is **one run per arm**. Qwen's reads are not deterministic at temperature 0 (see Caveats), so a repeat would move its point a little. It would not close a 2-point gap whose paired interval excludes 0.
- **run_id:** `cheap-vlm-latin-6011-2026-11-11`.
- **Spend:** $0.26 on OpenRouter, probes included, against an estimate of $0.05 and a hard cap of $3. The estimate assumed Relace's price and Qwen's token count. The Z.AI control arm cost $0.17 of the total.

### Design

**Pages.** The pages are wave 2's Latin most-pages set (`/root/engine-wave2-6011/sets.json`, `latin`): 158 pages in four strata, `latin-period-5126` 82, `ref-ws` 53, `eebo-tcp-5488` 14 and `ref-pinned` 9. Every arm read all 158.

Wave 2's sharing rule was then applied. A page stays only where all seven wave-2 Latin engines aligned and none failed. That leaves **145 pages**; wave 2 had 147, and the re-score moved 2 ref-tier pages.

The new arms are scored on all 145:
- A read that cannot be aligned is text the engine produced for the page, so it counts as a scored 100 % error. This is the chart's rule.
- A failed read would be counted but not scored. None failed.

**Arms.** All three used the generic transcription prompt, `temperature: 0` and max_tokens 16,000. Each was pinned to one endpoint with no fallback, because endpoints of one model differ in price, quantisation and image handling.

| arm | endpoint | reasoning as run | why |
|---|---|---|---|
| `glm-5.3-flash` | Wafer `wafer/us` | `effort: minimal` | the cheapest image-capable endpoint; OpenRouter returns 400 "Reasoning is mandatory for this endpoint" when reasoning is disabled |
| `glm-5.3-flash-zai` | Z.AI `z-ai` (fp8, first party) | `effort: minimal` | control: the same model from its maker |
| `qwen3.7-flash` | Alibaba `alibaba` | `enabled: false`, accepted | the only base endpoint |

The reasoning tokens metered: GLM on Wafer 2,101 over 158 pages, GLM on Z.AI 143, Qwen 0.

**Comparators.** These are the wave-1/2 outputs already on this box, re-scored on this bench with the same scorer. Gemini 3 Flash's 14 EEBO texts are not on this box, so those 14 cells are the committed ones from `build-ocr-pareto.mjs --dump-rows`.

The re-score reproduces wave 2's published figures:

| engine | re-scored here | wave 2 |
|---|---|---|
| Flash | 0.947 [0.937, 0.955] | 0.947 [0.939, 0.955] |
| Sonnet | 0.940 [0.928, 0.949] | identical |
| Flash-Lite | 0.933 | 0.933 |
| Qwen3-VL 8B | 0.922 | 0.920 |

### Result: Latin print, 145 shared pages

| engine | accuracy [95 % CI] | mean acc. | CER > 0.5 | unaligned | vs Flash: worse / better, median ΔCER [CI] | $ / 1K pages |
|---|---|---|---|---|---|---|
| Gemini 3 Flash | **0.947 [0.937, 0.955]** | 0.945 | 0 | 0 | — | (wave 2) |
| Claude Sonnet 5.5 | 0.940 [0.928, 0.949] | 0.939 | 0 | 0 | | $16.18 (wave 2) |
| Gemini 3.1 Flash-Lite | 0.933 [0.926, 0.939] | 0.922 | 3 | 0 | | (wave 2) |
| Chandra OCR 2 | 0.933 [0.920, 0.941] | 0.931 | 0 | 0 | | $3.07 GPU (wave 2) |
| Mistral OCR 4.1 | 0.929 [0.916, 0.943] | 0.927 | 0 | 0 | | $4.00 (wave 2) |
| **GLM-5.3-Flash, Z.AI** | **0.926 [0.916, 0.936]** | 0.914 | 2 | 2 | 118 / 21, +0.012 [0.008, 0.018] | **$1.09** |
| Qwen3-VL 8B | 0.922 [0.915, 0.935] | 0.921 | 0 | 0 | | $1.78 GPU (wave 2) |
| **Qwen3.7-Flash** | **0.917 [0.907, 0.928]** | 0.905 | 2 | 2 | 122 / 13, +0.022 [0.015, 0.027] | **$0.15** |
| DeepSeek-OCR | 0.904 [0.893, 0.910] | 0.883 | 3 | 0 | | $0.85 GPU (wave 2) |
| **GLM-5.3-Flash, Wafer** | **0.900 [0.888, 0.911]** | **0.717** | **31** | **31** | 130 / 14, +0.025 [0.020, 0.035] | **$0.35** |

**Does either come within Flash's interval? No.**
- GLM on Z.AI scores 0.926 and its upper bound is 0.936, below Flash's lower bound of 0.937.
- Qwen3.7-Flash scores 0.917.
- Both paired intervals exclude 0.

**Loops and caps.**
- The scorer flagged no loops in any new arm.
- One Wafer GLM page hit the 16,000-token cap (`ws-la-nicolaus-machiavellus-de-principe-pdf-p17`, 29,990 characters). That page is outside the shared 145.
- No Z.AI GLM or Qwen read hit the cap.

**Median latency** per page, at concurrency 1–4:

| arm | median latency |
|---|---|
| Qwen3.7-Flash | 8.0 s |
| GLM on Wafer | 10.4 s |
| GLM on Z.AI | 14.0 s |

**Tokens per page.** GLM bills about 5,100 input tokens per page and Qwen about 2,100. Each emits about 650–720 output tokens.

### Caveats

- **Qwen3.7-Flash is not deterministic at temperature 0.** Three probes of one page returned three different transcriptions. They differed in long s against `f` and in the abbreviation marks (`quodq̃` / `quodq̄` / `quodç`).
- **Alibaba cuts some reads.** On 2 pages Alibaba stopped the output after about 200 tokens with finish `error` and billed $0. The same pages were re-asked once and were cut again. Under the shared failure rule (`scripts/lib/read-failure.mjs`), text cut short is a scored misread, and those 2 pages count against Qwen.
  - Separately, 13 calls got upstream 429 rate limits. Each was re-run at concurrency 1 and every page was read. One Z.AI call ended in `network_error` and was re-run.
- **The two GLM endpoints are one model.** The 0.926 / 0.900 split says the model's quality on OpenRouter depends on which endpoint serves it. A route that let OpenRouter pick the cheapest endpoint would get the Wafer numbers or worse; the cheapest endpoint, Relace, cannot take an image at all.
- **No production writes.** Mongo and page text were untouched, and `ocr-pareto.json` is unchanged: the brief asked for a measurement, not a chart point.

**Artifacts:** everything is in `results/cheap-vlm-latin-6011/`:
- `outputs-*.jsonl` and `meter-*.jsonl` per arm, including every 429 and cut-read row;
- `scored/`, the full re-score, comparators included;
- `panel.json`, the 145 shared pages and the per-engine figures.

The scripts are `cheap-vlm-latin-6011/build-bench.mjs` and `panel.mjs`. The runner support is `lib/runners.mjs` `openrouter/<id>` and `benchmark-run-api.mjs` `--effort` / `--provider`.
