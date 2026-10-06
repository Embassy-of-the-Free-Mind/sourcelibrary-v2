# Preregistration — wave 1 of the untried OCR engines, on the chart's own pages (#6011)

PRIOR ART: the #6011 pricing comment (2026-10-06) lists what has run where: DeepSeek-OCR, Mistral OCR (July version), Claude Sonnet 5 and Qwen-VL-plus on the 44-page `dataset/v0.3` set; Chandra v1 by eye on Chinese woodblock; the CLLG Qwen3-VL-8B fine-tune on Greek. None ran on the sealed per-script strata behind the Pareto charts (#5983, PR #6003). `.claude/docs/eval-design.md` §7 (paired by default) and §10.2 (decision cards) govern; the #5984 rubric doc (PR #6002) has not merged, so this follows `eval-design.md`.

Committed and pushed **before any arm reads a page**. Job `engine-wave1-6011`, Derek approved 2026-10-06 ("do it"), est. $27, **hard stop $30** for the whole job.

## Question

On the same pages and references as the engines already on the Pareto charts, how accurate are DeepSeek-OCR, Qwen3-VL-8B-Instruct, Chandra OCR 2, Mistral OCR 4.1, Claude Opus 5.5 and Claude Sonnet 5.5, how often do they fail catastrophically, invent, or refuse, and what does a page cost? **Benchmark only: nothing is written to production and no routing changes.** The output is evidence for wave 2 (issue comment) and points on the charts.

## Pages (385, one per book, drawn before any arm ran)

Built by `scripts/eval/engine-wave1-6011/build-bench.mjs`, seed **6011** (Mulberry32(6011·100 + salt) Fisher–Yates over the sorted slug pool). Pools are the referenced pages of the chart's own committed scored file for each stratum. The drawn slugs are in `results/engine-wave1-6011/selection.json`.

| script | stratum | pool → drawn | reference | chart comparators (committed per-page CER) |
|---|---|---|---|---|
| Latin print | `latin-period-5126` | 82 referenced, not the "corrected-OCR reference" rows → **60** (salt 1) | CAMENA / EEBO-TCP / la.wikisource, same edition, leaf-checked | lite, flash-preview (production prompt v19.1) — `latin-period-5126-2026-10-04.json` |
| Early English | `eebo-tcp-5488` | 72 → **60** (salt 2) | EEBO-TCP keyed text | lite, flash-preview — `eebo-tcp-5488-2026-10-01.json`; PaddleOCR-VL from `open-engine-print-5660/scored` |
| Greek | `greek` + `greek-ext` | 11 (all) + 117 → 49 (salt 4) = **60** | First1KGreek / Perseus / el.wikisource | lite, flash-preview, Kraken CLLG (+ CLLG Qwen3-VL-8B, dots, Surya, Tesseract on `greek`) |
| Chinese woodblock / canon | `chinese` + `chinese-ext` (woodblock class) | 28 (all) + 12 (all) = **40** | Kanripo / CBETA | lite, flash-preview, PaddleOCR-VL (+ NDL, dots, Surya, Tesseract on `chinese`) |
| Chinese manuscript | `chinese-cohort-5547` (manuscript-regular) | 433 → **60** (salt 7) | Kanripo Siku Quanshu witnesses | lite, flash-preview, PaddleOCR-VL |
| Tibetan | `tibetan-kangyur-4523` (new registry) | 100 bl-kanjur pages of the 2026-10-01 redraw → **60** (salt 8) | Derge Kangyur e-text (OpenPecha P000001), window located per engine | BDRC Yigdzin (the served read) |
| Sanskrit, Persian, Arabic, Hebrew | `a5-nonlatin-5700` (new registry) | every #5695 track page in these languages with a by-eye corrected transcription: **41** (Skt 14, Fa 10, Ar 11, He 6) | corrected served OCR (#5695) | flash-preview re-read (#5700 A5, production prompt v19.1); the served OCR |
| Hebrew (pinned) | `ref-pinned`, the 4 Hebrew pages | **4** | pinned passage-level ground truth | lite, flash-preview |

Grades (§10.2): every per-script cell is **directional** at most (≤ 60 books), and Tibetan / A5 are **exploratory** per language (< 30). The A5 reference was made by correcting the served OCR, so it **favours the engine that made that OCR**; this is said wherever an A5 number appears.

Baseline check, $0, before any arm: re-scoring the chart engines' on-disk outputs on the drawn pages with the current scorer reproduces the committed per-page CER on 764 of 766 page × engine cells; the two exceptions are EEBO lite outputs on this box that come from a later run than the committed file, so **EEBO comparisons use the committed per-page CER**, never the on-disk text.

## Arms

All arms read identical JPEG bytes from one bench root (`/root/engine-wave1-6011/bench`, max width 2400 px as sealed). Every call is metered (`_meter.jsonl`: tokens incl. thinking, $, finish reason, ms).

| # | arm (engine name) | how | prompt | pages |
|---|---|---|---|---|
| 1a | `deepseek-ocr` | `deepseek-ai/DeepSeek-OCR` (MIT) on vLLM, Scaleway L4 | its native plain-OCR prompt `<image>\nFree OCR.` | 385 |
| 1b | `qwen3-vl-8b` | `Qwen/Qwen3-VL-8B-Instruct` (Apache-2.0) on vLLM, same L4, temperature 0 | the generic transcription prompt of `benchmark-run-api.mjs` | 385 |
| 1c | `chandra-ocr-2` | `datalab-to/chandra-ocr-2` (OpenRAIL-M; research use) on vLLM, same L4 | its own OCR prompt from the `chandra-ocr` package; HTML output reduced to text | 385 |
| 2 | `mistral-ocr-4-1` | Mistral `/v1/ocr`, model `mistral-ocr-4-1` | none (endpoint ignores prompts) | 385 |
| 3 | `claude-opus-5-5` | Claude Opus 5.5, effort `low` (thinking cannot be disabled on this model; its tokens are metered and counted in $/page), no sampling params | generic transcription prompt | Greek, Chinese woodblock, Tibetan, A5 + pinned Hebrew (205) |
| 4 | `claude-sonnet-5-5` | Claude Sonnet 5.5, thinking `between_tools` (= off), no sampling params | generic transcription prompt | Latin, early English, Chinese manuscript (180) |

The generic prompt is: *"Transcribe ALL text visible in this image using the appropriate Unicode script. Output ONLY the raw text. No commentary, no translation, no labels, no markdown."* The chart's lite/flash arms on Latin, EEBO and A5 ran the production prompt v19.1; the rest ran this generic prompt. That difference is recorded per cell, not corrected for.

**No refusal fallback** on the Claude arms: a fallback would let another model answer and the arm would no longer be that model. A refused page is a refusal. One retry on a transport error (not on a refusal). If the Anthropic key is unusable the Claude arms go through OpenRouter (`anthropic/claude-opus-5.5`, `anthropic/claude-sonnet-5.5`, provider pinned to Anthropic, no provider fallback); the route is recorded per call.

No A-vs-A repeat arm is bought for the new engines (it would double the spend). The noise floor quoted beside every paired number is the chart's existing lite A-vs-A (`gemini-3.1-flash-lite-b`) where the stratum has one (Latin, Greek, Chinese), and is said to be missing elsewhere.

## Scoring (fixed now)

- **Scorer:** `benchmark-score.mjs` (CER on letters after its normalisation; CJK on Han + kana with the kyūjitai fold; Greek strata on Greek letters only), reference window and mismatch guard unchanged. One change, for the new `a5-nonlatin-5700` stratum only: letters and tokens **keep combining marks** (`\p{M}`), because Devanagari vowel signs and virama, Arabic and Hebrew points are marks and the Latin rule drops them and splits a Devanagari word at every matra. Every existing stratum scores byte-identically (checked above).
- **Tibetan:** `kanjur_align.py score` (syllable Needleman–Wunsch identity against the best-retrieved Derge window, as the 2026-09-30 and 2026-10-01 draws). Reported as identity (higher is better) and, for the chart, `1 − identity`. A page where **no** engine, Yigdzin included, reaches identity 0.5 is off-index (the e-text does not hold the text) and is excluded and listed.
- **Shared pages only.** A paired comparison of arm X with comparator C uses the pages where the reference is valid in both the committed file and this run (`has_ref` in both), and both X and C answered (neither refused, both present). A new engine's page that only it reached is never compared.
- **Paired statistic:** per page Δ = CER(C) − CER(X) (positive = X better). Reported: wins / losses / ties (|Δ| ≤ 0.001 is a tie), median Δ with a **seeded percentile bootstrap 95 % CI over pages** (2,000 resamples, seed 6011), and the two-sided sign test p. Primary comparator per script: **flash-preview** (the chart's best general engine) and **lite** (production); others reported descriptively.
- **Accuracy per arm:** median CER (refusal = 1.0) and median CER over answered pages, on the arm's referenced pages, with bootstrap CI.
- **Catastrophic:** CER > 0.5 on a referenced page (a refusal counted separately, not as catastrophic).
- **Invention:** the scorer's `invention_ref` — share of the arm's content tokens (words ≥ 4 letters; CJK 3-grams) absent from the reference; median per arm. An **invented page** is one where the by-eye check finds text that is not on the image (a known passage recited in place of the page, a translation, a hallucinated line); counted from the by-eye sample only and reported as k of n read.
- **Refusals:** an empty answer with a refusal finish reason (Claude `stop_reason: refusal`; Gemini RECITATION etc.; Mistral and the GPU arms have none, so an empty output there is `empty`, not refused), from the meter. Counted per arm as k of n; never a misread.
- **Loops:** the scorer's loop flag, counted.
- **$/page, measured:** API arms = metered $ ÷ pages answered (realtime list prices: Opus 5.5 $4/$20 per MTok, Sonnet 5.5 $2/$10, Mistral OCR $4/1K pages; where OpenRouter bills, its `usage.cost` per call wins). GPU arms = the whole billed lease (€0.79/h L4, at $1.16/€, setup and idle included) split across the three engines by their measured inference wall-time, ÷ 385; inference-only $/page also given.
- **By eye:** at least 20 pages, **one per book**, each read from the image (not from the reference), chosen as the largest paired wins and losses of the new arms against flash-preview across scripts (at least one per script). For each: which read is closer to the image, and whether any arm invented text. A reference error found this way is reported, never silently fixed.

## Spend and stop

Spend is logged on #6011 after each arm. Before each arm the projection (spent + metered rate × pages left + the GPU lease still to run) is recomputed; **if it passes $30 the job stops** and the unrun arms are reported unrun. The Claude arms run with a `--cap` so they cannot pass their share. The GPU lease is tagged `lease-until` (8 h hard cap) under `gpu-lease-watchdog.mjs`, the job runs under `scripts/gpu/idle-poweroff.sh run --`, and the server is **deleted** at the end and its absence confirmed on the Scaleway API.

## What this decides

Nothing in production. It places the arms on the Pareto data (`results/engine-wave1-6011/scored`, fed to `build-ocr-pareto.mjs`) and names the wave-2 candidates by the issue's own conditions (Qwen3-VL-32B only if the 8B beats lite on Chinese; GPT-astra only where Opus or Sonnet shows a gain; a Chandra production lane would need the licence question settled).
