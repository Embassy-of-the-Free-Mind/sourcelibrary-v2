---
stage: ocr
measure: judged
languages: [la]
scripts: [Latn]
canons: []
n_books: 6
n_pages: 1638
verdict: "The rate of classical 'ae/oe' spellings in the OCR of pre-1520 Latin does not find pages the OCR paraphrased: two of three by-eye paraphrased Bracton pages score 0, and a well-read 1498 print has pages as high as the worst."
status: rejected
decision: "No detector built. Paraphrased medieval Latin goes to the stronger-reader lane (#6056), not a model-free screen."
superseded_by: null
issue: 6056
---
## 2026-10-25 · Does classical spelling in early Latin OCR betray a paraphrase? No (#6056)

PRIOR ART: `scripts/audit/ocr-garble-lexicon.mjs` + `scripts/lib/ocr-garble-score.mjs` (#5313) score non-words against a corpus lexicon, not orthography that is too *correct* for its period; #7100 is the same rewrite failure in English originals, judged by a model. No spelling-period screen existed (looked: `git grep` orthograph/classical/normaliz over scripts/audit, scripts/lib, scripts/eval/lib; `gh issue list` for normalised/modernised spelling).

**Question.** Round 6 found Bracton ca. 1390 p148 transcribed as fluent classical Latin ("praesens … disseisinae") where the
leaf has the scribe's medieval spelling ("presens … disseisine"). Medieval scribes and printers before about 1520 write
*e* for classical *ae*, so a faithful OCR keeps it. Is the rate of *ae/æ/oe/œ* tokens per 1,000 words, against the book's
own median, a $0 screen for OCR that rewrote rather than read?

**Design.** All OCR'd pages (≥ 80 words) of six books with by-eye verdicts from spot-check rounds 3–6: two Bracton manuscripts
whose sampled pages are paraphrased or misread throughout (r3 pp203–205, r6 pp148–150; second reader confirmed), one
unreviewed manuscript of the same family, two early prints read well (Summa Angelica 1498, OCR 3–4; Pimander 1505, OCR 4),
and the Aldine Claudian 1523 as the humanist confound. Prototype script on Hetzner, read-only.

**Result.**
| book | pages | median /1k | p90 /1k | sampled pages |
|---|---|---|---|---|
| Bracton ca. 1390 MS (bad) | 379 | 1.8 | 20.6 | p148 **31**, p149 **0**, p150 12 |
| Bracton ca. 1300 MS (bad) | 361 | 1.9 | 19.8 | p203 **1**, p204 0, p205 16 |
| Summa de legibus ca. 1400 MS | 205 | 1.4 | 8.1 | — |
| Summa Angelica 1498 (good) | 535 | 3.2 | 18.5 | p525 2, p526 0, p527 6 |
| Pimander 1505 (good) | 163 | 0.0 | 8.7 | p31 0, p32 0, p33 7 |
| Claudian Aldine 1523 | 355 | 51.3 | 77.9 | humanist spelling restored |

The positive control flags (p148), but its neighbours p149 and r3 p203 are as badly read and score 0–1: the paraphrase
there keeps medieval spelling. Book medians do not separate the bad manuscripts (1.8–1.9) from the good print (3.2), and
the good print's p90 (18.5) sits with the bad ones'. From about 1520 humanist printing restores *ae* (Claudian 51/1k), so
the screen would also need a date cut it cannot take from `published` (free text).

**Why it fails.** The model rewrites the *words*, not consistently the spelling: on one page it classicises, on the next it
paraphrases in the scribe's orthography. Spelling was a symptom of one page, not of the class.

**What to use instead.** Prior work already ruled out the other $0 screens: the corpus-lexicon garble score (P 0.24–0.60,
`2026-09-30-can-a-0-per-page-garble-score-find-the-5313.md`) and two-read disagreement as a gate (P 0.3–0.45; kept only to
pick pages for Opus, `2026-09-30-does-disagreement-between-two-reads-of-one-page-find-5313.md`). A second Flash read of a
Flash-read page buys nothing (`2026-10-04-reocr-lift-5700.md`), and Bracton is Flash-read. Medieval abbreviated Latin
needs a stronger reader, not a screen: the two-read lane in #6056.

**Replicated?** No. Cost $0.
