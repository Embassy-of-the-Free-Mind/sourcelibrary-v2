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
- **Image and settings:** the image follows the prompt inline, `temperature 0` and `maxOutputTokens 16000`, with no media-resolution or safety override. This is what `benchmark-run-api.mjs` sends through `lib/runners.mjs` for the stored arms.
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

## Amendment 1 (2026-10-08, job `cli-queue-6293`): the one Gemini arm runs through the CLI

Committed before any CLI read of these pages exists. Everything above holds except what this section changes.

**Why.** On 2026-10-08 Derek ruled out paid Gemini calls for this work: every Gemini model except `gemini-3.1-flash-lite` runs through the subscription CLI (`agy -p`), with no API fallback. The two Batch jobs above were cancelled with every request still pending (unbilled). `agy` is now installed and signed in on the Hetzner box.

**Arm.** One model only: `gemini-3.8-flash-low` through `agy -p` (Antigravity CLI 1.3.1), on the same 908 pages (`pages.json` → `charts`), engine id `gemini-3.8-flash+antigravity-cli`, label "Gemini 3.8 Flash, CLI". 3.5 Flash-Lite, 3.6 and 3.7 Flash are **not run** in this job; their cost in calls and hours is reported so Derek can choose.

**Request: what is the same.** The same sealed JPEG bytes; the same prompt per stratum (production OCR v19.1, `content_hash 9d8f959e053491362b2c4acec1e20c9a`, on `latin-period-5126`; the generic transcription prompt elsewhere), byte for byte.

**Request: what differs (the route).**
- The image is attached as a file the CLI reads (`<prompt> @./<page>.jpg`, the #6295 export's command shape), not sent inline. How the CLI encodes it is not visible.
- The CLI exposes no temperature, output cap or thinking budget. It runs the model at its "low" thinking level; the API arms were preregistered at temperature 0, 16,000 output tokens, thinking budget 0.
- Calls run one at a time, up to 4 attempts in place when the CLI returns empty output with no error (it does so intermittently on a long prompt + image). Each attempt is logged to `/var/log/sourcelibrary/agy-calls.jsonl`.
- Gemini's safety filter can cut a read off part-way ("This request was blocked by Gemini's filters"): the message is stripped, the text before it is kept and scored as returned, and the page is counted. A read the filter left empty is a refusal under #5581 (meter `finishReason: SAFETY`).

**Transport check.** Not run: the CLI-vs-API equivalence check would need a paid API read of gemini-3.8-flash, which the rule forbids. The point is labelled as a CLI run on the chart and in the experiment file.

**Cost on the x axis.** $0 is billed. The CLI reports no tokens, so the point is placed at gemini-3.8-flash's API list price by the formula above with `r_in = 1` (the same request as lite's, prompt and image) and `r_out` = the arm's output characters over lite's stored output characters on the same pages; thinking is priced at 0, as the preregistered API arm would have run it. The chart's cost entry says "API price for comparison; $0 billed on the subscription".

**Scoring.** Unchanged: `benchmark-score.mjs` over the bench → `results/ocr-pareto-6293/scored`, `score-syriac-retest.py` → `results/ocr-pareto-6293/syriac-gt-score.json`, and `build-ocr-pareto.mjs` takes only `gemini-3.8-flash+antigravity-cli` from them. The paired comparisons with lite and 3 Flash are reported as preregistered.

## Amendment 2 (2026-10-09, job `cli-queue-b-6293`): 3.7 and 3.6 Flash through the CLI on a capped set of 555 pages

Committed 2026-10-09 ~02:40Z, before any score of these arms is computed or read. The reads ran as a plain script
(`read-tiers.sh`, started 2026-10-08 22:45Z; no scorer in the loop). Everything in Amendment 1 holds except what
this section changes.

**Arms.** `gemini-3.7-flash-low` (engine id `gemini-3.7-flash+antigravity-cli`, label "Gemini 3.7 Flash, CLI") and
`gemini-3.6-flash-low` (`gemini-3.6-flash+antigravity-cli`, "Gemini 3.6 Flash, CLI"), through `agy -p`, read in that
order. Same request per stratum as Amendment 1, byte for byte. Protocol from the first call: `--mode plan
--print-timeout 120s --output-format json`, never auto-approve; at most 2 attempts per page, the second continuing a
tool-denied conversation once with the "no commands" nudge (rows marked `nudged`); 2 image calls in parallel. 3.5
Flash-Lite is **not run: not offered on the CLI** (`agy models`, 2026-10-08 and 2026-10-09). 3 Flash is not offered
on the CLI either.

**Pages: 555, not 908 (the deviation).** Every chart's most-pages panel is whole except **Chinese manuscript: 150 of
its 503 pages**, `random.Random(62931).sample(sorted(pages), 150)` (`capped-set.json`, Derek 2026-10-08: cap the big
panel). On that chart the two arms cannot join the 489-page most-pages panel (wave-2 rule: a new arm feeds a panel
only where it read the whole set). Instead:
- **a separate panel, "Chinese manuscript, 150-page subsample"**, holds every engine that read all 150 pages (stored
  engines, 3.8 Flash CLI, 3.7, 3.6), each scored **on the same 150 pages** minus any page a plotted engine refused
  (#5581). Its n is stated on the panel and on every point. 150-against-503 comparisons are never made.
- The paired comparisons with lite and 3 Flash on that chart are on those shared pages only.

**3.8 Flash's 41 pre-fix reads are re-read under the plan-mode protocol** (`ref-ws` 18, `chinese-ext` 11,
`chinese` 7, `ref-pinned` 5; read with tools allowed before the #6345 fix). The plan-mode re-read replaces them on
the charts, so every CLI point on every panel comes from one protocol. The pre-fix reads stay in the raw file and
their CER is reported beside the re-read; a page the re-read leaves empty after 2 attempts is a blank read (CER 1.0
in the reference tiers, as Amendment 1's rule), never the old read.

**The nudge, before any point is charted.** Per arm and per panel: the nudged share, and median CER on nudged
against plain rows, each beside lite's median on the same rows. This is descriptive: a point is charted either way,
and the experiment file says where nudged rows score differently relative to lite.

**Scoring.** Amendment 1's instruments and its one added rule (an unalignable reference-tier page from a CLI arm is a
failed read at CER 1.0). Cost axis: `cli-cost.mjs` with the arm's model price from `model-pricing.mjs` (3.7 and 3.6
Flash are priced as 3.8, $0.75 / $3.75 per 1M), r_out per chart on the capped pages. $0 billed.

## Amendment 3 (2026-10-09, job `cli-effort-6293`): is the CLI gap on Latin and Early English the model, or the route and its effort level?

Committed and pushed 2026-10-09 before any call of these arms. Everything in Amendments 1 and 2 holds except what this
section changes.

**Question (Derek, 2026-10-09).** Through the CLI at "low", 3.8 Flash reads below 3 Flash (API) on Latin print (median
CER 0.083 against 0.056) and far below it on Early English (0.177 against 0.035), and 3.7 CLI is 0.043 on Early English.
#5924 had 3.8 Flash on the API tied best on Latin. Is the gap the model, or the CLI route and its effort level?

**Arms.** Both through `agy -p --mode plan --print-timeout 180s --output-format json`, never auto-approve, one page
per call, at most 2 attempts with the one-turn "no commands" nudge as before (`scripts/eval/run-cli-arm.py
--print-timeout 180`), up to 4 image calls in parallel, the two arms interleaved in time (each at 2 parallel, started
together) so neither arm owns a quieter hour.
- **C38H:** `gemini-3.8-flash-high`, engine id `gemini-3.8-flash-high+antigravity-cli`. New.
- **C38L-rep:** `gemini-3.8-flash-low`, engine id `gemini-3.8-flash+antigravity-cli-rep`. A fresh repeat of the stored
  C38 read (A-vs-A noise floor of the route). The only protocol difference from the stored read is the print timeout
  (180 s, was 120 s); the stored median call was 9 s, so it should rarely bind.

**Pages.** The Latin (147 frozen, 143 after #6304's drops) and Early English (44) most-pages sets in `pages.json`, 191
requests, the same sealed JPEGs and the same request per stratum, byte for byte (`requests.jsonl` of `cli-queue-6293`,
filtered to those uids). No other chart.

**Scoring.** Unchanged instruments: `import-cli-arm.py` into a copy of the bench, `benchmark-score.mjs`, rows from
`build-ocr-pareto.mjs --dump-rows`, so every row rule (#6304 drops, a CLI failed read = CER 1.0) is the chart's own.
Replies are scored **as returned**; the plan note stripped is a sensitivity only, as in Amendment 2.

**Reported per panel.** Median CER per arm with page-bootstrap 95 % CI. Paired, on the pages both answered: median Δ CER
(arm − other) with by-page bootstrap 95 % CI (2,000 resamples, seeded as `analyze-cli-tiers.py`), W/L/T and sign-test p,
for C38H vs stored C38, C38H vs 3 Flash, C38H vs lite, C38L-rep vs stored C38. Mean Δ with its bootstrap CI as a
secondary line (Early English failures are heavy-tailed). Per arm: nudged share, plan-note share, refusals (empty
safety-filter reads), empties after 2 attempts. For Early English, three pages where stored C38 scores badly, read
against the page image and labelled read-from-image, naming the cause (preamble, modernised spelling, truncation, other).

**Decision rule, per panel.**
- **Route/effort, not the model:** C38L-rep reproduces C38 (its paired median Δ CI against stored C38 contains 0) **and**
  C38H closes the gap (its paired median Δ CI against 3 Flash contains 0, or is below 0).
- **The model (at either effort):** C38L-rep reproduces C38 **and** C38H's CI against 3 Flash lies wholly above 0.
- **Run-to-run noise of the route:** C38L-rep does not reproduce C38 (CI excludes 0). Then the stored C38 point is
  itself not a stable measure, and the effort question is answered only by C38H vs C38L-rep, reported as such.
The verdict line names which branch each panel landed in. It is a statement about this route, these pages, this date.

**Chart.** C38H is added to the Latin and Early English charts only if it read each whole set (shared-page rule, a
refused or empty page counts as read). C38L-rep is a noise floor and is not charted as an engine.

**Not run.** 3.8 Flash on the API (paid; ruled out 2026-10-08), so route and effort cannot be fully separated: a C38H
that closes the gap shows effort is enough through this route, not that the API at low effort would also close it.
