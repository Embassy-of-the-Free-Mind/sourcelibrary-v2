# Preregistration — Chinese OCR cost lane, decision-grade (#4925 step 1, #4743)

PRIOR ART: `PREREGISTRATION-per-language-ocr-suitability.md` (the draw rule and the ≥ +5 pp
"specialist beats lite" rule this reuses) and the #4743 result comment of 2026-09-16 (40 pages,
28 referenced, Paddle 18/7 over lite) — neither fixes a COST-LANE (non-inferiority) rule, neither
separates manuscript from woodblock, and the 40-page cell is exploratory by the #4735 grades.

Written 2026-09-18, before any engine ran on the extension pages. Nothing below changes after
the run; deviations are reported as deviations.

## Question

Is PaddleOCR-VL-1.6 (Apache-2.0, self-hosted) an acceptable **cost lane** for Chinese pages in
place of `gemini-3.1-flash-lite` (production) — decided separately for the two page classes
the catalogue does not distinguish:

- **manuscript-regular** — Wenyuange Siku Quanshu volumes, regular-script brush hand in ruled
  columns. 11,980 of our 13,117 Chinese books (91 % by count) are this shape.
- **woodblock** — printed pages (Buddhist canon scans, library-held imprints). The minority
  by book count, the majority of what people picture as "Chinese woodblock OCR" (#4743's title).

A page is scored in the class it is **observed** to be, never the class its draw came from
(#4884: the catalogue year and format are the work's, not the leaf's).

## Sample (sealed before this file was written)

- `scripts/eval/benchmark/chinese.json` — sealed 2026-09-13, 40 pages + 8 spares, seed 4743
  (20 Buddhist-canon titles, 20 other; 28 referenced).
- `scripts/eval/benchmark/chinese-ext.json` — sealed 2026-09-18, seed 47431, 80 pages + 16
  spares: 40 `skqs-manuscript` (drawn from the 11,980 SKQS-shaped books not already sealed)
  and 40 `woodblock-canon` (drawn from the 299 non-SKQS Chinese books whose title is a Buddhist
  canon title or an exact Kanripo catalogue title, so that a reference can exist).
- One page per book, page uniform over the interior 10–90 %, Mulberry32 over the id-sorted
  eligible list; the registry file is the seal, not the script.
- Images exported at max width 2400 px; every engine reads the identical JPEG.
- **Classification by eye before scoring**, for all 144 pages (existing + extension): Claude
  reads each exported image and writes `out/script-class/<slug>.json` with `script_class` ∈
  {manuscript-regular, manuscript-cursive, woodblock, movable-type, typeset, illustration,
  textless}, `leaf_language` ∈ {zh, ja, other} and a one-line note. A page whose leaf language
  is not Chinese, or that is illustration/textless, is excluded from both cells and listed.
  Existing pages that already carry a flash-preview `script_class` are re-classified by eye
  and the disagreement count is reported. The class files are mirrored into
  `scripts/eval/benchmark/script-class/` (committed provenance; the scorer reads the copy
  under `<root>/<stratum>/out/script-class/`).

  **Done 2026-09-18, before any engine ran on the extension:** six Sonnet workers read 24
  pages each; 11 labels were overturned by a second reader (Fable) who opened the disputed
  pages — one worker called every Siku Quanshu leaf "woodblock", and two stone rubbings were
  recoded. Result: the existing cell is 24 manuscript-regular / 10 typeset / 3 woodblock /
  1 cursive / 1 rubbing (20 of its 28 references are manuscript, 2 are woodblock); the
  extension's `woodblock-canon` draw is itself 16 manuscript-regular / 14 woodblock (Siku
  Quanshu copies are imported under plain titles too). Consequence, fixed here: the
  manuscript-regular cell can reach ≥ 50 references from this draw; the woodblock cell
  cannot (≤ 21 pages before references) and needs a further draw of non-SKQS books
  classified by eye before a woodblock decision is possible.

## References

- Page-level windows cut from a canon e-text by `benchmark-refs.mjs`: CBETA (full-text search
  on the probe read) for Buddhist titles, Kanripo (exact catalogue title + juan from the title)
  otherwise; the other as fallback. Window accepted at ≥ 0.35 distinct 4-gram overlap with the
  probe; a window no engine comes within 0.5 CER of is demoted to proxy by the scorer
  ("ref_mismatch") and does not count.
- Probe engines: `gemini-3-flash-preview` and `gemini-3.1-flash-lite` (the longer Han read).
- **Only referenced pages enter a cell.** No proxy-scored top-ups. Spares are promoted only
  for textless/unavailable pages, in draw order, per the registry's spare rule.
- Contamination note on every row: CBETA and Kanripo are public e-texts and may be in any
  engine's training data; the invention metric partly guards against recitation, a by-eye read
  of the five worst and five best pages per engine is the rest.

## Arms

| arm | version | where | cost |
|---|---|---|---|
| `gemini-3.1-flash-lite` (production) | as `lib/runners.mjs` resolves `lite`, `thinkingBudget: 0`, temperature 0 | Hetzner (laptop is geo-blocked for Gemini) | ≈ $0.002/page |
| `gemini-3.1-flash-lite` REPEAT | same, second run, separate out dir `gemini-3.1-flash-lite-b` | Hetzner | ≈ $0.002/page |
| `gemini-3-flash-preview` (probe + second reader) | same settings | Hetzner | ≈ $0.006/page |
| `paddleocr-vl-1.6` | official `paddleocr[doc-parser]` pipeline, the version of the 2026-09-15 run, per-page `timeout` | Hetzner CPU (8 cores, no GPU — install first) or one leased L4 under #4909 tagging | CPU: time only; L4: ≈ €1 |

Total API ≈ 96 pages × ≈ $0.010 ≈ **$1**. The lite REPEAT arm is the A-vs-A noise floor
(a non-inferiority margin narrower than the engine's own repeat noise decides nothing).

## Metrics (as `benchmark-score.mjs` computes them)

Per page and engine against the reference window: CER after the kyūjitai/shinjitai fold;
catastrophic = CER > 0.5; invention = share of content 3-grams found in neither the reference
nor any other engine's output; loop flag. Paired per page against production lite.

## Decision rule, per class, evaluated only when the class holds ≥ 50 referenced pages

Let Δ = CER(Paddle) − CER(lite) per page, and Δ₀ the same for lite-REPEAT vs lite (noise floor).

1. **Cost lane adopted** for the class if ALL of:
   - median Δ ≤ +0.02 and the bootstrap 95 % CI upper bound of median Δ ≤ +0.05;
   - the +0.02 margin exceeds the noise floor: |median Δ₀| < 0.02 (otherwise the cell is
     reported "engine noise exceeds the margin" and no lane decision is made);
   - catastrophic pages (CER > 0.5): Paddle ≤ lite + 1;
   - median invention: Paddle ≤ lite;
   - loop pages: Paddle ≤ lite.
2. **Paddle is the better reader** for the class (a separate, stronger claim, the #4743 rule)
   if Paddle wins the paired sign test (p < 0.05 on untied pairs, ≥ 50 untied) AND median
   Δ ≤ −0.05 on ≥ 60 % of pages. Then routing for that class goes to a sizing issue.
3. **Rejected** for the class otherwise. Logged in `EXPERIMENTS.md`; no re-test without a new
   engine version or a new reason.
4. A class that ends under 50 referenced pages is reported **directional** with its interval
   and no lane decision — and the shortfall is a draw-more item, never a proxy top-up.

The evidence dashboard (`benchmark-dashboard-data.mjs` → `/platform/admin/ocr-evidence`) is
regenerated after scoring; the grade change is the deliverable.

## Outputs

- `scripts/eval/results/benchmark/chinese-ext-<date>.json` (scorer), `chinese-<date>.json` if
  the existing cell is rescored with by-eye classes.
- `scripts/eval/benchmark/refs/chinese-ext-*.{txt,json}` (references, committed).
- `src/data/ocr-benchmark-evidence.json` (dashboard).
- Result table + verdict per class posted on #4743 and summarised on #4925.
