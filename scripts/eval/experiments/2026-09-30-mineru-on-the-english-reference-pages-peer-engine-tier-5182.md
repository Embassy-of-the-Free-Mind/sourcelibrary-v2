---
stage: ocr
measure: accuracy
languages: [en]
scripts: [Latn]
canons: []
n_books: 114
n_pages: 114
verdict: "MinerU is neither peer nor tier-3 fallback, narrowly: catastrophic 2.6% (bar 2%), refused-page pooled CER 2.25x lite (bar 2x), mostly from dropped footnotes; median delta +0.19 pp."
status: undecided
decision: null
superseded_by: null
issue: [5182, 3389]
---
## 2026-09-30 — MinerU on the English reference pages: peer engine, tier-3 fallback, or neither? (#5182, #3389)

**Headline: the preregistered rule says NEITHER, narrowly on both counts, and the main failure is mechanical.**
First accuracy measurement of MinerU (3.4.0, CPU pipeline, `-m ocr`, the worker's `sanitize()` verbatim) against the
#5216 human references, on the 114 books lite and flash were scored on. $0 (no model call; lite/flash rows reused).
- **Paired vs lite (decision, 98 pairs):** MinerU better 10 / lite better 49 / tie 39, sign p < 0.001, median Δ
  **+0.19 pp** [0.10, 0.91]. That is inside the ±0.2 pp PEER band, but the CI is not. Median CER 0.66% vs 0.20%.
  (CI recomputed 2026-09-30, #5373 — was [0.10, 0.86]; rule output unchanged.)
- **Catastrophic 2.6% (3/114), bar 2%.** MinerU never refuses (114/114 text vs lite 98, flash 94). All three > 50% pages,
  and all five worst by eye, are **footnotes dropped whole**. MinerU reads them (re-run: `middle.json` has them as
  `page_footnote` in `discarded_blocks`), but its markdown leaves them out. 10/114 pages lose ≥ 20% of the words this way.
- **Ladder (exploratory, n = 16):** MinerU reads every page lite refused, median CER 0.21%, but pooled 3.30% = **2.25×**
  lite's pooled 1.46% (bar 2×). The pooled number is dragged by the same footnote pages.
- **Before 1820 (19 books):** median Δ +2.34 pp. Long s read as f on 12/19 pages (81 per 1,000 words; 0 after 1820).
- **Digits:** silent misreads 2/819 (one "Prop. 11"→"1", twice) vs lite 0/689 and the Archive 11/819; plus 40
  visibly garbled (`2o`, `7oo`). Formula lines come out as `$$ 8 0 \times 1 8 9 8 0 $$` LaTeX, which `sanitize()` keeps.
- **Floor:** MinerU is not byte-deterministic (12/20 identical), but the CER floor is 0.00 pp median, 0.10 pp max.
- By eye: 10 pages + one pre-1820 page, `mineru-arm-byeye.jsonl`. Reference error found: en-699249-ws289 prints 118, ref has 119.
- *Replicated?* No. A footnote-restored arm (append the `page_footnote` blocks) is the obvious next run and needs a
  preregistration amendment first. It is not a worker change.
- Artifact: `results/en-ocr-ref-5124/mineru-arm-2026-09-30.{md,json}`; run ids `en-mineru-5182-2026-09`,
  `en-mineru-repeat-5182-2026-09`; `PREREGISTRATION-mineru-english-5182.md`; DECISIONS.md row "MinerU as peer or tier-3".
