<!-- PRIOR ART: 2026-10-06-untried-ocr-engines-wave1-6011.md (wave 1: the same six engines on a seeded 6–60 pages per script, paired against the chart engines). This entry fills each chart's most-pages panel; it asks no new paired question. -->
## 2026-10-07 · Do the wave-1 OCR engines hold their place on each chart's FULL page set? (#6011, wave 2)

- **Question.** Each chart on `/quality/pareto` has a big "most-pages" panel. Before this run, those panels plotted only the two Gemini engines, plus PaddleOCR or olmOCR on some scripts, because wave 1 read 6–60 pages per script. Wave 2 ran the wave-1 engines on the rest of every chart's most-pages set. Where do they land with tight intervals?
- **Answer.**
  - **Five of the six engines now sit in every big panel they could reach.** Placed engines per panel went 2 → 7 on Latin, 3 → 8 on Chinese manuscript, 4 → 8 on Greek, 5 → 10 on other Latin-script, 2 → 6 on Syriac and 8 → 9 on Chinese print. The exceptions are Opus, which was unaffordable this wave, Sonnet on Greek and Syriac, and Armenian, where the new engines' output mostly cannot be aligned to the reference.
  - **No new engine joins a frontier except DeepSeek-OCR**, and DeepSeek joins only as the cheapest, least accurate point, on Latin, Chinese manuscript and Syriac.
  - **Gemini 3 Flash** is the top of every Latin-script and Greek panel.
  - **Qwen3-VL 8B** ties PaddleOCR-VL on Chinese manuscript at three times the cost: 0.817 [0.801, 0.831] against 0.817 [0.804, 0.833], on 503 pages.
  - **Claude Sonnet 5.5** is second only to Flash on Latin (0.940 against 0.947, 147 pages). It costs six times as much.
  - **On Syriac, all four open/API engines score 0**, against Flash at 0.233 and Kraken Sophro at 0.624 (no cost measured for Sophro). They loop or emit a different script.
- **Wave 1 replicates.** Each engine's position relative to Flash and Flash-Lite is the same on the full sets as on wave 1's subsets:
  - **Chinese manuscript:** Qwen is better than Flash and Flash-Lite. Its CER was 0.175 on 60 pages and is 0.183 on 503.
  - **Latin:** Sonnet is just under Flash.
  - **Greek:** Chandra, Mistral and Qwen are far under Flash-Lite.
- **Measure:** accuracy, as 1 − median CER against typed references. It is computed by `benchmark-score.mjs`, and Syriac by `score-syriac-retest.py`, the same scorers and references as the charts. Every panel compares engines only on the pages every plotted engine read.
- **Grade:**
  - **Confirmatory-size panels:** Latin (147), Greek (127) and Chinese manuscript (503).
  - **Directional:** other Latin-script (23) and Chinese print (19).
  - **Exploratory:** Armenian (5). Syriac has 40 pages but only 2 manuscripts.
- **run_id:** `engine-wave2-6011-2026-10-07`.
- **Spend: $10.77** against a hard cap of $50:
  - **Mistral:** $2.64 for 661 pages.
  - **Sonnet:** $4.36 for 578 pages.
  - **GPU:** $3.77 for the whole H100 lease, 1.12 h.

  The H100 `37176570` and its volume were deleted, and Scaleway returns 404.
- **Decision:** none in production; the charts change. Opus, and Sonnet on Greek and Syriac, wait for OpenRouter credit or a working Anthropic key (#6011).

### Design (preregistered `PREREGISTRATION-engine-wave2-6011.md`, `3aaf314c0`, pushed before any arm read a page)

**Pages.** For each chart, the pages are its most-pages panel before this wave (`build-ocr-pareto.mjs --dump-sets`), minus the pages each engine read in wave 1. `engine-wave2-6011/build-bench.mjs` builds this set; the result is in `results/engine-wave2-6011/selection.json`:

| engine | pages read |
|---|---|
| DeepSeek-OCR, Qwen3-VL 8B, Chandra 2 | 661 each |
| Mistral OCR 4.1 | 661 |
| Sonnet 5.5 | 578 of the 745 it needed |
| Opus 5.5 | 0 of 835 |

**Arms** were wave 1's, unchanged: same models, revisions, prompts and runners.
- The GPU engines ran on one leased Scaleway H100-1-80G in pl-waw-2, on vLLM 0.31.0, now pinned in `engine-wave1-box.sh`.
- DeepSeek-OCR failed to start on vLLM 0.31's V2 model runner, as in wave 1. It ran on the V1 runner with its n-gram processor, and that recipe is now encoded in `engine-wave1-box.sh`.

**The Claude constraint.** The Anthropic key returns 401, and OpenRouter held $5.25 at the start. By the preregistered rule, Sonnet ran chart by chart, cheapest first, and only where it could finish the chart while keeping a $1 floor. That covered Armenian, Chinese print, other Latin-script, Latin and Chinese manuscript. Greek and Syriac were skipped. Seven pages hit OpenRouter's 402 for credit reserved by in-flight requests and were re-run at concurrency 1. Opus did not run.

### Result: most-pages panel per chart, before → after

| chart | before: placed (+ no cost), n | after: placed (+ no cost), n | frontier after |
|---|---|---|---|
| Latin print | 2, n = 158 | **7, n = 147** | DeepSeek-OCR, Flash-Lite, Flash (none drawn before: 2 engines) |
| Early English print | 9, n = 44 | 9, n = 44 (unchanged; wave 1 already covered it; Opus unrun) | PaddleOCR-VL, olmOCR, Flash, Sonnet |
| other Latin-script | 5 (+1), n = 23 | **10 (+1), n = 23** | PaddleOCR-VL, olmOCR, Flash-Lite, Flash |
| Greek | 4 (+1), n = 127 | **8 (+1), n = 127** | PaddleOCR-VL, olmOCR, Flash-Lite, Flash |
| Chinese manuscript | 3, n = 503 | **8, n = 503** | DeepSeek-OCR, PaddleOCR-VL |
| Chinese print | 8, n = 19 | **9, n = 19** | DeepSeek-OCR, PaddleOCR-VL, Flash |
| Armenian | 3 (+1), n = 5 | 4 (+1), n = 5 | Surya 2, Flash-Lite, Flash |
| Syriac manuscript | 2 (+4), n = 40 | **6 (+4), n = 40** | DeepSeek-OCR, Flash-Lite, Flash (none drawn before) |

Accuracy, with the 95 % CI, on the after panels:

| chart | engine | accuracy [95 % CI] |
|---|---|---|
| Latin (147) | Flash | 0.947 [0.939, 0.955] |
| | Sonnet | 0.940 [0.928, 0.949] |
| | Flash-Lite | 0.933 [0.925, 0.939] |
| | Chandra | 0.933 [0.922, 0.941] |
| | Mistral | 0.929 [0.916, 0.943] |
| | Qwen | 0.920 [0.915, 0.933] |
| | DeepSeek | 0.904 [0.893, 0.911] |
| Greek (127) | Flash | 0.923 [0.906, 0.935] |
| | Flash-Lite | 0.878 [0.841, 0.893] |
| | Chandra | 0.750 [0.718, 0.793] |
| | Mistral | 0.747 [0.703, 0.798] |
| | Qwen | 0.712 [0.679, 0.774] |
| | olmOCR | 0.564 |
| | PaddleOCR-VL | 0.520 |
| | DeepSeek | 0.121 [0, 0.446] |
| Chinese manuscript (503) | PaddleOCR-VL | 0.817 [0.804, 0.833] |
| | Qwen | 0.817 [0.801, 0.831] |
| | Flash | 0.798 [0.782, 0.816] |
| | Chandra | 0.790 [0.775, 0.808] |
| | Sonnet | 0.782 [0.755, 0.804] |
| | Flash-Lite | 0.742 [0.720, 0.761] |
| | Mistral | 0.736 [0.719, 0.756] |
| | DeepSeek | 0.571 [0.528, 0.609] |
| Syriac (40) | Flash | 0.233 [0.145, 0.330] |
| | Mistral | 0.036 |
| | Flash-Lite | 0.009 |
| | DeepSeek, Qwen, Chandra | 0 |

The Kraken Syriac models were unchanged and still have no measured cost.

**Failure counts** for the wave-2 pages, excluding Syriac:

| engine | catastrophic (CER > 0.5) | loops | empty | unaligned, ref tiers |
|---|---|---|---|---|
| DeepSeek-OCR | 243 / 621 | 147 | 31 | 10 |
| Mistral | 37 | 7 | 1 | 5 |
| Sonnet | 27 / 578 | 0 | 0 | 2 |
| Qwen | 19 | 9 | 0 | 12 |
| Chandra | 12 | 0 | 0 | 3 |

No engine refused a page.

**Syriac, all 40 pages:** every engine scored at or above CER 0.5 on all 40 pages. The loop counts were DeepSeek 26, Qwen 22, Chandra 16 and Mistral 33.

**Measured cost, this wave.**

| engine | $ / 1,000 pages | basis |
|---|---|---|
| Sonnet 5.5 | **$12.32 per 1,000 pages** on Chinese print | metered, 19 pages |
| Sonnet 5.5 | $16.18 on Latin | metered |
| Sonnet 5.5 | $5.12 on Chinese manuscript | metered |
| Sonnet 5.5 | $14.89 on other Latin-script | metered |
| Mistral | $4.00 | metered |
| DeepSeek-OCR | $0.85 | billed lease, split by inference time |
| Qwen | $1.78 | billed lease, split by inference time |
| Chandra | $3.07 | billed lease, split by inference time |

The API rates are within 25 % of wave 1. The GPU rates are 11–59 % under wave 1's ($0.96 / $3.43 / $7.55), because this page mix is two-thirds short Chinese leaves. As preregistered, the charts keep wave 1's figures, plus the one new Sonnet figure for Chinese print, where wave 1 had none.

### Caveats

- **Latin 158 → 147.** In the `ref-ws` / `ref-pinned` passage tiers, a page where an engine's text cannot be aligned to the passage reference is coverage, not a CER. On 11 Latin tier pages at least one new engine could not be aligned: DeepSeek 8, Qwen 7, Chandra 3, Mistral 3, Sonnet 1. Those pages leave the shared set.
- **Armenian.** Most new engines could not be aligned on these 5 pages: Qwen on 0 of 5, DeepSeek and Mistral on 3, Sonnet on 4. Only Chandra joins the panel.
- **Baseline check.** Re-scoring the chart engines' outputs on the wave-2 pages reproduced 2,665 of 2,681 committed cells, and Syriac lite 40 of 40. The exceptions:
  - one EEBO lite output, the same later-run file wave 1 found;
  - 15 `ref-ws` cells on 6 German pages. On three of them every engine re-scores 0.004–0.031 CER lower now. The new engines on those pages are therefore scored against a slightly more favourable alignment than the committed comparators: 3 of 23 pages, at most 0.03.
- **Chinese cohort references** are bundled (`refs/chinese-cohort-5547.refs.jsonl`). They must be unpacked before scoring. Left packed, the scorer silently scores all 432 pages against the proxy engine instead of the reference: the first scoring attempt here did exactly that.

**Replicated?** Yes, in rank order on every script both waves read; see the Answer.

**Artifacts:**
- `results/engine-wave2-6011/`: `selection.json`, `outputs-*.jsonl`, `meter-*.jsonl`, `scored/`, `syriac-gt-score.json`, `gpu-box-raw.json`;
- `src/data/ocr-pareto.json`;
- `PREREGISTRATION-engine-wave2-6011.md`.
