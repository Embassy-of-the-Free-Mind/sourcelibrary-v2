---
stage: ocr
measure: agreement
languages: [ja, lzh]
scripts: [Jpan, Hani]
canons: []
n_books: 7
n_pages: 20
verdict: "On 20 frozen Meiji typeset pages, NDLOCR-Lite and stored flash-lite agree at median bigram Dice 0.88. None of the three preregistered triggers fired (Dice < 0.6 on 2/20, needs 5; lite loop/textless 0, needs 2; N right over a 10+ char span 1/5 by eye, needs 2), so no scored prereg for a second NDL modern-print lane."
status: informational
decision: "Per the prereg: lite stays the Meiji typeset reader; no NDL modern-print lane is pursued (#5100)"
superseded_by: null
issue: [5100, 6871]
---
## 2026-10-22 · Is NDLOCR (modern print) worth a scored prereg as a second lane for Meiji typeset Japanese? (#5100)
<!-- PRIOR ART: 2026-10-22-ndl-koten-full-run-eye-check-5100.md (the classical NDL lane); 2026-09-30-ndl-classical-ocr-lane-20-book-pilot-written-and-4925.md; scripts/workers/ndl-koten-lane.mjs compare (the agreement measure reused here). -->

**Design.** This run is descriptive. It wrote nothing to Mongo and made no paid calls. It was preregistered in
`scripts/eval/ndl-meiji-5100/PREREGISTRATION.md` (0279ae5de), with the 20-page sample (`pages.json`) frozen before any
read. All 20 images fetched; no page was swapped.
- **N.** NDLOCR-Lite, github.com/ndl-lab/ndlocr-lite @ `d001dad2013ceabb5736ff8d637474e443eb73c2` (CC BY 4.0), default
  models. It ran on the GEX45 CPU on 4 cores at nice 10, with no GPU, at **9.8 s/page** wall time including model load.
  Vertical reading order was checked by eye on 枕草子 p.529: headnote columns right to left, then the body right to
  left, with ruby dropped.
- **L.** The stored `ocr.data` (`gemini-3.1-flash-lite`). `content_hash` values are in `results.json`.
- **Measures.** `score.mjs`: bigram Dice and whitespace-free edit agreement. Both are AGREEMENT measures, not accuracy.
  Then a 5-page by-eye packet, one page per work, seed 5100.

**Result** (`scripts/eval/results/ndl-meiji-5100/`)
- Median Dice is **0.88** and median edit agreement **0.883**. Median characters: N 554, L 560. Neither arm looped
  by `loopVerdict`.
- **Rule 1** (Dice < 0.6 on ≥ 5 pages): **2/20**, not met. Both pages are the 1912 冠註無門関, which is kanbun with
  kunten in a two-page commentary layout (Dice 0.13 and 0.34). The other 18 pages lie between 0.68 and 0.92.
- **Rule 2** (L loops or is textless where N reads ≥ 100 chars, on ≥ 2 pages): **0**, not met.
- **Rule 3** (N right where L is wrong on a ≥ 10-char span, on ≥ 2 of 5 eye pages): **1/5**, not met. The one hit is
  冠註無門関 p.10, where L drops or paraphrases two commentary items that N reads almost right. On that same page N
  scrambles the main text into the commentary and loops `地震` ×30. On 枕草子 p.397 it runs the other way: N drops a
  13-character clause and duplicates another. On typeset kana-majiri pages, N was the more literal arm on 2 of 4 pages
  (益軒 p.853, 猫 p.19). There L's errors are scattered single characters, plus ruby that is not printed. None of them
  reaches 10 characters.

**Verdict.** None of the three rules fired, so per the prereg lite stays the Meiji reader and no second lane is
pursued. Two side observations, not decisions:
- On clean typeset Meiji pages, N's single-character accuracy looks at least as good as lite's. This is free CPU
  (~10 s/page). If a cheap *cross-check* lane is ever wanted, that is the place to look; a replacement lane is not.
- `loopVerdict` did not flag N's short-period runs (`地震` ×30 on p.10; `仝`/`第` runs on p.6). If NDL output is
  ever stored, it needs its own repetition check.
