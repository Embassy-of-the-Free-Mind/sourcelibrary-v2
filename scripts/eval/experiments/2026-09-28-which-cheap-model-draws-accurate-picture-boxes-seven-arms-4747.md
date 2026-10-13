---
stage: image
measure: accuracy
languages: []
scripts: []
canons: []
n_books: 72
n_pages: 72
verdict: "Flash draws 81.6% tight boxes vs 3.1-lite 8-21% (finds pictures but crops them) and Qwen3-VL 63%; flash on the Batch API reproduces realtime boxes at half price."
status: adopted
decision: "Extraction stays on gemini-3-flash-preview, routed to the Batch API by default (IMAGE_EXTRACTION_USE_BATCH, PR #5238)"
superseded_by: null
issue: 4747
---
## 2026-09-28 — Which cheap model draws ACCURATE picture boxes? Seven arms, boxes graded by eye against the page (#4747, widened)

- **Question.** Image extraction runs on full `gemini-3-flash-preview` realtime because a 5-page test
  rejected flash-lite. Is any cheaper model/mode as good at the thing readers see — the crop — and can
  the Keely/Tesla release (~$28 of extraction on flash) be done for a few dollars?
- **Design.** `measure: accuracy` (boxes graded against the image), agreement with stored flash kept
  as secondary. 240 pages, one per book, 240 books: 120 pages the production flash worker boxed in the
  last 90 d, 120 it ran and found nothing on (first 30K index-order rows per class, seeded pick).
  Every arm ran the production prompt/schema/grounding (lifted from the worker at runtime) on the same
  cached image bytes: flash realtime ×2 (test-retest), flash Batch API, 3.1-flash-lite realtime + Batch,
  3.1-lite asked for Gemini's native `box_2d` [ymin,xmin,ymax,xmax] 0–1000, 3.5-flash-lite (thinking
  `minimal` — it 400s on budget 0, #5232), Qwen3-VL-235B-A22B-Instruct via OpenRouter (native `bbox_2d`
  [x1,y1,x2,y2] relative 0–1000 per Qwen's 2d_grounding cookbook), DocLayout-YOLO DocStructBench on
  Hetzner CPU (free; `figure` class, conf 0.25). **Grading:** blinded composites (one panel per arm,
  order shuffled per page, key withheld), 48 stratified positive pages + 24 of the 71 flash-negative
  pages on which any arm fired; each box T tight / L loose / C cropped / W wrong / D duplicate, plus
  missed pictures, per `grading/RUBRIC.md`. Graded by three Opus subagents that opened every sheet
  (label: *read from image by a model grader*), 4 overlap pages graded by all three: pictures agree
  12/12, box letters 94.9%, tight-vs-not 97.4%. Lead read the calibration page and 4 panels of page
  011 by eye: 4/4 agree with the grader. Primary number: **box accuracy = tight boxes / true pictures**.
- **Result (positives: 48 pages, 38 true pictures; page-bootstrap 95% CI).**

  | arm | box accuracy | usable (T+L) | picture recall | T/L/C/W/D | FP boxes on 24 fired negatives | vs flash W–L–T | $/1K pages |
  |---|---|---|---|---|---|---|---|
  | flash realtime (production) | **81.6%** [68, 92] | 84% | 95% | 31/1/4/8/0 | 5 | — | $3.70 |
  | flash realtime re-run | 78.9% [66, 91] | 82% | 92% | 30/1/4/9/0 | 5 | 0–1–47 | $3.96 |
  | Qwen3-VL-235B (OpenRouter) | **63.2%** [47, 79] | 66% | 87% | 24/1/8/4/0 | 1 | 4–11–33 | $1.67 |
  | DocLayout-YOLO (CPU) | 23.7% [11, 38] | 68% | 89% | 9/17/8/9/7 | 19 | 1–23–24 | $0 |
  | 3.1-lite native box_2d | 21.1% [8, 34] | 32% | 97% | 8/4/25/9/0 | 8 | 2–25–21 | $1.41 |
  | 3.5-flash-lite | 13.2% [3, 25] | 45% | 63% | 5/12/7/4/1 | 5 | 2–28–18 | $3.82 |
  | 3.1-lite Batch | 10.5% [2, 21] | 34% | 100% | 4/9/25/9/0 | 8 | 2–29–17 | $0.71 |
  | 3.1-lite realtime | 7.9% [0, 18] | 29% | 100% | 3/8/27/10/0 | 8 | 1–29–18 | $1.42 |

  - **3.1-lite FINDS every picture but CROPS most of them** (27 of 38 cut). Not a unit bug: on
    single-box pages its median edge offsets from flash are 0.5–3% of the page, spread (MAD) 1.5–3.5%
    per edge — per-page noise, which no fixed correction removes (`geometry.txt`). Asking for Gemini's
    native box format helps (8% → 21%) but not enough. Batch ≈ realtime for lite, as expected.
  - **3.5-flash-lite** costs as much as flash and misses 37% of pictures: dominated.
  - **Qwen3-VL** is the only cheap arm in reach: 45% of flash's price, fewest false positives, edges
    within ~0.5% of flash's when both agree; its misses are mostly C (drops an engraved frame line or
    the caption inside the frame).
  - **Flash via Batch API reproduces flash realtime:** every box matched at IoU ≥ 0.9 on 88.9% of
    pages vs the realtime re-run's own 90.0% (noise floor), at **$1.90/1K** (half price). 5/240
    requests came back "operation was cancelled" (transient; the batch collector retries). Not
    separately graded — inferred from box identity with the graded realtime arm.
  - Side finding: 10 of 48 flash-"positive" pages hold no true illustration (Siku Quanshu cover labels,
    bookplates, a watermark radiograph) — flash's W boxes are real errors, not grader noise.
- **Verdict.** Keep **gemini-3-flash-preview** for extraction; do not move boxes to 3.1-lite in any mode.
  The cheaper path that keeps box quality is **flash on the Batch API** (~50% off, same boxes) — Keely/
  Tesla ≈ $14 instead of $28, not "a few dollars". Qwen3-VL is a possible second step (−18pp tight) and
  would need its own prompt work (frame/caption inclusion) before it is a candidate. Routing change is
  Derek's call; nothing in the worker was touched.
- **Limits.** n = 38 pictures, so CIs are wide. Paired per page: flash beats 3.1-lite 29–1 (decisive);
  flash beats Qwen 11–4 (two-sided sign test p ≈ 0.12 — "probably worse than flash", not settled). Positives are
  mostly single-picture pages (118/120 had one stored box), so multi-figure plates are barely tested.
  Negatives came from flash, so pictures flash never surfaced on unsampled pages are unmeasured.
- **Replicated?** Test-retest only (flash ×2 + flash batch). Grader agreement measured on 4 pages × 3.
- **Cost.** $4.45 paid (flash $1.84 over two runs + $0.45 batch, 3.5-lite $0.92, Qwen $0.40, 3.1-lite
  $0.34 + $0.34 + $0.17), every call metered as `gemini_usage` type `eval`; grading on subscription.
- **Artifact.** `scripts/eval/image-extraction-lite-eval.mjs`, `image-extraction-doclayout.py`,
  `results/image-extraction-bbox-2026-09-28/` (raw outputs, grades, key, rubric, geometry). Sheets
  (43 MB) on Hetzner `/root/bbox-eval-4747/repo/scripts/eval/results/image-extraction-lite-2026-09-28/grading/sheets`.
