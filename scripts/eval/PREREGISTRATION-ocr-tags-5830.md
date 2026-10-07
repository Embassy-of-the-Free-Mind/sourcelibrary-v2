# Preregistration: how much Gemini does an open-engine OCR lane need to keep page structure? (#5830)

PRIOR ART: scripts/eval/ocr-v18-ab.mjs (#4195): the Batch build/submit/poll stages, the production OCR request
(prompt substitution, document context, safety, 1500 px resize), imported, not rewritten.
scripts/eval/PREREGISTRATION-open-engine-print-5660.md (#5660): the GLM-OCR outputs and page JPEGs this reuses.
None of them measures tags: #5660 scored body CER only, with the tags stripped.

Written and pushed **before any output of this run was scored** (job `ocr-tags-5830`, 2026-10-04).
`measure: agreement`. The reference is a model, not the page. Its own error is measured separately, by eye,
on 20 pages ("read from image").

## Question

GLM-OCR (and Paddle and Kraken) return plain text. Our Gemini OCR (Standard OCR v19.1) also returns the
structure tags. Which cheap option gets which tags back, and at what $/1,000 pages, compared with a full lite OCR?

## Pages

Every page in the #5660 round-3 English cells that has a GLM-OCR output: strata `eebo-tcp-5488` (English
1600–1699) and `english-ia-5124` (English 1700+), raw GLM text in `/root/r3-bench-5660/glm-ocr/<stratum>/out/glm-ocr/<slug>.txt`.
Every arm reads the same JPEG GLM read (`/root/r3-bench-5660/glm-ocr/<stratum>/<slug>.jpg`). For the full-resolution arms it is resized
as production does (fit 1,500 px, JPEG q80, only when over 100 KB). Pages missing a GLM file are not drawn.
Pages whose GLM output is empty stay in; that is what the lane would get.

## Arms (all `gemini-3.1-flash-lite`, Batch API, thinking budget 0, temperature 0.1)

| arm | input | output |
|---|---|---|
| **R** reference | Standard OCR v19.1 from the `prompts` collection (content hash checked) + document context + image | the full production OCR |
| **R2** repeat | identical to R | the A-vs-A ceiling: lite agreeing with itself |
| **D** $0 deterministic | GLM text + the book's catalogue language | `language` from the catalogue; `script` = printed; `page-type` = text (the majority class); `page-num`/`header`/`sig` from the first and last short lines of the GLM text |
| **T** tags-only | image (1,500 px) + GLM text + a tags-only prompt (`scripts/eval/prompts/ocr-tags-only-5830.txt`) | tags only. Inline tags carry an `anchor="…"` copied from the GLM text. Gemini never rewrites the GLM text. It does transcribe the text *of* page furniture and marginal notes, because GLM drops them. |
| **L** low-res | image fit to 512 px, `mediaResolution: LOW` + a classify prompt | `page-type` + the largest illustration (none/small/medium/large, significance) |
| **L2** image-desc | only pages where L reports an illustration that is medium or large, or high significance: image (1,500 px) + an image-desc-only prompt | `image-desc` tags in the v19.1 format |

D cannot test the issue's "running heads from repetition across a book's pages": the cells hold one page per book. It is also moot if GLM omits
the furniture. The scorer reports the share of reference `header` / `page-num` values found anywhere in the GLM text, which bounds what any $0 method could recover.

## Scoring (vs R; R2 vs R is the ceiling)

Tags are parsed by regex: `<name attrs>content</name>`, plus `<column-break/>`.

**Page-level labels** (accuracy, n = pages where both arms emit the tag):
- `page-type`: exact match, plus precision and recall of the class "not text".
- `language`: the first language named, lowercased.
- `script`, `scan-quality`: exact match.
- `columns`: precision and recall of "multi-column" (`<columns>` ≥ 2 or a `<column-break/>`).

**Presence, per tag** (a page is positive if it has ≥ 1 non-empty instance): precision, recall, F1. The tags are
`page-num`, `header`, `sig`, `meta`, `margin`, `gloss`, `insert`, `image-desc`, `image-desc` with significance=high,
`warning`, `unclear`, `term`, `vocab`.

**Instances, for `page-num`, `header`, `sig`, `margin`, `insert`**: micro precision and recall over pages. Matching is greedy and one-to-one by
similarity of the normalised text (lowercase; ſ→s; u/v and i/j folded; letters and digits only). Similarity is 1 − Levenshtein / max length,
over the first 300 characters. A match needs similarity ≥ 0.5; for `page-num`, an equal digit or roman string. **Value accuracy** is
the share of matched `header` / `sig` / `margin` instances at similarity ≥ 0.8. For `image-desc`, instances are matched
by count only (min(n_arm, n_ref)), and the `type` and `significance` attributes are compared on pairs taken in order.

**Anchors (T only), for matched `margin` / `insert` / `gloss` / `image-desc`:**
- The reference position is the fraction of R's body text (all tags and their contents removed) that comes before the tag.
- T's position is where its `anchor` sits in the GLM text, also as a fraction. The anchor is found by normalised substring search; failing
  that, the best window of the same length at similarity ≥ 0.7.
- **anchor found** = the anchor locates. **anchor correct** = it locates and |Δ position| ≤ 0.15.
- An anchor that is empty, or not in the GLM text, counts as not found. That is what a merger would do.

**Cost:** measured `usageMetadata` tokens per arm (input, output), times the Batch price in `scripts/lib/model-pricing.mjs`,
reported as $/1,000 pages. L2's cost is spread over all pages, not just the ones it ran on. R's cost is "full lite OCR".

**Reference error, read from image:** 20 pages, seeded (seed 5830), stratified 10/10 by stratum. On each I read the image and record
the truth for `page-type`, `page-num`, `header`, `sig`, margin-note count, illustration present, and columns, then compare R against it.

## Decision rule (a recommendation; no routing or writer change in this job)

For each tag group, recommend the cheapest option whose F1 (or accuracy) vs R is within 0.05 of the R2-vs-R ceiling.
The groups are page-type; furniture (page-num/header/sig); margins (with anchor correct ≥ 0.8 for T); image presence and image-desc;
language/script; quality (scan-quality/warning/unclear); vocab/term. Where no option gets within 0.05, report the gap and name the nearest option.
Groups with fewer than 10 positive reference pages are reported as **descriptive** only.

## Cap

$1 Gemini (Derek 2026-10-04). The script refuses to submit when the estimate is over $1. Batch jobs are registered in `batch_jobs` with
status `external_eval` (#5771). No writes to `pages` or `books`.
