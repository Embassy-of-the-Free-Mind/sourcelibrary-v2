---
stage: ocr
measure: [judged, agreement]
languages: [la, de, zh, grc, ar, he]
scripts: [Latn, Hani, Grek, Arab, Hebr]
canons: []
n_books: 150
n_pages: 1491
verdict: "Lane B at scale (main200, 150 of the most-read non-English books, 1,491 pages): a Gemini CLI second read adjudicated by Opus against the image wrote 214 pages (14%) and passed both blind write audits (Opus 0 worse of 78; Gemini 3.8 high 4 worse of 78, each an Opus/Gemini disagreement about the leaf, not written). Opus kept the stored read on 543 pages and left 427 residual, so the second read changed the served text on about one page in seven. 34 pages in 12 books were contained, including a whole book (Vitruvius) serving another leaf's text with a growing offset."
status: adopted
decision: "Lane B stays the OCR repair route for the most-read non-English books under Derek's 2026-10-11 default (#6553). Not yet measured, and the next routing question: whether Opus correcting the stored text against the image (one call per page, Gemini blind-checking a sample) matches this two-read lane — #6561 found correct-in-place beat a fresh read on Paddle Chinese, but only there. Run side by side on the same pages before switching."
superseded_by: null
issue: [6420, 6553, 6561, 6545]
---
PRIOR ART: 2026-10-10-ocr-convergence-gate-6420.md — same lane and preregistration on the 30-book gate; this entry is its scale-up to main200 after Derek's default, which the gate entry (status undecided, "nothing written") predates.

## 2026-10-13 · Lane B at scale: what does a Gemini second read plus Opus adjudication change on 150 of the most-read non-English books?

**Design.** As the gate (`scripts/eval/PREREGISTRATION-ocr-convergence-6420.md`), T = 0.01, every disagreement to
Opus (subscription, sealed `claude -p`, `ADJUDICATOR.md`), blind write audit of 40 staged writes per set by a fresh Opus
and Gemini 3.8 Flash high, stop if either finds more than 2 of 40 worse. Two sets: **main200a** (36 books, 360 pages:
Latin 290, German 50, Hebrew 20; reads `gemini-3.7-flash-low`) and **main200b** (114 books, 1,131 pages: Latin 470,
German 281, Chinese 180, Greek 150, Arabic 30, Hebrew 20). **Deviation:** agy withdrew 3.7 on 2026-10-12, so 315 of the
1,491 reads are `gemini-3.8-flash-low`; each read's meta and write reason name its model (#6635).

**Result.**

| Action | main200a | main200b | total |
|---|---:|---:|---:|
| agree (CER < T) | 68 | 117 | 185 |
| keep (Opus: stored read right) | 150 | 393 | 543 |
| write decided | 38 | 203 | 241 |
| → written | 26 | 188 | **214** |
| → refused by the shared-words guard | 9 | 15 | 24 |
| residual (merge or low confidence) | 91 | 336 | 427 |
| contain | 3 | 21 | 24 |
| defer (book in a translate lane) | 0 | 20 | 20 |
| no second read | 10 | 40 | 50 |

- Write audits: main200a Opus 35 better / 3 same / 0 worse, Gemini 35 / 0 / **3**; main200b Opus 39 / 1 / 0, Gemini 39 / 0 / **1**.
  All four Gemini "worse" pages are direct disagreements with Opus about what the leaf says (Fludd *demon-stretur*,
  *imperuestigabili/imperscrutabili*, Foresti folio 144/164, Ficino *uigesimotertio/uigisimoseptimo*); they were relabelled
  residual and not written. Both sets GO.
- Contained 34 pages in 12 books (hold `ocr-unsettled-6420` or `ocr-wrong-leaf-6420`, English withheld): neither read usable
  on 24; Vitruvius *De architectura* (`69af45f461b03be5fb7af39e`) serves another leaf's text on all 10 pages read, with an
  offset that grows through the book (p.44 holds p.XXXIV; p.270 holds printed p.216). Reg.gr.80, catalogued as Aristotle and
  Maximus, reads as Plutarch on 8 pages.
- 187 written pages are stamped `translation_stale: convergent-ocr-6420`.

**What this says for routing.** The second read is mostly confirmation: Opus kept the stored text or agreed on 728 pages and
wrote 214. Opus looked at every disagreeing page's image anyway. The cost is a Gemini read on every page plus an Opus read on
~80% of them. Whether Opus alone, correcting in place, does as well is not measured here (see decision).

**Replicated?** In part: the gate, main200a and main200b give the same pattern (Opus 0 worse in 118 audited writes; Gemini
3–4 per 40 at the gate, 3 and 1 here). Each verdict is still one Opus read.

**Artifacts.** `scripts/batch/ocr-convergence/results/run/main200a/` (#6599) and `results/run/main200b/` (#6662); apply runs
`cli-ocr-20261012065330` and `cli-ocr-20261013081553`; `book_checks` method `ocr-convergence`. Known gap: a `book_checks` note
counts guard-refused writes as written (Vitruvius's row says 10; none were).
