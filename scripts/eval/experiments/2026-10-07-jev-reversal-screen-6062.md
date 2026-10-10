## 2026-10-07 · Can Jev, asked one English sentence at a time, screen translations for reversed meaning? (#6062)
<!-- PRIOR ART: scripts/eval/translation-vs-reference/backtrans/ (#5695 extra test) built the 150-page labelled set and ran three reference-free detectors at page level (D3 page AUC 0.71); scripts/eval/jev/additions-screen.py asked Jev a page-level question about added words. Neither asked Jev the sentence-level question. -->

**Question.** Reversed meaning is the top translation defect in the #5695 reference runs (about 11 per 100 Latin pages, 16 Greek). The three reference-free detectors failed at page level (#5748). Jev works best on pairs. Does a sentence-sized question work better than a page-sized one?

**Answer.** No, not as a screen. Jev ranks sentences that the judges quoted as reversed above clean sentences (AUC 0.84), and it catches every planted negation flip (21 of 21). At any useful threshold, though, about 96 of every 100 flagged sentences in the library would be false alarms. Its page-level ranking (AUC 0.72) is no better than D3's 0.71, and it costs about 2.7 times more per page, because the source page is sent once per sentence. **Recommendation: do not adopt it.** Close #6062 as a null result. Reversals stay a reading task for the reference judges.

**Method.**
- **Labels:** `scripts/eval/results/xlref-backtrans-2026-10/set.jsonl`, the same 150 served pages D1–D3 were scored on: 47 pages where at least one of the two blind Opus judges quoted a reversal, and 103 random pages that neither judge marked reversed. The English is cleaned (notes, glosses, summaries and markup removed) and split into 2,437 sentences.
  - **Positive:** a sentence that contains or overlaps (at least 60% of the words) a judge's quoted reversal. 74 of the 75 quotes matched a sentence, giving 72 positive sentences.
  - **Negative:** every sentence of the 103 unreversed pages (1,516).
  - **Excluded:** the 849 unquoted sentences on reversed pages. They are used only for the page-level score.
  - The "8 gallery pages" in the issue are served pages from the same #5695 tracks, whose quoted reversals are already among the 75 quotes. No separate set was built.
- **Item:** the whole source page (first 6,000 characters) plus ONE English sentence. This is the "aligned pair" with the alignment left to Jev. The #5935 k-gram aligner matches same-language text and cannot align Latin or Tibetan to English.
- **Questions:** two noul wordings, fixed before the run and not tuned. w1: "the English sentence reverses the meaning of the source at the place it translates (negates what it affirms, affirms what it denies, says the opposite)". w2: "the English sentence agrees in meaning with the source", scored as 1 − p. `mean` is their average.
- **Positive control:** the #5695 gate's own plants (`raw/plants.json`: one negation dropped or added). Of the 30 plants, 21 changed exactly one sentence and kept the sentence count, so they could be paired. Each planted sentence is scored against its unplanted original.
- **A/A:** 60 random sentences, re-asked.
- **Code and data:** `scripts/eval/jev/reversal-screen.py`. Scores per sentence, with no text, are in `scripts/eval/results/jev-reversals-2026-10/`.

**Results** (2,437 sentences, 150 pages)

| wording | sentence AUC | page AUC (max over sentences) | planted > original | planted vs original AUC |
|---|---:|---:|---:|---:|
| w1 (reverses) | **0.837** | 0.714 | 21/21 | 0.982 |
| w2 (agrees, inverted) | 0.757 | 0.701 | 21/21 | 0.963 |
| mean | 0.805 | **0.723** | 21/21 | 0.982 |

w1 at three operating points. The threshold is set on clean sentences.

| clean sentences flagged | sentence recall | quoted reversals found | precision in this pool | precision at library base rate (0.84% of sentences) | pages flagged | reversed pages flagged | page precision, reweighted to 10.8% base rate |
|---|---:|---:|---:|---:|---:|---:|---:|
| 10% (p > 0.16) | 31/72 = 43% | 39/74 | 18% | **3.7%** | 102/150 | 41/47 | 15% |
| 5% (p > 0.24) | 21/72 = 29% | 29/74 | 22% | 4.8% | 78/150 | 35/47 | 18% |
| 1% (p > 0.50) | 8/72 = 11% | 15/74 | 33% | 8.2% | 34/150 | 20/47 | 28% |

- **A/A:** the mean change in p on a re-asked sentence is 0.010 (w1). The score is stable, so the weakness is in the signal itself, not in noise.
- **Sentence AUC by track (mean wording):** Latin 0.83, Greek 0.78, vernaculars 0.91 (one positive page), Hebrew/Arabic/Persian 0.72, Sanskrit/Pali/Chinese 0.78, Tengyur 0.89. All of these rest on 1–20 positives.
- **The plants are easy and the real reversals are not.** Planted flips raise p by 0.70 on average. A real reversal is usually a wrong referent (outer vs inner emptiness), a wrong voice, or a misread particle. That is the same split D3 showed (93% of plants caught against about 34% of real reversals at the right spot).
- **Top false alarms, read from the English only** (the source is not read by eye): Tibetan p.513 and p.528, Sanskrit p.722, a Dutch page whose English is itself garbled, a Persian page, and Tibetan p.589. One of them looks like it could be a real error the judges did not quote: Tengyur [p.528](https://sourcelibrary.org/book/6abeafd3896ea18127c8218e?page=528), "if these three features are not complete, one becomes a Universal Monarch". That would put true precision a little above the judge-based figure. It would not lift it to a usable level.

**Cost.** 2,512 calls, 6.2M input tokens, $0.261 (gateway-billed), which is $0.0017 per page. D3 (Flash-Lite page check) costs $0.00062 per page at the same page AUC, so Jev here is about 2.7 times dearer, not cheaper. The page-level Jev pilots cost about $0.00007 per page.

**Limits.**
- **Labels are agreement with two Opus judges** who had a reference, not truth.
- **Few positives:** 72 positive sentences on 47 pages, so per-track figures carry no weight.
- **Base-rate estimate:** the library base rate of a reversed sentence (0.84%) is the quoted share of sentences on reversed pages (7.8%) × the 10.8% page base rate from the #5695 universe. Precision scales with it.
- **The judges quote one or two spots per page.** An unquoted reversal on a clean-labelled page counts here as a false alarm.
- **Untested variants:** one model, two wordings, no source alignment, and the source is cut at 6,000 characters (a few long pages).
