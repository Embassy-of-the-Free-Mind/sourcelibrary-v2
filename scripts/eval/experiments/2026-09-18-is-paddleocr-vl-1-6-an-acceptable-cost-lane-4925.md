---
stage: ocr
measure: accuracy
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 69
n_pages: 69
verdict: "PaddleOCR-VL-1.6 passes the cost-lane rule on SKQS manuscript-regular: median dCER -0.028 vs flash-lite, 57W/10L, 0 vs 14 catastrophic; woodblock and typeset directional only"
status: adopted
decision: "Siku Quanshu Chinese routed to a PaddleOCR-VL cost lane by rule (#4743); lane writer being built (#5600)"
superseded_by: null
issue: [4925, 4743]
---
## 2026-09-18 — Is PaddleOCR-VL-1.6 an acceptable COST LANE for Chinese pages, decided per observed page class? (#4925 step 1a, #4743) — RESULT

**Headline: on Siku Quanshu brush manuscript (`manuscript-regular`, 69 referenced books,
decision-grade) PaddleOCR-VL-1.6 passes the preregistered non-inferiority rule — median
ΔCER −0.028 (95 % CI −0.047 to −0.015; recomputed 2026-09-30, #5373, was −0.036 to −0.014), wins 57 / loses 10 / ties 2 against production
`gemini-3.1-flash-lite`, 0 vs 14 catastrophic pages, lower invention (0.132 vs 0.201), no
loops either side. Cost lane ADOPTED for that class. It is NOT "the better reader" by the
stronger #4743 rule (Δ ≤ −0.05 on 38 % of pages, the rule wants 60 %). Woodblock (14
referenced) and typeset (6) stay directional, no lane decision; woodblock cannot reach 50
from this corpus at one page per book (the prereg's step 1b is a further draw, not run).
Lite's catastrophes are reading-order failures — by eye on 0e588a-p21 lite starts at the
LEFT column of a right-to-left leaf and repeats a line; Paddle reads the columns in order.**

- **Question.** #4743 asked whether Paddle beats lite on "Chinese woodblock"; #4925 found the
  cell was 71 % SKQS manuscript by eye and the 2.0M pages at stake are that class. Prereg:
  `PREREGISTRATION-chinese-ext-4925.md` (cost-lane rule per OBSERVED class; lite-vs-lite repeat
  as noise floor; ≥ 50 referenced pages; no proxy top-ups).
- **Design.** Strata `chinese` (40, sealed 09-13) + `chinese-ext` (80 + 16 spares, sealed
  09-18, seed 47431). Arms on Hetzner: lite, lite REPEAT (`gemini-3.1-flash-lite-b`, same
  settings), flash-preview — 96 + 96 + 96 + 48 pages, $0.346 total, thoughts 0. Paddle on one
  Scaleway L4 (`sl-ocr-gpu-test`, fr-par-1, leased `owner=4925` under the #4909 watchdog):
  paddleocr 3.7.0 / paddlex 3.7.2 / paddlepaddle-gpu 3.2.1 (the 09-15 venv was lost with the
  ephemeral scratch volume; same recipe reinstalled), 96 pages in 630 s GPU, 0 errors; box
  booted 14:19 UTC, stopped 15:03 UTC (44 min, ≈ €0.55), stop confirmed by the Hetzner watchdog.
  References: CBETA + Kanripo via `benchmark-refs.mjs`; 8 textless pages retired for spares
  (draw order, reason recorded in the registry). Scorer, decision (`benchmark-cost-lane.mjs`),
  dashboard (`benchmark-dashboard-data.mjs`, new pooled factor *Script × observed class*).
- **Deviations, all reported.** (1) The title+juan Kanripo lookup found the WORK but not the
  PAGE for 30 pages (a Siku volume's 卷 rarely matches Kanripo's file numbering; plain titles
  carry no juan): `--wide` now lists every juan file of the identified work on its WYG
  (Wenyuange) branch, else master, and takes the best window — same ≥ 0.35 acceptance, no
  proxy. +29 references, all with the same threshold; e.g. 淵鑑類函 "卷四十八" sits in file 053.
  (2) `benchmark-score.mjs` did not list `chinese-ext` as a CJK stratum — fixed before scoring
  (it would have scored Han with the alphabetic normaliser). (3) One arbitrated class file
  (`chinese-ext-5d00b1-p132`) carried `leaf_language: other` against its own note ("a clean
  SKQS leaf"); corrected to `zh`. (4) The lite REPEAT arm at temperature 0 tied lite on 63 of
  65 referenced pairs (identical output token counts, 49,473 vs 49,474) — the noise floor is 0, which satisfies the rule but measures
  determinism, not sampling noise; a real floor needs temperature > 0 or a second day.
  (5) References were built on Hetzner (GitHub was ~100× slower from the laptop that afternoon).
- **Result table** (referenced Chinese-leaf pages, both strata pooled by by-eye class):

  | class | ref pages | median CER Paddle / lite | median Δ [95 % CI] | W/L/T (p) | catastrophic | invention | verdict |
  |---|---|---|---|---|---|---|---|
  | manuscript-regular | 69 (20 + 49) | 0.166 / 0.260 | −0.028 [−0.047, −0.015] | 57/10/2 (p < 0.001) | 0 vs 14 | 0.132 vs 0.201 | **cost lane ADOPTED** |
  | woodblock | 14 (2 + 12) | 0.174 / 0.202 | −0.010 [−0.022, +0.002] | 9/4/1 (0.27) | 0 vs 0 | 0.128 vs 0.129 | directional (n < 50) |
  | typeset | 6 (5 + 1) | 0.313 / 0.314 | 0.000 [−0.005, +0.009] | 2/2/2 (1) | 0 vs 0 | 0.098 vs 0.110 | directional (n < 50) |

  (CI recomputed 2026-09-30, #5373: manuscript-regular was [−0.036, −0.014]; the other two rows and the
  flash-preview interval below came out the same. The rule reads CI-upper ≤ +0.05, so ADOPTED stands.)

  flash-preview (exploratory second reader) on manuscript-regular: median Δ −0.022
  [−0.036, −0.012], 55/4/10, 0 catastrophic — Paddle and flash-preview agree lite is the
  outlier. Contamination check: Paddle's output length tracks flash-preview's page for page
  (no reading beyond the leaf); its best page still misreads the 欽定四庫全書 header as
  金文口屋全書 — an OCR error, not a recitation. 3 pages demoted to proxy by the scorer's
  `ref_mismatch` guard (one a 17,770-char lite loop that the reference builder had windowed).
- **Decision.** Route `manuscript-regular` Chinese pages to a PaddleOCR-VL-1.6 lane (sizing
  issue next: GPU-hours for ≈ 2.0M pages at ≈ 6.6 s/page on an L4 ≈ 3,700 GPU-h ≈ €2.8K, vs
  ≈ $4K at lite's $0.002/page — and lite's 20 % catastrophic rate on this class is the real
  cost). Woodblock: no decision; a woodblock draw of non-SKQS books classified by eye
  (#4925 step 1b) if anyone needs that verdict. Results: `results/benchmark/chinese-2026-09-18.json`,
  `chinese-ext-2026-09-18.json`, `decisions/cost-lane-chinese-2026-09-18.json`; dashboard
  `/platform/admin/ocr-evidence?by=script_class_pooled`. PR #4926.
