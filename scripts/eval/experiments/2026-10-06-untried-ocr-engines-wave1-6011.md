<!-- PRIOR ART: the #6011 pricing comment lists every earlier run of these engines (the 44-page dataset/v0.3 set in July: Sonnet 5, Mistral OCR July, Qwen-VL-plus, DeepSeek-OCR on Replicate; Chandra v1 by eye; the CLLG Qwen3-VL-8B fine-tune on Greek). None ran on the sealed strata behind the Pareto charts (#5983). -->
## 2026-10-06 · Six untried OCR engines on the Pareto charts' own pages: does any of them beat Gemini? (#6011, wave 1)

- **Question.** The Pareto charts (#5983) compare engines we have tried. Do the untried ones do better on the same pages and references? Six were tested: DeepSeek-OCR, Qwen3-VL-8B-Instruct, Chandra OCR 2, Mistral OCR 4.1, Claude Opus 5.5 and Claude Sonnet 5.5. For each we measured accuracy, catastrophic pages, invention, refusals and the cost of a page. This was a benchmark only: nothing was written to production.
- **Answer.** **No arm beats Gemini 3 Flash outside the margin on any script.** Three arms beat production Flash-Lite clearly:
  - **Qwen3-VL-8B on Chinese manuscript.** 49 wins / 5 losses against lite, median Δ CER +0.025 [0.017, 0.033]. Against flash: 34 / 15, +0.011 [0.000, 0.017]. It costs **$3.43 per 1,000 pages** self-hosted.
  - **Claude Opus 5.5 on Greek.** 53 / 5 against lite, +0.025 [0.011, 0.036]. It ties flash (30 / 23, +0.001 [−0.001, 0.005]).
  - **Claude Sonnet 5.5 on early English.** 45 / 5 against lite, +0.014 [0.005, 0.027]. It ties flash (27 / 11 / 22 ties, +0.000).

  Where the reference was weak or absent, these results hold: nothing general-purpose comes near BDRC Yigdzin on Tibetan (best: Opus at identity 0.715 against 0.949). Chandra 2, DeepSeek-OCR and Mistral OCR 4.1 lose to lite almost everywhere except early English. Opus and Qwen both **invent** Tibetan, and Mistral invented a page tail by eye.
- **measure:** accuracy. CER is measured against typed references with `benchmark-score.mjs`. Tibetan is measured as syllable identity against the Derge e-text (`kanjur_align.py`). Every comparison is **paired on shared pages** against the committed per-page CER of the chart's engines. **Grade:** directional at most (≤ 60 books per script). The Sanskrit, Persian, Arabic and Hebrew cells are exploratory (9–14 pages per language).
- **run_id:** `engine-wave1-6011-2026-10-06`.
- **Spend: $18.41** against an estimate of $27 and a hard stop of $30.
  - Mistral: $1.54.
  - Sonnet: $2.21.
  - Opus: $10.06.
  - GPU: $4.60 for the whole H100 lease, 1.37 h.
- **Decision:** none in production. The wave-2 conditions are set out below, and the decisions go to Derek on #6011.

### Design (preregistered `PREREGISTRATION-engine-wave1-6011.md`, `595eaf33a`, pushed before any arm ran; amendment 1 also before)

**Pages.** 385 pages, one per book, drawn with seed 6011 from the referenced pages of each chart stratum (`engine-wave1-6011/build-bench.mjs`, `results/engine-wave1-6011/selection.json`):

| script | pages | stratum |
|---|---|---|
| Latin print | 60 | `latin-period-5126` |
| Early English | 60 | `eebo-tcp-5488` |
| Greek | 11 + 49 | `greek` + `greek-ext` |
| Chinese woodblock / canon | 28 + 12 | `chinese` + `chinese-ext` (woodblock class) |
| Chinese manuscript | 60 | `chinese-cohort-5547` |
| Tibetan | 60 | new registry `tibetan-kangyur-4523`: 60 of the 100 Kangyur pages of the 2026-10-01 redraw |
| Sanskrit / Persian / Arabic / Hebrew | 14 / 10 / 11 / 6 | new registry `a5-nonlatin-5700`: every #5695 track page with a by-eye corrected transcription |
| Hebrew (pinned) | 4 | the pinned Hebrew pages |

**Baseline check, $0.** Re-scoring the chart engines' outputs on these pages with the current scorer reproduced the committed per-page CER on **764 of 766 cells**. The two exceptions are EEBO lite texts on Hetzner that come from a later run. Pairing therefore always uses the committed CER.

**Arms**, all reading identical JPEG bytes (max 2,400 px):

| arm | how it ran | prompt | pages |
|---|---|---|---|
| DeepSeek-OCR | vLLM 0.31, n-gram anti-repeat processor (V1 runner) | `Free OCR.` | all 385 |
| Qwen3-VL-8B-Instruct | vLLM 0.31 | the benchmark's generic transcription prompt | all 385 |
| Chandra OCR 2 | vLLM 0.31, the vendor's own client and prompt; HTML → text, headers kept | vendor prompt | all 385 |
| Mistral OCR 4.1 | `/v1/ocr` endpoint | none | all 385 |
| Claude Opus 5.5 | effort `low` | generic | Greek, Chinese woodblock, Tibetan, Sanskrit/Persian/Arabic/Hebrew (205) |
| Claude Sonnet 5.5 | effort `low` | generic | Latin, early English, Chinese manuscript (180) |

The three self-hosted models ran on one leased Scaleway H100-1-80G; their model revisions are in `results/engine-wave1-6011/gpu-box.json`. Both Claude arms ran through OpenRouter, with the provider pinned to Anthropic and no fallback.

**Comparators.** The chart's own committed results: flash-preview and lite, plus PaddleOCR-VL and others where the chart has them. For A5 the comparators are flash-preview (#5700 re-read) and the served OCR. For Tibetan, the comparator is Yigdzin.

**Statistics.**
- Paired Δ = CER(comparator) − CER(arm), so a positive Δ means the arm is better.
- Results are reported as wins / losses / ties, with a median Δ and a seeded bootstrap 95 % CI.
- Catastrophic means CER > 0.5. Invention = `invention_ref`, the share of the arm's words that are absent from the reference.
- No A-vs-A arm was bought for the new engines. The chart's lite A-vs-A is the only noise floor available.

**Deviations from the priced plan** (amendment 1, all made before any arm read a bench page):
- **Claude went through OpenRouter.** The Anthropic key on Hetzner returns 401.
- **Sonnet ran adaptive thinking at effort `low`.** OpenRouter will not disable reasoning. Sonnet used 0 thinking tokens, and Opus used 1,481 across all its pages.
- **The GPU was an H100, not an L4.** L4s were in "shortage" in every zone.
- **DeepSeek-OCR needed three attempts.**
  - vLLM 0.31's V2 runner rejects its n-gram processor.
  - The plain serve hits a Triton bug.
  - The first V1-runner run sent `max_tokens` 8,192, which exceeds the model's 8,192 context, and every page returned HTTP 400.
  - It finally ran on the V1 runner with the processor and `max_tokens` 7,000.

### Result: accuracy (median CER on answered referenced pages, 95 % CI; paired against the chart's committed CER)

| script | arm | median CER | catastrophic | invention | vs flash-preview W/L/T, Δ [CI] | vs lite W/L/T, Δ [CI] |
|---|---|---|---:|---:|---|---|
| **Latin** (60) | flash-preview | 0.072 [0.061, 0.080] | 0 | | | |
| | lite | 0.081 [0.076, 0.087] | 1 | | | |
| | Sonnet 5.5 | 0.087 [0.079, 0.101] | 0 | 0.16 | 16/44/0, −0.013 [−0.020, −0.006] | 24/33/3, −0.001 [−0.012, 0.002] |
| | Chandra 2 | 0.091 [0.084, 0.097] | 0 | 0.17 | 12/45/3, −0.017 | 16/42/2, −0.007 [−0.014, −0.002] |
| | Qwen3-VL-8B | 0.099 [0.085, 0.110] | 0 | 0.24 | 8/52/0, −0.027 | 9/51/0, −0.013 |
| | Mistral 4.1 | 0.105 [0.093, 0.116] | 0 | 0.20 | 6/53/1, −0.027 | 13/46/1, −0.018 |
| | DeepSeek-OCR | 0.121 [0.110, 0.135] | 2 | 0.34 | 0/60/0, −0.048 | 4/55/1, −0.038 |
| **Early English** (60) | flash-preview | 0.043 [0.036, 0.051] | 5 | | | |
| | lite | 0.057 [0.052, 0.073] | 1 | | | |
| | **Sonnet 5.5** | **0.042 [0.032, 0.047]** | 0 | 0.04 | 27/11/22, +0.000 [0.000, 0.001] | **45/5/10, +0.014 [0.005, 0.027]** |
| | Chandra 2 | 0.042 [0.034, 0.051] | 0 | 0.05 | 13/36/11, −0.001 | 36/17/7, +0.007 [0.000, 0.023] |
| | Mistral 4.1 | 0.047 [0.041, 0.056] | 0 | 0.06 | 18/37/5, −0.002 | 37/19/4, +0.003 [0.000, 0.019] |
| | Qwen3-VL-8B | 0.050 [0.040, 0.056] | 0 | 0.08 | 13/41/6, −0.004 | 36/19/5, +0.008 [0.000, 0.018] |
| | DeepSeek-OCR | 0.074 [0.061, 0.087] | 1 | 0.18 | 7/52/1, −0.018 | 19/40/1, −0.006 |
| **Greek** (60) | flash-preview | 0.085 [0.064, 0.110] | 0 | | | |
| | lite | 0.119 [0.098, 0.160] | 0 | | | |
| | **Opus 5.5** | **0.082 [0.064, 0.096]** | 1 | 0.11 | 30/23/7, +0.001 [−0.001, 0.005] | **53/5/2, +0.025 [0.011, 0.036]** |
| | Chandra 2 | 0.260 | 3 | 0.50 | 0/60/0, −0.100 | 0/60/0, −0.080 |
| | Mistral 4.1 | 0.260 | 2 | 0.47 | 2/57/1, −0.107 | 1/57/2, −0.093 |
| | Qwen3-VL-8B | 0.298 | 4 | 0.52 | 0/60/0, −0.141 | 0/60/0, −0.120 |
| | DeepSeek-OCR | 0.678 | 38 | 0.73 | 0/60/0, −0.540 | 0/60/0, −0.454 |
| **Chinese woodblock / canon** (40) | flash-preview | 0.180 [0.139, 0.229] | 0 | | | |
| | lite | 0.207 [0.149, 0.316] | 2 | | | |
| | Qwen3-VL-8B | 0.164 [0.133, 0.227] | 0 | 0.09 | 21/12/7, +0.003 [0.000, 0.010] | 29/5/6, +0.017 [0.008, 0.030] |
| | Opus 5.5 | 0.171 [0.137, 0.214] | 0 | 0.13 | 17/11/12, +0.000 [0.000, 0.005] | 25/8/7, +0.008 [0.000, 0.026] |
| | Chandra 2 | 0.180 | 0 | 0.13 | 10/22/8, −0.004 | 25/9/6, +0.007 |
| | Mistral 4.1 | 0.256 | 1 | 0.24 | 2/37/1, −0.048 | 8/30/2, −0.023 |
| | DeepSeek-OCR | 0.374 | 17 | 0.26 | 0/38/2, −0.135 | 4/33/3, −0.092 |
| **Chinese manuscript** (60) | flash-preview | 0.196 [0.160, 0.267] | 1 | | | |
| | lite | 0.255 [0.176, 0.338] | 6 | | | |
| | **Qwen3-VL-8B** | **0.175 [0.150, 0.244]** | 3 | 0.09 | **34/15/11, +0.011 [0.000, 0.017]** | **49/5/6, +0.025 [0.017, 0.033]** |
| | Chandra 2 | 0.207 | 2 | 0.17 | 18/30/12, −0.003 | 34/16/10, +0.007 [0.000, 0.015] |
| | Sonnet 5.5 | 0.226 | 8 | 0.16 | 15/34/11, −0.006 | 31/19/10, +0.006 [0.000, 0.016] |
| | Mistral 4.1 | 0.241 | 6 | 0.27 | 3/55/2, −0.045 | 16/41/3, −0.015 |
| | DeepSeek-OCR | 0.435 | 27 | 0.26 | 1/55/4, −0.206 | 9/49/2, −0.112 |

**Sanskrit, Persian, Arabic, Hebrew (A5; exploratory, 9–14 pages each).** The reference is the served OCR corrected by eye, so it **favours the engine that made the served OCR**. The by-eye checks found two concrete cases of this, set out below.
- **Opus 5.5** is level with flash-preview on Sanskrit (6/6/2) and Persian (median CER 0.080 for both). It is behind on Arabic (2/9) and ahead on Hebrew (8/2, +0.032).
- **Chandra 2 and Mistral 4.1** are behind flash on every one of the four languages.
- **Qwen3-VL-8B and DeepSeek-OCR** fail on all four (median CER on Hebrew 1.0).

  Four of the 41 A5 references cover less than 60 % of what the complete readers transcribe; the served OCR had dropped an apparatus or a column. Excluding those four changes no sign: Opus vs flash on Sanskrit is 5/5, Δ 0.000, and on Arabic 1/8, −0.023.

**Tibetan** (60 Kangyur manuscript pages, syllable identity against Derge, higher is better; no page was off-index):

| arm | median identity [CI] | pages < 0.5 | vs Yigdzin W/L/T, Δ [CI] |
|---|---|---:|---|
| BDRC Yigdzin (served) | 0.949 [0.932, 0.968] (the 10-01 redraw: 0.947) | 0 | |
| Claude Opus 5.5 | 0.715 [0.680, 0.785] | 4 | 6/54/0, −0.191 [−0.257, −0.144] |
| Mistral OCR 4.1 | 0.564 [0.468, 0.646] | 25 | 3/57/0, −0.365 |
| Qwen3-VL-8B | 0.032 | 58 | 0/60/0 (loops) |
| Chandra 2 | 0.000 | 60 | 0/60/0 (describes the leaf in English instead of transcribing it) |
| DeepSeek-OCR | 0.000 | 60 | 0/60/0 (loops one syllable cluster) |

**Refusals.** No arm returned a stated refusal on any page.
- **Four Claude calls ended with an API-side `invalid_request_error`**, unbilled: three Opus, one Sonnet. One came back empty (a Herodotus page; the preregistered retry reproduced it) and three were cut off part-way. They are scored as delivered and counted here. This is not a misread and not a stated refusal.
- **Flash-preview's committed outputs are empty on 5 EEBO pages** (CER 1.0; likely unrecorded RECITATION, since the 10-01 run kept no meter). Those pages are where Sonnet, Chandra and DeepSeek record "wins" of about 0.95 over flash.

### Result: cost per page, measured

The table below gives the cost per page of each arm. In each row the measured rate is the first figure.

| arm | $ per 1,000 pages | basis |
|---|---|---|
| DeepSeek-OCR | DeepSeek-OCR **$0.96 per 1,000 pages** (H100 billed share; $0.82 inference only) | whole lease, split by inference time |
| Qwen3-VL-8B | Qwen3-VL-8B **$3.43 per 1,000 pages** (H100 billed share; $2.92 inference only) | same |
| Chandra 2 | Chandra 2 **$7.55 per 1,000 pages** (H100 billed share; $6.41 inference only) | same, long Tibetan retries |
| Mistral OCR 4.1 | Mistral OCR 4.1 **$4.00 per 1,000 pages** realtime | metered, list price |
| Claude Sonnet 5.5 | Sonnet 5.5 **$16.89 per 1,000 pages** on Latin, **$15.27** on early English, **$4.62** on Chinese manuscript | metered realtime (OpenRouter usage.cost) |
| Claude Opus 5.5 | Opus 5.5 **$43.65 per 1,000 pages** on Greek, **$17.20** on Chinese print, **$75.81** on Tibetan, **$49.12** on A5 | metered realtime |
| for scale | lite $1.28 and flash-preview $2.71 per 1,000 (metered Batch, `ocr-cost-2026-10-06.json`) | |

All the API rates are realtime; Batch would halve the Claude and Mistral lines. The GPU rates are for an H100 at €2.87/h. An L4, as priced, would be slower per page and cheaper per hour.

Sonnet 5.5 bills about 1,100 image tokens on Chinese manuscript pages and 2,900 on Latin ones, so the API downsizes some pages more than others.

### By eye (20 pages, one per book, each read from the image; `results/engine-wave1-6011/by-eye.jsonl`)

The pages were chosen as each script's largest paired wins and losses. The closer read was flash on 8 pages, Opus on 6, Sonnet on 1, Qwen on 1, Yigdzin on 1 and a tie on 2; on 1 page the reference itself was defective.

**Invented text.** Six arms invented text on the pages read by eye, counting each arm once:
- **Flash-preview:** on a Hebrew commentary it replaced "כלומר גם עליו גם" with the next words of Genesis 27:1.
- **Mistral:** it appended a count from 一 to 一百 to a Chinese leaf.
- **Opus:** it wrote fluent Kangyur-style Tibetan that is not on the leaf (identity 0.26).
- **Qwen:** it loops on Tibetan and on Hebrew.
- **Chandra:** it added niqqud to an unvocalised Hebrew manuscript.
- **DeepSeek:** it loops on Sanskrit.

**Failure modes that look like misreads but are not:**
- Qwen read a 180°-rotated Chinese leaf backwards.
- Sonnet read a Siku leaf left-to-right.
- Qwen dropped the lower half of the second column of a Latin folio.
- Mistral dropped the first hemistich of every couplet on a Persian page.

**The reference was the problem on 2 of the 20 pages:**
- On an Arabic page, Opus reproduces the print's typo (لأنشي) and its partial vowelling. The served-OCR-derived reference and flash both normalise them, so Opus is scored down for being faithful.
- On a Sanskrit critical-edition page, the reference omits the whole apparatus.

**The Greek win is real reading.** Opus reads the ligatured 16th-c. Greek of Victorius as printed (δοκίμου), not as Aristotle's vulgate (δοκεῖ που).

**Sonnet's Latin gap is mostly one error class.** It writes f for every long s (prifca ftirpe). The scorer folds ſ but cannot fold f.

### What this means for wave 2 (the issue's own conditions)

- **Qwen3-VL-32B on an H100.** The condition was "only if the 8B beats lite on Chinese". **It does**, on manuscript (49/5) and on woodblock / canon (29/5), at about $3 per 1,000 pages self-hosted. It does not yet beat flash outside the CI. The 32B is the natural next arm, together with an orientation check, since a 180° leaf defeats it.
- **GPT (astra).** The condition was "only on strata where Opus or GPT sol show a gain". Opus gains over **lite** on Greek but only **ties flash**, at 16 times flash's cost. Whether "a gain" means over the production engine or over the best engine is Derek's call.
- **Tibetan.** Nothing general-purpose is close to Yigdzin, and both Claude and Qwen invent on these leaves. Do not route Tibetan to any of these engines.
- **Chandra 2.** It is not better than lite outside English and Chinese. Its research-licence threshold makes it moot as a production lane for now.

**Replicated?** No. The DeepSeek-OCR and Mistral results agree in sign with the July `dataset/v0.3` runs (both below lite on Latin print).

**Artifacts.**
- Code: `scripts/eval/engine-wave1-6011/` (`build-bench.mjs`, `analyze.mjs`, `bundle-outputs.mjs`) and `scripts/gpu/engine-wave1-{scw.sh,box.sh,run.py}`.
- Results, all in `results/engine-wave1-6011/`:
  - `outputs-<engine>.jsonl` and `meter-<engine>.jsonl`;
  - `scored/` (fed to the Pareto charts);
  - `summary.json`, `tibetan-scores.jsonl`, `by-eye.jsonl`, `gpu-box.json` and `selection.json`.
- Registries: `benchmark/{a5-nonlatin-5700,tibetan-kangyur-4523}.json` and the 41 A5 references.
- Scaleway server `bfd082e0` was deleted with its volume; the provider confirmed 404.
