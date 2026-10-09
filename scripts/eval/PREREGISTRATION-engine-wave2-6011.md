# Preregistration — wave 2 of #6011: the wave-1 engines on every chart's FULL most-pages set

PRIOR ART: `PREREGISTRATION-engine-wave1-6011.md` (wave 1, PR #6027): the arms, prompts, runners, GPU driver, scorer and pairing rules are **reused unchanged** and govern wherever this file is silent. Wave 1 ran the six engines on a seeded 6–60 pages per script. As a result, every chart's big "most-pages" panel on `/quality/pareto` (#5983, `build-ocr-pareto.mjs`) still shows only the two Gemini engines (or adds PaddleOCR / olmOCR). The greedy panel builder keeps an engine there only if it read at least half the production engine's pages.

Committed and pushed **before any wave-2 arm reads a page**. Job `engine-wave2-full-6011`. Derek approved it on 2026-10-07 ("yes i do"), with a **hard cap of $50** across GPU, Mistral and OpenRouter.

## Question

Wave 1 asked how each engine compares to Gemini. This wave asks nothing new about that. It fills each chart's most-pages panel, so the frontier there is drawn from every engine on the same pages with tight intervals. **Benchmark only: no production writes, Mongo read-only, no routing change.**

## Pages (not drawn: each chart's most-pages panel as it stands before wave 2)

`node scripts/eval/build-ocr-pareto.mjs --dump-sets=<file>` writes each chart's most-pages page keys (`stratum|slug`). These come from the committed `ocr-pareto.json` inputs as of `765908652`. From each engine's list, `engine-wave2-6011/build-bench.mjs` removes every page that engine already read in wave 1 (any output row in `results/engine-wave1-6011/outputs-<engine>.jsonl`); those wave-1 scores are reused. The list is in `results/engine-wave2-6011/selection.json`. The images are the sealed ones that wave 1 and the charts read: the same trees and the same 2400 px rule.

Pages still to read, per chart × engine:

| chart (most-pages n) | DeepSeek-OCR | Qwen3-VL 8B | Chandra 2 | Mistral 4.1 | Sonnet 5.5 | Opus 5.5 |
|---|---|---|---|---|---|---|
| Latin print (158) | 88 | 88 | 88 | 88 | 88 | 158 |
| Early English (44) | 0 (done) | 0 | 0 | 0 | 0 | 44 |
| other Latin-script (23) | 23 | 23 | 23 | 23 | 23 | 23 |
| Greek (127) | 83 | 83 | 83 | 83 | 127 | 83 |
| Chinese manuscript (503) | 422 | 422 | 422 | 422 | 443 | 482 |
| Chinese print (19) | 0 (done) | 0 | 0 | 0 | 19 | 0 (done) |
| Armenian (5) | 5 | 5 | 5 | 5 | 5 | 5 |
| Syriac (40 pages, 2 manuscripts) | 40 | 40 | 40 | 40 | 40 | 40 |
| **per engine** | 661 | 661 | 661 | 661 | 745 | 835 |

**No engine × script pair is skipped as unreadable.**
- Wave 1 ruled pairs out only on Tibetan (the open VLMs about 0). Tibetan is not a chart, so it is not in this wave.
- Wave 1 saw Qwen and DeepSeek fail on the A5 scripts (Sanskrit, Persian, Arabic, Hebrew). None of those is a chart either.
- Armenian and Syriac were never tried by any wave-1 engine. On the GPU engines a failing read costs only seconds of a lease already paid for. A failed engine placed on the chart is itself the finding: it is plotted with its measured cost, like the Kraken arms.

## Arms

These are wave 1's arms, unchanged:
- The same model ids and revisions: DeepSeek-OCR `9f30c71f`, Qwen3-VL-8B-Instruct `0c351dd0`, Chandra OCR 2 `af93b47d`.
- The same prompts: DeepSeek `Free OCR.`, Chandra's own, and the generic transcription prompt for Qwen, Mistral and Claude.
- The same settings. Claude runs via OpenRouter, pinned to Anthropic with no fallback, adaptive thinking at effort `low`, and no refusal fallback. GPU engines read at temperature 0 on vLLM, with DeepSeek on the V1 runner, max_tokens 7,000, plus its n-gram processor.

The runners are wave 1's as well:
- `benchmark-run-api.mjs --slugs=todo-<engine>.txt --cap=<usd>` for Mistral and Claude.
- `scripts/gpu/engine-wave1-scw.sh` + `engine-wave1-box.sh` + `engine-wave1-run.py` for the GPU engines. They run on one leased Scaleway **H100-1-80G (pl-waw-2)**, which is the wave-1 recipe and, at €2.87/h, the GPU with the best measured throughput per € for these three. The lease is taken under `gpu-lease-watchdog.mjs` with a **4 h** lease and a **$15** driver cap. The job runs under `idle-poweroff.sh run --`, and the server is **deleted** at the end with its 404 confirmed.

## The Claude constraint, known before any arm ran

The `ANTHROPIC_API_KEY` on Hetzner still returns 401, re-checked at the start of this job. OpenRouter, the wave-1 route, holds **$5.25** of credit (`/api/v1/credits`: 20 total, 14.75 used). The full Claude plan needs about $7.4 for Sonnet and about $22 for Opus. So:

- **Opus 5.5 does not run in this wave** unless the credit is topped up or the Anthropic key is fixed. The order would then be the brief's cut order: Latin, Greek and Chinese manuscript first, then the rest. This is reported as a decision for Derek, not worked around: no other paid route was approved.
- **Sonnet 5.5 runs chart by chart, cheapest first, and only on a chart it can finish.** The order is Armenian, Chinese print, other Latin-script, Latin, Chinese manuscript. The rates per page are wave 1's metered rates: $0.017 for Latin print, $0.0046 for Chinese manuscript, and about $0.02 assumed elsewhere.
  - A chart starts only if (credit left − $1.00 floor) ≥ 1.2 × its projected cost. The floor is kept for other sessions that use the same key.
  - Greek (≈ $2.9) and Syriac (≈ $0.8) come after that, credit permitting.
- **A Claude arm that does not finish a chart is not fed to the chart.** The panel builder would otherwise keep an engine that covers half the pages and shrink the panel to those pages. Its outputs and scores stay in `results/engine-wave2-6011/` and are reported, but `build-ocr-pareto.mjs` takes wave-2 rows for an engine × chart only where that engine now covers the chart's whole most-pages set. The same rule holds for every engine; an empty or refused page still counts as read.

## Scoring (unchanged)

- **Sealed strata and the `ref-ws` / `ref-pinned` tiers:** `benchmark-score.mjs --root=<bench> --out=scripts/eval/results/engine-wave2-6011/scored`. The bench holds the chart engines' outputs for the same pages, as in wave 1. The scorer, normalisation, reference window and mismatch guard are unchanged.
- **Syriac:** `benchmark/syriac-retest/score-syriac-retest.py`, the scorer behind the chart's Syriac points: CER under N2, against the published PAGE-XML ground truth. It runs with two new environment overrides, `SYRIAC_IMAGES` and `SYRIAC_SCORE_OUT`; unset, its behaviour is unchanged. Output goes to `results/engine-wave2-6011/syriac-gt-score.json`, and the committed retest file is not touched.
- **Pareto feed:** `build-ocr-pareto.mjs` reads `engine-wave2-6011/scored` and the Syriac file after the wave-1 directory, takes only the six wave-1 engines, and lets earlier sources win any duplicate. Costs per 1K pages stay wave 1's measured figures, in `ocr-engine-gpu-costs.json`; they are not re-derived from this wave.
  - **Check:** the measured $/page of this wave's GPU lease and API meters is reported beside them. If it differs from wave 1's by more than 25 %, that is said in the PR.
- **Per chart, reported in the PR and on #6011:**
  - the most-pages panel before → after: engines placed, n pages;
  - each engine's median CER with its CI;
  - frontier membership and any change in it;
  - refusals, empty pages and loops per arm.

## Spend and stop

**Projection:**

| item | projected |
|---|---|
| H100, about 2.3 h | ≈ $8, driver cap $15 |
| Mistral, 661 pages × $0.004 | $2.64 |
| Sonnet | ≤ $4.25 (the credit less the floor) |
| Opus | $0 unless credit appears |
| **total** | **≤ $22**, cap $50 |

**Spend log:** posted on #6011 at the start, mid-run and at the end.

**Stop rule:** before each arm, the projection is recomputed as spent + metered rate × pages left + the GPU lease still to run. If it would pass $50, the job stops and the unrun arms are reported unrun.

## What this decides

Nothing in production. It completes the most-pages panels. Any frontier change is reported per chart, with its n.
