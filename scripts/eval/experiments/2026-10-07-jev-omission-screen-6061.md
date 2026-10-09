## 2026-10-07 · Can Jev screen served translations for omissions (source text left out of the English)? (#6061)
<!-- PRIOR ART: 2026-10-06-jev-additions-screen-5982.md asked Jev the opposite question (words added) on the same client and threshold rule; the #5695 translation-vs-reference tracks (2026-10-04-translation-vs-reference-synthesis-5695.md) are the omission labels this reuses. Neither tested a cheap screen for omissions. -->

**Question.** Omission is the most frequent fidelity defect the #5695 judges found (40% of 321 served pages; Sanskrit 70%). Can Jev (typed-decision model, about $0.00009 per page) rank pages so that a reviewer or a costlier judge reads the likely omissions first?

**Method.** One state per page: the OCR source text, then the served English. The OCR's own metadata tags are stripped from the source, and notes, summaries and page metadata from the English (they render nothing of the source). Runs of `&nbsp;` padding are collapsed. A page longer than 6,000 characters on either side is split into proportional chunks that overlap their neighbours by 12%; the page score is the highest chunk score. That applies to 13 of 321 pages. Two noul wordings were set before the run and not tuned. w1: "the translation leaves out at least one sentence or clause of the source text…". w2 is the reverse ("renders the whole source text…"), scored 1 − p. `mean` is their average. Scripts: `scripts/eval/jev/omission-screen-fetch.mjs`, then `scripts/eval/jev/omission-screen.py`. Scores per page are in `scripts/eval/results/jev-omissions-2026-10/` (ids and scores only, no texts).

Labels:
- **(a) Planted controls.** 40 clean pages (no omission flagged, fidelity ≥ 4; seed 6061). One English sentence of eight or more words, neither the first nor the last, is deleted from each. Each planted page is paired with the same page unmodified.
- **(b) Live pages.** All 321 #5695 served pages with their judges' label: omission is true when either of two blind Opus judges flagged a sentence, clause, list item, name, number or repeated formula on the source page as absent. The judges read the transcription and a published reference, not the image. 129 pages carry an omission and 192 do not.

The threshold is the score at which 90% of the 40 clean pages fall at or below it, the same rule as the #5982 additions screen.

**Results** (second run, after the `&nbsp;` fix below)

| | controls AUC | planted recall | clean flagged | live AUC | live precision | live recall |
|---|---:|---:|---:|---:|---:|---:|
| w1 | 0.901 | 23/40 = 58% | 4/40 | **0.749** | 51/75 = **68%** | 51/129 = **40%** |
| w2 | 0.794 | 45% | 4/40 | 0.724 | 42/63 = 67% | 33% |
| mean | 0.860 | 48% | 4/40 | 0.746 | 46/68 = 68% | 36% |

- **Base rate:** 40% of live pages carry an omission. Flagging 75 pages at 68% precision is a 1.7× lift over reading pages at random.
- **By track (w1, live AUC):** Latin 0.82 (all 8 pages flagged were true), vernaculars 0.75 (7 omissions in 59 pages), Sanskrit/Pali/Chinese 0.68, Hebrew/Arabic/Persian 0.67, Greek 0.66.
- **A/A:** the same 20 pages were asked again (10 planted, 10 live). Mean |Δp| was 0.025 (w1) and 0.029 (w2); the largest was 0.09. The score is stable, so the gap between controls and live pages is not noise.
- **The 2 pages re-translated after judging** change nothing (AUC 0.747 without them).
- **Length is not the signal.** The ratio of English to source characters gives live AUC 0.55. Combining it with Jev by rank lowers the AUC to 0.71.
- **Cost:** two full runs of 396–401 calls each, $0.069 gateway-billed in all ($0.0337 for the reported run, about $0.00009 per call).

**First run, and the fix.** The first run (live AUC 0.714, w1) left the `&nbsp;` padding in. One Latin page had 19,377 source characters, most of them padding, against 1,822 English characters. Its proportional chunks then paired different passages, and Jev scored it 0.94 on a complete translation. Collapsing the padding raised live AUC to 0.749. Neither the wordings nor the threshold were changed between runs.

**Spot check of the disagreements** (read from the stored source and English texts, not the page image; 5 pages Jev ranked highest whose label is "no omission", 2 lowest with "omission"):
- Clement, *Paedagogus* p.142 ([link](https://sourcelibrary.org/book/69942a43045dfc482ad76202?page=142)), labelled no omission, Jev 0.94 in run 1 and 0.68 in run 2 (just under the 0.78 threshold). **Jev is right:** the English stops at "belly-demon" and the last two source sentences are not rendered. The judges' reference cut presumably ended there.
- Pseudo-Dionysius p.116 (a Greek page whose OCR repeats one word in a loop), Orphic Hymns p.381 (critical apparatus), Gregory of Nyssa p.502 and Acosta p.444 are complete renderings. These are Jev's false flags, and three of the four are apparatus- or loop-heavy pages.
- Samaritan Pentateuch p.342 ([link](https://sourcelibrary.org/book/69920bb1e0a548a13d884da7?page=342)), labelled omission, Jev 0.38. The English renders verses 16–28 and drops the whole textual apparatus below them. **Jev misses a whole untranslated block** when the main text is complete.

**Limits.** The labels are judged, not accuracy, and are noisy in both directions: one of five high-scoring "negatives" read was a real omission. The planted controls are single sentences of eight or more words; real omissions are often a clause, a name or a number, which is harder still. Only 13 pages were long enough to need chunking, so the chunking itself is barely tested. There was one threshold, chosen on 40 clean pages, and two wordings, not tuned.

**Reading.** Jev is a weak omission screen.
- At the control threshold it misses 42% of planted whole-sentence deletions and 60% of judged live omissions. As a gate in front of a judge it would drop most omissions.
- As a **ranker** (read the highest-scored pages first) it offers a 1.7× lift, strongest on Latin.

**Recommendation: do not adopt it as a screen.** Use it at most to order a by-eye review queue. A cheaper, more direct check for the commonest large omission seen here, an untranslated apparatus or commentary block, is structural (blocks present in the OCR but absent from the English), not a yes/no question to Jev. The question asked in #6062 (reversals, sentence pairs) suits Jev's strength on short paired texts better than a whole-page omission question does.
