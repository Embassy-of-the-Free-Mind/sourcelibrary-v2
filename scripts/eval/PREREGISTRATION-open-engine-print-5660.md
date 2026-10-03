# Preregistration — an open engine on our own GPU for Latin-script and Greek PRINT (#5660 step 2)

PRIOR ART: `PREREGISTRATION-chinese-ext-4925.md` (the cost-lane non-inferiority rule this reuses
verbatim, as `benchmark-cost-lane.mjs` implements it), `PREREGISTRATION-greek-ext-4925.md` (Greek print
cell membership: by-eye `typeset-print`, `greek_share ≥ 0.5`), `PREREGISTRATION-english-modern-5182.md`
(the 122 English references), the EEBO-TCP stratum of #5488. None of them runs an open engine on
Latin-script print: PaddleOCR-VL was measured only on Chinese/Japanese (#4925, #5547, #5600), and the
2026-09-15 specialist tie on Latin print was Kraken/Surya.

Written 2026-10-03, before any engine ran on these pages for this study. Nothing below changes after
the run; deviations are reported as deviations.

## Question

Does PaddleOCR-VL-1.6 on our own GPU read Latin-script and Greek print well enough to replace
production `gemini-3.1-flash-lite` for the ≈ 8.3M-page print OCR backlog (Latin 6.9M, German 0.64M,
English 0.51M, Greek 0.34M; #5660)? Answered per cell, against references, on shared pages.

## Cells (fixed here; membership written to `results/open-engine-print-5660/cells.json` before the run)

Every page is one book (one page per book). "Library" = one of our books; "external" = a Wikisource
scan with `book_id: null` (eval-design §3.5: external pages never count toward a library grade).

| cell | pages (source) | library books | grade it can reach |
|---|---|---|---|
| `latin-1500-1699` | EEBO-TCP Latin 1600s (15, #5488) + Wikisource-la scans 1500–1699 (23) | 15 | directional (external-majority) |
| `latin-1700+` | Wikisource-la scans 1700+ (42) | 0 | directional (external) |
| `german` | Wikisource-de scans (30; 1 before 1700) | 0 | directional (external); Fraktur/Antiqua by eye, reported |
| `english-1600-1699` | EEBO-TCP English 1600s (53) + #5216 refs with catalogue year 1600–1699 (8) | 61 | decision-grade |
| `english-1700+` | #5216 refs with catalogue year ≥ 1700 (≈ 113: 9 × 1700s, 29 × 1800–1879, 75 × 1880–1930) | ≈ 113 | decision-grade (labelled: mostly 19th–20th c.) |
| `greek-print` | `greek`, `greek-ext`, `greek-ext2` pages with a reference, by-eye `typeset-print`, `greek_share ≥ 0.5` | ≈ 120 | decision-grade; per-period split (1450–1699 / 1700–1799) reported |

Excluded, and why: #5216 refs marked `reference_error` or with `leaf_check.status != ok` (8); the
EEBO English 1500s (5, reported apart); `ref-pinned` (no year; half canonical: Vulgate, Aeneid).
**Agreement-only strata** (no references; `measure: agreement`, never quality): `latin-pre1700` (23),
`latin-1700s` (24), `german-fraktur` (24), `longs-en-fr` (28) — library pages where the backlog lives;
Paddle vs lite and vs flash-preview agreement, and the source of the by-eye reads.

## Arms

| arm | settings | pages |
|---|---|---|
| `gemini-3.1-flash-lite` (production model) | `benchmark-run-api.mjs`, generic transcription prompt, thinking 0, temperature 0 — existing outputs reused where the page set matches (Greek, Wikisource, agreement strata); run fresh on EEBO-TCP and #5216 pages | all |
| `gemini-3.1-flash-lite-b` (A-vs-A noise floor) | same, second run | existing on Greek; run on EEBO-TCP, #5216, Wikisource |
| `paddleocr-vl-1.6` | `paddleocr[doc-parser]==3.7.0`, `paddlex==3.7.2`, `paddlepaddle-gpu==3.2.1` (cu129), genai server (vLLM) with CLIENTS=8, **layout ON**, max width 2400, recipe `scripts/gpu/paddle-zh-box.sh arm` (branch `job-paddle-zh-5600d`, rev eec7802) | all |
| optional second open engine | only if it installs in < 20 min on the same pod; else "not run" | all, if run |

Hardware: one RunPod SECURE RTX PRO 4000 Blackwell (the GEX45's GPU), else L4 SECURE. Same JPEGs for every arm.
Spend cap: GPU ≤ $5, Gemini ≤ $2.

## Metrics (`benchmark-score.mjs`, unchanged kernel)

`measure: accuracy` per page: CER against the reference window (windowed lower bound for the Wikisource
tier), catastrophic = CER > 0.5, invention (`invention_ref`), loops, refusals (finishReason). Paired per
page against lite on pages both answered. Before scoring, Paddle's output is diffed by eye against the
image on two known-good pages (eval-design §6, conventions) and any systematic non-error (markdown
headings, table HTML) is reported with the normaliser rule applied to it.

## Decision rule per cell (`benchmark-cost-lane.mjs`, the #4925 rule as written)

Δ = CER(Paddle) − CER(lite) per page; Δ₀ = CER(lite-b) − CER(lite).

- **route to box** (cost lane adopted) iff, with ≥ 50 paired **library** books: median Δ ≤ +0.02 ∧
  bootstrap-95% CI upper of median Δ ≤ +0.05 ∧ |median Δ₀| < 0.02 ∧ catastrophic(Paddle) ≤
  catastrophic(lite) + 1 ∧ median invention(Paddle) ≤ lite ∧ loops(Paddle) ≤ lite.
- **keep lite** if the cell is decision-grade and any check fails.
- **directional** if the cell has < 50 paired library books: the interval and the lean are reported,
  no routing decision. A directional cell is a draw-more/reference-more item, never a proxy top-up.

Reported alongside, not decisive: lite's refusals (pages lite refused are a cost of lite — counted
as catastrophic for lite in a second view), s/page (arm wall after model load ÷ pages, CLIENTS=8),
$/page on the GEX45 ($249/mo ÷ 2.63M s × s/page) vs lite's metered $/page (realtime; batch = ½).

**Known lite weak spots (#4877), descriptive only:** on the early-print pages (EEBO-TCP, Latin
1500–1699, the agreement strata) per engine: long-s rendered as `ſ` / as `s` / misread as `f`
(output token that becomes a reference token under f→s), abbreviation marks (macron vowels, `ꝑ ꝓ ꝗ`,
`q;`, `&c`), ligatures (`æ œ ß` and `ct`/`st`). Plus five pages read by eye (`read-from-image`): the
worst Paddle page per decision cell and the largest Paddle-vs-lite disagreements on the agreement strata.

## Outputs

`results/open-engine-print-5660/` (cells, cost-lane JSON, throughput, weak-spot tally),
`results/benchmark/<stratum>-<date>.json` (scorer), `experiments/2026-10-0X-open-engine-print-5660.md`,
one comment on #5660.
