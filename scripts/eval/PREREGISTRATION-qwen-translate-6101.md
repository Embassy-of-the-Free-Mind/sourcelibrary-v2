# Preregistration — can a Qwen model on the GEX45 translate Chinese/Japanese print instead of gemini-3-flash? (#6101)

Written 2026-10-23, before any Qwen output exists. Asked by Derek 2026-10-23 ("then to translate, qwen or something?").
Job `qwen-translate-eval-6101`. No production writes: every output stays on gex45 / `$JOB_SCRATCH`.

PRIOR ART: `scripts/eval/translation-model-ab.mjs` + `experiments/2026-09-14-which-model-should-translate-classical-chinese-preview-pages-six.md`
(the zh A/B: six API arms on 60 樂舞 pages, one ranking judge, test-retest 52 %; qwen3.8-flash via OpenRouter came last,
with fabrication on 31/60 pages). `scripts/eval/pro-translate-6545/JUDGE-PROMPT.md` (the blind per-candidate rubric with
accuracy spans and T-class defects — reused here, minus the human reference). `experiments/2026-10-18-gex45-capability-card-6871.md`
(rates on this card; it lists no model larger than Qwen3-14B). `experiments/2026-10-18-local-seam-screener-6742.md`
(Qwen3-14B-AWQ as a QC screener: κ 0.17, a screening result, not translation). #5793 (Latin student LoRA). None
measured an open model translating on the owned GPU.

## Question
On Classical-Chinese woodblock print and Japanese print, does an open Qwen model served on the GEX45 (24 GB, 70 W)
translate as well as the stored gemini-3-flash-preview translation, and how many GPU-days would 300K pages take?

## Pages (drawn by `scripts/eval/qwen-translate-6101/draw.mjs`, seed 6101, read-only; set.json sha256 0236079…)
- **zh, 40 pages, one per book**, from the 1,883-page / 47-book woodblock frame of #6101 (`results/paddle-split-6101/frame-woodblock.json`).
  Each page's stored translation is `gemini-3-flash-preview` (`source: 'ai'`, prompt v13), translated from the stored
  OCR field — which on these books is the CBETA digital text (`ocr.source: cbeta-xml-p5`), not a read — and the OCR is
  not newer than the translation. The Paddle P1s split-leaf read (#7184, server backend) exists and did not loop.
- **ja, 17 pages, one per book.** Japanese books whose page carries a stored `gemini-3-flash-preview` translation
  (`source: 'ai'`), page ≥ 3, ≥ 100 CJK characters with Han ≥ 25 %, OCR not newer than the translation. The brief asked
  for 20; only 38 Japanese books carry a stored Flash translation and 17 qualify, so the pool is exhausted at 17.
  Their prompt is the one each page was translated with (v11/v12).

## The input every arm gets (so the arms test translation only)
The stored translation's own prompt (looked up by `translation.prompt_id`), built by the production builder
`buildTranslationPrompt` with `PAGE_BREAK_SCOPED` (as `cli-translate.mjs` / `stale-retranslate-6567.mjs`), the stored
OCR text as the source, and the stored previous-page translation as continuity context. **A got this same source
text.** That is why the primary comparison uses the stored source, not Paddle text: the stored A was translated from
the CBETA text, so a Qwen arm fed Paddle text would test OCR + translation against translation alone.

## Arms
- **A** — the stored `gemini-3-flash-preview` translation. No new Flash call (agy locked until ~22:00Z; the brief allows
  scoring against what is stored).
- **Q1** — `Qwen/Qwen3-32B-AWQ` (rev 0499c3a), the brief's named arm.
- **Q2** — `Qwen/Qwen3-14B-AWQ` (the card's snapshot).
- **Q3** — `Qwen3.6-27B`, 4-bit AWQ (`Alennnndy/Qwen3.6-27B-AWQ-4bit`, rev e13b92a): the newest dense Qwen that fits
  the card (hybrid linear attention, so far less KV). Qwen3.6-35B-A3B was considered for speed and dropped: its
  4-bit quants are 25 GB, more than the card. The card lists no Chinese-specialised model, so none is armed.
- All Qwen arms: vLLM 0.31 (`/root/bench/vl`), **thinking off** (`enable_thinking: false`), Qwen's published
  non-thinking sampling (temperature 0.7, top_p 0.8, top_k 20), seed 6101, `max_model_len` 12,288,
  `max_tokens` = min(6,144, room left), 16 concurrent requests, GPU util 0.92 (fp8 KV only if the default KV
  cannot hold 12,288 tokens; recorded). One sample per page.
- **P1-source runs (lane reality, informational):** each Qwen arm also translates the 40 zh pages from the Paddle P1s
  text (×3 seeds — this is the throughput pass; seed 0 is the arm's output). After pass 1 is scored, the P1-source
  output of **the Qwen arm with the fewest accuracy spans per page in pass 1** is judged in a second round against A
  and against its own stored-source output. It is reported, not part of the bar.

## Judge
Blind Opus (`claude -p --model opus`, subscription), rubric `scripts/eval/qwen-translate-6101/JUDGE-PROMPT.md`
(the #6545 rubric minus the reference): per page all four candidates (A, Q1, Q2, Q3) under shuffled labels, with the
source text and the page image. Per candidate: fidelity 1–5, accuracy/style spans with severity, T-class defects,
invention list; per page a ranking with ties. Pages are judged **twice** with independently re-shuffled labels and
order (passes J1, J2), in separate calls; test-retest is reported (exact rank-order agreement of each A-vs-Q pair, and
α on fidelity). Pages per call: 3.

## Measures
- **Meaning errors** (primary): accuracy spans per page (minor + major), averaged over J1 and J2. Secondary: major
  accuracy spans; fidelity; T-class counts (T1 truncated, T2 echoed source, T7, T8, T9, T10); invention entries of kind
  `unreadable_fill` / `added_fact`.
- **Pairwise vs A**: per page and pass, Q ranked above A = 1, tie = ½, below = 0; the page score is the mean of J1 and
  J2; share = mean over pages, with a bootstrap 95 % CI over pages (one page per book, so pages = books).
- **Mechanical failures** (no judge): finish = length (hit the cap), Han/kana left untranslated > 20 % of the output's
  letters, output with no translation (chatter/refusal), malformed tags (`validateTranslationTags`).
- **Throughput**: per arm, the 120-request P1 pass at 16 concurrent requests: output tok/s, pages/h, peak VRAM, power.
  GPU-days for 300K pages = 300,000 ÷ (pages/h × 24). On the box's flat rate ($8.18/day, #6871).

## Bar (per Qwen arm, pooled zh + ja, n = 57)
A Qwen arm **passes** if all three hold:
1. **Meaning errors not worse:** the upper bound of the paired bootstrap 95 % CI of mean(Q − A) accuracy spans per page
   is ≤ max(0.25, 0.20 × A's mean) — a non-inferiority margin of a fifth of A's error rate.
2. **Pairwise vs A ≥ 45 %** (point estimate, ties ½).
3. **Mechanical failures ≤ 5 %** of the 57 pages (cap hits + untranslated + no translation).
zh-only (n = 40) and ja-only (n = 17) are reported beside the pooled verdict; the ja stratum is too small to carry a
verdict of its own. If two arms pass, the recommendation names the faster one unless the slower beats it on pairwise
by a CI that excludes 50 %.

## Recommendation rule
- An arm passes → **Qwen lane** for the print pages (still owes a canary + by-eye before any write).
- No arm passes, but the best arm meets bar 1 and fails only 2 → **hybrid**: Qwen draft, Flash fix of flagged pages,
  with the flagging rule still to be measured.
- Otherwise → **stay on Gemini** (Flash via agy/Batch).

## Threats, stated in advance
- A is a stored translation made weeks ago (2026-10-06 for zh); a fresh Flash call could differ. A has no replicate,
  so the A-vs-A noise floor is unknown here; the zh A/B's 52 % test-retest is the warning.
- The judge is a Claude model and sees no model names; style preferences between Gemini and Qwen English are possible
  and are not corrected for.
- The zh source text is CBETA (punctuated, edited), cleaner than any lane read. The P1-source round shows what the
  lane would actually see.
- 4-bit quantisation; one sample per page; the 27B is a community quant.
