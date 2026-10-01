## 2026-09-30 (later) — POST-HOC: the same MinerU rule, re-applied with PR #5299's footnote step (#5182)

**Headline: with footnotes kept, the fixed rule says PEER, but this is a re-analysis, not a preregistered result.**
The rule was fixed before the footnote step existed. The step was designed after seeing the preregistered arm's
failures (entry below). MinerU was re-run (`en-mineru-fn-5182-2026-09`, $0, CPU) because the first run's raw output
was not kept, and PR #5299's `readPageFootnotes()` + assembly were applied verbatim. Footnotes were appended on 26/122 pages.
- **ALL cell, before → after:** catastrophic 2.6% → **0.0%**; median CER 0.66% → 0.45%; pooled 6.17% → 1.84%.
  Paired vs lite: MinerU better 10 / lite better 49 → 10 / **34**, median Δ +0.19 → **+0.08 pp** [0.00, 0.15].
- **Ladder (exploratory, n = 16):** pooled CER on lite-refused pages 3.30% → 1.39% = **0.95×** lite's pooled rate.
- **By period:** 1880–1930 median Δ 0.00 pp (decision, 70 books); 1820–1879 +0.06 pp (exploratory, 25); **before 1820 still
  +2.05 pp** (long s — the footnote step does not touch it).
- **Omission pages:** 8 of 10 repaired to ≤ 1.6% CER. Two were not: en-6aa1d5-ws52 (notes already in the body; the
  residual error is elsewhere, Hebrew among it) and en-699200-ws404 (note appended, 21.8% remains). Neither was read by eye.
- **Caveat that the median hides:** lite still wins the page-by-page count 34–10 (sign p < 0.001). PEER here means
  "within 0.2 pp at the median", which the rule's authors chose, not "as good as lite on every page".
- *Replicated?* No. A fresh preregistration on new pages, or a second draw, is what would confirm it.
- Artifact: `results/en-ocr-ref-5124/mineru-fn-arm-2026-09-30.{md,json}` (§9 = before/after); DECISIONS.md second MinerU row.
