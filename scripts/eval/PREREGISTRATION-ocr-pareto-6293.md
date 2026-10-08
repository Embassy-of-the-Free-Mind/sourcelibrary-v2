# Preregistration: newer Gemini arms and the small-engine gaps on the OCR Pareto charts (#6293)

PRIOR ART: `PREREGISTRATION-engine-wave2-6011.md` (#6011 wave 2). That run fills each chart's most-pages panel with six engines, using the same pages, scorer and Pareto feed. Its rules govern wherever this file is silent. `pareto-6182/run-arms.mjs` (#6182) is the Batch submit/collect/meter shape for the new Gemini models, including the thinking setting each one accepts.

This file is committed and pushed **before any arm reads a page**. Job `ocr-pareto-6293`. Benchmark only: no production writes, Mongo read-only, no routing change.

## Question

Readers of `/quality/pareto` choose an OCR engine per script. Two kinds of engine are missing there:
- the newer Gemini models (3.5 Flash-Lite, 3.6 Flash, 3.7 Flash, 3.8 Flash);
- the cheap self-hosted engines (PaddleOCR-VL 1.6, olmOCR 2 7B, Surya 2), which are missing from the largest panels.

Where do they land on the same pages, with the same references and the same scorer? The answer informs one decision: whether any of them should replace `gemini-3.1-flash-lite` as the default OCR lane for a script. That decision is not taken here.

## Pages (not drawn)

The pages are each chart's most-pages panel as it stands on `0a3a4ab3a`, from `node scripts/eval/build-ocr-pareto.mjs --dump-sets`. They are frozen in `results/ocr-pareto-6293/pages.json` as page keys only; no reference text is committed. The union is 908 pages.

| chart | pages | strata |
|---|---|---|
| Latin print | 147 | latin-period-5126 82, ref-ws 45, eebo-tcp-5488 14, ref-pinned 6 |
| Early English print | 44 | eebo-tcp-5488 44 |
| other Latin-script | 23 | ref-ws 23 |
| Greek | 127 | greek-ext 95, ref-ws 13, greek 11, greek-ext2 8 |
| Chinese manuscript | 503 | chinese-cohort-5547 432, chinese-ext 50, chinese 21 |
| Chinese print | 19 | chinese-ext 12, chinese 7 |
| Armenian | 5 | ref-pinned 5 |
| Syriac manuscript | 40 (2 manuscripts) | syriac-gt 40 |

Every arm reads the sealed JPEG bytes that every charted engine read (≤ 2400 px, the trees wave 2 read).

## Part A: Gemini arms

**Route.** The issue asks for the subscription CLI first (`agy -p`, #6277), with a 20-page CLI-vs-API equivalence check. The CLI is not installed on the Hetzner box this job runs on. So, by the issue's own fallback, every arm goes through the **Batch API**. No CLI arm is run.

**Arms:** `gemini-3.8-flash`, `gemini-3.5-flash-lite`, `gemini-3.7-flash` and `gemini-3.6-flash`, submitted in that order, one Batch job per model. 3.8 goes first because it is the model the issue asks for most; 3.5 Flash-Lite goes second because it is the direct cheap rival to production lite.

**Request.** The charted Gemini points (lite and 3 Flash) were read with one request per stratum. The new arms send that same request, so each new point differs from lite and Flash only in the model:
- **Prompt:**
  - `latin-period-5126` (82 pages): the production OCR prompt v19.1, `content_hash 9d8f959e053491362b2c4acec1e20c9a`. It is the live default today, loaded through `lib/production-prompt.mjs`, and the run stops if the hash differs.
  - Every other stratum: the generic transcription prompt of `benchmark-run-api.mjs`.
- **Image and settings:** the image follows the prompt inline, `temperature 0` and `maxOutputTokens 8000`, with no media-resolution or safety override. This is what `lib/runners.mjs` sent for the stored arms.
- **Thinking**, as production's OCR request sets it (`OCR_GENERATION_CONFIG`, `thinkingBudget: 0`):
  - 3.6, 3.7 and 3.8 Flash take budget 0.
  - 3.5 Flash-Lite refuses budget 0 (400, probed 2026-10-07 in #6182). It gets `thinkingLevel: 'minimal'`, its lowest setting; its thinking tokens are metered and priced.

This deviates from the issue's "production's OCR request" on prompt and temperature: production sends v19.1 to every script, at temperature 0.1. The charted lite and Flash points did not, so sending production's request would change two variables at once. The deviation is stated in the PR and on the chart's source note.

**No refusal retry.** The stored generic-prompt arms had none. A refused page is a refusal. Under the chart's existing rule (#5581), a page any plotted engine refused leaves that panel's shared set. The number of pages each arm removes is reported.

**Transport check (Batch vs the stored realtime read).** `gemini-3.1-flash-lite` is re-read through the same Batch path on 40 seeded pages (`pages.json` → `transport_check`, `random.Random(6293)`, Syriac excluded). The check passes if the Batch read's median CER is within 1 pp of the stored lite read on the pages both answered, 1 pp being the eval-design §10.2 minimum CER effect, **and** the bootstrap 95 % CI of the paired median Δ includes 0. If it fails, the new points are still plotted, and the PR and the experiment file say that the transport differs.

**Noise floor.** No new A-vs-A arm is bought. The floor quoted beside each paired number is the chart's existing lite repeat (`gemini-3.1-flash-lite-b`) where the stratum has one: Latin (`ref-ws` and `latin-period-5126`), Greek and Chinese. Elsewhere it is said to be missing.

**Cost on the x axis (Batch, production-equivalent).** Lite and 3 Flash are placed at their metered production Batch rate (`ocr-cost-2026-10-06.json`: lite 3,736 in and 1,082 out tokens per page, $1.279 per 1,000 pages). The benchmark pages mostly carry the short generic prompt, so a raw $/page from this run would sit about 1.7× under those points for reasons that have nothing to do with the model. Each new arm is therefore placed at:

> `usd_per_1k = 1000 × ½ × [ 3,736 × r_in × price_in + 1,082 × r_out × price_out ] / 1e6`

- `r_in` and `r_out` are the arm's metered input and (output + thinking) tokens over lite's stored tokens, on the same pages under the same request.
- Prices come from `scripts/lib/model-pricing.mjs`; ½ is `BATCH_MULTIPLIER`.

The raw metered Batch $/1,000 pages of this run is reported beside it. The entry goes into `ocr-engine-gpu-costs.json` with a new basis, `metered-batch`, quoted from the experiment file the way every other entry there is quoted.

**Spend:** cap **$8** on the Gemini API. The estimate uses each page's own stored lite tokens, repriced at Batch, ≈ $6.49 for the four arms plus ≈ $0.03 for the transport check. Before each submit, spent + this job's estimate must be ≤ $8, or the arm is not run and is reported unrun. Every job is metered to `gemini_usage` (endpoint `eval/ocr-pareto-6293`) and registered in `batch_jobs` as `external_eval`, as #6182 did.

## Part B: self-hosted engines on the gaps

Before this job, stored outputs on these 908 pages were checked in two places:
- the benchmark trees and `results/**/outputs-*.jsonl`;
- Mongo `page_revisions`, by `source`, for the 776 pages that have a library page id.

All stored PaddleOCR-VL, olmOCR, Surya and dots.mocr outputs on these pages are already scored. `page_revisions` holds only Gemini reads of them. **So nothing is free to score, and every gap needs a GPU.**

Pages each engine still needs to cover a chart's whole panel:

| engine | Latin 147 | English 44 | Greek 127 | zh-ms 503 | zh-print 19 | Armenian 5 | Syriac 40 |
|---|---|---|---|---|---|---|---|
| PaddleOCR-VL 1.6 | 88 | done | done | done | done | 5 | 40 |
| olmOCR 2 7B | 88 | done | done | 503 | 19 | 5 | 40 |
| Surya 2 | 96 | 44 | 103 | 482 | 12 | done | 40 |

Other Latin-script (23) is already covered by all three.

**Arms.** Each engine's recipe and prompt are unchanged from the run that put it on the charts:
- PaddleOCR-VL: `#5660`, layout ON;
- olmOCR: `#5660` Amendment 1;
- Surya 2: bench 2, 2026-09-03.

Their output goes through the same normalisation that run applied before scoring. dots.mocr and MinerU have no measured cost, so the charts list them unplaced. They are placed only if this job measures their cost on these pages with the recipe that produced their stored output. If that recipe does not run inside the cap, they stay listed as unplaced, with the reason.

**GPU rule (the brief's).** The estimate is posted on #6293 before renting. **≤ $10:** one GPU under `gpu-lease-watchdog.mjs`, with the job under `scripts/gpu/idle-poweroff.sh run --`, and the server deleted at the end with its 404 confirmed. **More than $10:** a `DECISION:` line, and only the free work proceeds.

**Cost on the x axis.** The charts keep each engine's existing entry in `ocr-engine-gpu-costs.json`, as wave 2 did. This run's measured $/page is reported beside it, and a difference over 25 % is said in the PR.

## Scoring (unchanged instruments)

- **Sealed strata and the `ref-ws` / `ref-pinned` tiers:** `benchmark-score.mjs --root=<bench> --out=scripts/eval/results/ocr-pareto-6293/scored`. The bench holds the chart engines' stored outputs for the same pages, as in waves 1 and 2. Normalisation, reference window and mismatch guard are unchanged. Chinese cohort references are unpacked before scoring; the wave-2 caveat applies.
- **Syriac:** `benchmark/syriac-retest/score-syriac-retest.py` with `SYRIAC_IMAGES` and `SYRIAC_SCORE_OUT` → `results/ocr-pareto-6293/syriac-gt-score.json`.
- **Pareto feed:** `build-ocr-pareto.mjs` reads `ocr-pareto-6293/scored` and the Syriac file after the wave-2 sources, taking only this job's engines. Earlier sources win any duplicate page × engine. As in wave 2, a new arm feeds a chart only where it read that chart's whole most-pages set; a refused or empty page counts as read.
- **Reported per chart:**
  - the most-pages panel before → after: engines placed and n;
  - each new arm's accuracy (1 − median CER) with its 95 % CI;
  - frontier membership;
  - the paired comparison with lite and with 3 Flash: wins/losses/ties, median Δ with bootstrap CI and sign-test p, on pages both answered;
  - refusals, empty pages and loops per arm;
  - the five worst pages per new arm on the three confirmatory-size charts (Latin, Greek, Chinese manuscript), read by eye against the image.

## What this decides

Nothing in production. A new arm that beats lite on a chart beyond the floor, at a cost it can carry, becomes a proposal on its own issue (eval-design §10), quoting this run's panel, n and date.
