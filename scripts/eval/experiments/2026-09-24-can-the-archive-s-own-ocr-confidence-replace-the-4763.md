---
stage: ocr
measure: agreement
languages: []
scripts: []
canons: []
n_books: 129
n_pages: null
verdict: "IA word confidence cannot replace the paid gate sample: rejected books score higher (73 vs 51), r = -0.11; the scale is not comparable between items"
status: rejected
decision: "IA x-confidence not used to gate free text fills; the paid preview sample stays (#4763)"
superseded_by: null
issue: [4763, 4784]
---
## 2026-09-24 — can the Archive's own OCR confidence replace the paid reference? NO (#4763, #4784)

**Question.** The free IA text lane admits a book only when the Archive's reading agrees with OUR
model's reading of the same leaves, so every candidate must first be given a paid OCR sample
(today a 25-page Phase 1.5 preview). `ocr-plausibility.mjs` names a free alternative as its own
blind spot: the engine's per-word confidence, `x_wconf` in the Archive's hOCR. If that separated
the books the paid gate rejects, the sample could shrink or go away.

**It is even cheaper to read than that note implies.** The confidence is already in the
`_djvu.xml` the ingester downloads, as `x-confidence` on every `<WORD>` — no extra request, just a
second pass over bytes on disk. `scripts/lib/ia-ocr-confidence.mjs` parses it;
`scripts/eval/ia-confidence-vs-gate.mjs` scores it against the gate's own verdicts. Both free.

**Result: it does not work, and it fails BACKWARDS.** Over 129 books of the #4966 cohort that the
free gate had judged (126 ACCEPT / 3 REJECT):

| | median mean-confidence |
|---|---|
| ACCEPTED | 51.0 |
| REJECTED | **73.0** |

Rejected books score HIGHER. Pearson r(agreement, mean confidence) = **−0.112**. A cutoff catching
all three rejects would refuse **71.4%** of the accepted books.

**Why: the scale is not comparable between items.** Per-item median confidence over 1,710 cached
XMLs is bimodal — min 5, p10 29, p25 32, median 53, p75 93, max 100 — a cluster near 30 and
another near 95. The median word in a lower-quartile item scores a third of the median word in an
upper-quartile one, so no single threshold can mean the same thing in both.

**And it is NOT a producer artifact, so normalising cannot rescue it.** Within one declared engine
(`ABBYY FineReader 0.0.21`, n=100) per-book mean confidence still ranges **25 to 100**, median
46.4. Same engine string, fourfold spread.

**Two of my own probes failed first, and both would have produced a wrong answer:**
- A scan of 600 of the 1,945 cached files reported "0 items with a constant value", and I had
  already opened a book emitting exactly 100 for all 9,798 of its words. The file simply was not
  in the sampled 600. Re-run over all 1,945: exactly **1** constant item — a curiosity, not the
  mechanism I had briefly made it.
- A producer-split probe returned `(none declared)` for **100%** of items, i.e. it never matched
  anything. That is a dead probe, not evidence that producers agree
  ([[lesson_probe_needs_a_positive_control]]). Redone against the engine string the Archive's
  metadata declares, which the gate log already prints.

**What survives.** Nothing at BOOK level: confidence cannot gate a fill. Within a single item the
values do vary meaningfully, which is the page-level job #4784 actually asked for — ranking the
worst leaves inside a book whose text was already accepted. That is a different instrument and
needs hand-graded pages, not this eval.

**Standing caveat.** The reference here is the gate's own verdict, which is itself a model-vs-model
comparison, not ground truth. n(reject) = 3 is far too small to have built a threshold on even had
the separation been clean — the useful output was the ABSENCE of separation, which n=3 can show
and a threshold cannot be drawn from.
