---
stage: ocr
measure: agreement
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 258
n_pages: 258
verdict: "PASS by the preregistered rule. Paddle re-read with layout detection off disagrees with itself where it is wrong: on 200 Siku pages AUROC 0.90 (dMax 0.89), Spearman 0.80 with CER against the page's own Kanripo leaf, and every page it flags at >= 5% disagreement is wrong (69/69). On the 58 pages that carry a 3.8 Flash-low read it beats that read (AUROC 0.74 vs 0.65). Re-running the same settings tells nothing (Paddle is near-deterministic: 1 page flagged of 200). It is high-precision, low-recall: it finds about half the wrong pages."
status: informational
decision: null
superseded_by: null
issue: [6871]
---
## 2026-11-17 · Does Paddle disagreeing with itself flag its own errors? (#6871)

PRIOR ART: `2026-10-12-paddle-zh-correct-vs-redo-6561.md` (the flag-signal table this extends: Kanripo dice and a
3.8 Flash-low second read). Code and preregistration: `scripts/eval/paddle-self-agree-6871/`; per-page rows: `scripts/eval/results/paddle-self-agree-6871/`.

**Why.** Pages with no Kanripo text (Chinese print, non-Siku) have no free flag. A second engine read costs agy quota.
A Paddle re-read under other settings costs only owned GPU time: 258 pages × 3 extra arms took 6.6 min on gex45.

**Design** (PREREG.md, committed before the run). 150 random zh-shi-ji-8053 pages (R), 50 with lane dice 0.6–0.9 (L),
58 #6561 set-B pages with a stored Flash-low read (F); every page has a trusted own Kanripo WYG leaf. Arms: P production
(layout on, server, width 2400), R = P again, L = layout off, S = long side 1600 px. Truth: P's Han CER against the leaf;
wrong = CER > 5%. Signal: symmetric Han CER between P and another read; flag at ≥ 5%.

**Result.**

| set | signal | Spearman | AUROC | flagged | precision | recall |
|---|---|---|---|---|---|---|
| R+L (200, 124 wrong) | dL layout off | 0.80 | 0.90 | 69 | 1.00 | 0.56 |
| | dMax (primary) | 0.77 | 0.89 | 76 | 0.96 | 0.59 |
| | dS 1600 px | 0.55 | 0.77 | 41 | 0.93 | 0.31 |
| | dR same settings | 0.24 | 0.56 | 1 | 1.00 | 0.01 |
| | lane Kanripo dice (drew the pages; reference only) | 0.77 | 0.88 | 165 | 0.73 | 0.97 |
| F (58, 28 wrong) | dL | 0.48 | 0.74 | 10 | 1.00 | 0.36 |
| | dMax | 0.42 | 0.72 | 11 | 0.91 | 0.36 |
| | 3.8 Flash-low second read | 0.29 | 0.65 | 33 | 0.61 | 0.71 |
| | Kanripo dice | 0.77 | 0.92 | 36 | 0.69 | 0.89 |

**Reading it.**
- The preregistered bars pass: usable (AUROC 0.89 ≥ 0.75, ρ 0.77 ≥ 0.5) and as good as Flash-low on F (0.72 vs 0.65).
- **Layout off is the signal; same-settings repeats are worthless.** Paddle on vLLM is near-deterministic (dR > 0 on
  27 of 258 pages, tiny). The image-size change adds little beyond layout off.
- **High precision, about half recall.** A flagged page is almost always wrong; an unflagged page may still be wrong.
  Where Kanripo exists, its dice remains the better flag (it catches ~95% of wrong pages).
- **The 5% truth line is near the median.** Random-page median CER against Kanripo is 5.5% (q75 7.7%; 22/150 > 10%,
  10/150 > 20%). Part of that is edition difference between our scan and Kanripo's text (#6388: pages Opus called clean
  had median CER 2.9%), so "wrong" here means "materially off the leaf", not necessarily misread.
- Not tested: corpora with no Kanripo text (woodblock print, Japanese, non-Siku manuscripts), where this flag would be
  used. A by-eye or Opus-judged check of flagged vs unflagged pages there is the next step before routing on it.

**Proposed use.** For Paddle pages with no reference text: a layout-off second Paddle pass (~0.45 s/page on gex45),
route pages with dis ≥ 5% to correction (Opus, per #6561) — a cheap, high-precision first cut that saves agy quota.
