# Preregistration — which engine reads the SKQS manuscript backlog (#5660, job gpu-backlog-5660)

Written 2026-10-06, before any engine in this study read a page. Pushed before scoring.

## Question

The Chinese first-OCR backlog in scope is ≈ 450K never-read pages of Siku Quanshu (四庫全書) hand copies
(class `manuscript-regular`, #4743). The plan is Paddle (#5600's fleet recipe). Before the fleet scales,
is there an engine that reads these pages **clearly better** than Paddle, at a price worth a separate decision?

`measure: accuracy` — CER against an independent typed reference (Kanripo WYG / CBETA) for the same leaf.

## Pages

- Pool: the sealed `chinese-cohort-5547` registry (`scripts/eval/benchmark/chinese-cohort-5547.json`), pages with
  `cohort = held`, by-eye class `manuscript-regular` (`benchmark/script-class/chinese-cohort-5547.jsonl`) and a
  reference in `benchmark/refs/chinese-cohort-5547.refs.jsonl` (built by `benchmark-refs.mjs --wide`): 264 pages, one per book.
- **Minus the 200 pages the #5600 optimization study used** (`results/paddle-zh-5600/sample.json`, `sample-fresh.json`
  on branch `job-nolayout-5600e`). Those pages chose Paddle's serving configuration; re-using them would favour Paddle.
- Draw **50** with `makeRng(5660)`, slug-sorted pool, without replacement. One page per book by construction.
- Images: the sealed JPEGs in `/root/ocr-bench/images/chinese-cohort-5547/` (≤ 2400 px wide). Every arm reads the same bytes.

## Arms

| arm | engine | how |
|---|---|---|
| `paddle` | PaddleOCR-VL-1.6 | **the fleet recipe**: `scripts/gpu/paddle-zh-box.sh`, vLLM server, `CLIENTS=8`, `LAYOUT=0`, Scaleway L4 |
| `flash` | gemini-3-flash-preview | `benchmark-run-api.mjs --prompt=production --prompt-hash=<live hash, recorded at run time> --refusal-retry=1`, thinking off (`thinkingBudget: 0`), metered |
| `open` | Qwen3-VL-8B-Instruct (first choice) or DeepSeek-OCR (fallback) | whichever installs cleanly on the L4 within one hour; vLLM, temperature 0, generic transcription prompt (vertical, right-to-left). Which one, and why, is recorded in the write-up |
| `lite`, `lite-b` | gemini-3.1-flash-lite | production prompt, thinking off, run twice: the noise floor (`stability`, lite vs lite) |

The #5547 Gemini outputs on the same pages are added to the scorer as anchors only (the reference-mismatch guard
then sees the same engine set for every arm); they are never reported.

## Scoring

- `benchmark-score.mjs` (unchanged): CER per page vs the reference window, markup stripped, CJK-normalised.
  Its reference-mismatch guard drops a page when no engine gets within CER 0.5 of the reference; such pages are listed, not scored.
- Paired ΔCER = arm CER − Paddle CER, on pages where both have a score. A page an arm returns nothing for counts as CER 1.0.
- 95% CI: bootstrap of the median paired Δ, 10,000 resamples, `makeRng(5660)`.
- Catastrophic: CER > 0.5 or no output. Also reported: invention (`invention_ref`, share of content 3-grams absent from the reference), loops (`ocr-loop-guard`).
- Cost, MEASURED: Gemini arms from the metered tokens (`_meter.jsonl`); GPU arms from wall time on the L4 over a
  400-page throughput set of cohort pages (same set for both GPU arms) × €0.7875/h, plus the fleet's all-in overhead
  ratio from #5600 (€0.000235/page measured all-in vs the box-time rate) shown separately.
- Cost for all: €/page × the in-scope never-read page count (from the lane's plan).

## Decision rule (fixed now)

An arm (flash or open) **wins** only if BOTH:
1. its paired median ΔCER vs Paddle is **< −0.02** and the 95% CI **excludes 0**; and
2. its catastrophic count is **≤ Paddle's + 1**.

- If flash or open wins: post the table and the cost-for-all figures on #5660 and **stop the Chinese lane** for Derek's choice.
- If neither wins: Paddle proceeds (gate 0 canary, then the fleet).
- The lite arms decide nothing; lite-vs-lite gives the noise floor quoted beside every Δ.
- n < 30 scored pages after the guard → the comparison is reported as directional and Paddle proceeds (the prior decision, #4925, stands).

## Caps

$5 Gemini, €10 GPU, inside the job's €260.
