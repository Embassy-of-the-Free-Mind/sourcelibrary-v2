---
stage: translation
measure: accuracy
languages: []
scripts: []
canons: []
n_books: null
n_pages: 154
verdict: "Jev separates planted additions (AUC 0.96) but real ones less well (AUC 0.81); as a pre-screen halving Gemini reads it keeps 16 of 22 true additions (73%)."
status: undecided
decision: null
superseded_by: null
issue: 5982
---
## 2026-10-06 · Can Jev screen translated pages for untagged additions, in front of the Gemini detector? (#5982)
<!-- PRIOR ART: scripts/eval/jev/ (instruction-page, seam and Clef screens) never asked whether a translation adds words; scripts/eval/untagged-additions/ is the Gemini detector and its controls and by-eye labels, which this reuses as ground truth but does not test a cheaper first pass against. -->

**Question.** Jev (typed-decision model, $0.042/M input) answers yes/no probabilities per page with no prose. Could it rank pages so the Gemini sentence-level detector only reads the top?

**Method.** One state per page: source text (OCR) then translation, each cut to the first 6,000 characters (truncation: a planted sentence or an addition past 6,000 characters is invisible to Jev); tagged blocks (`note`, `gloss`, `summary`, `meta`, `keywords`, `image-desc`) are stripped from the translation first. Two noul questions per call, two wordings, no further tuning: w1 "the translation contains at least one sentence or clause that renders nothing in the source (an explanation, definition, description or comment added by the translator)"; w2 the reverse ("only a rendering ... nothing added"), scored as 1 - p. `mean` is their average. Script: `scripts/eval/jev/additions-screen-fetch.mjs` then `scripts/eval/jev/additions-screen.py`; scores per page in `scripts/eval/results/jev-additions-2026-10/` (no texts).

Labels: (a) round-2 controls of #5982 (37 pages with one planted commentary sentence, 57 clean pages; regenerated deterministically by `build-controls.mjs --round 2`, key unchanged). (b) the 60 live pages read by eye in #5982: 22 true additions, 38 not (16 false flags, 2 neighbour-page text, 20 unflagged pages with no addition of five words or more). Label basis: read from the source text, not the image. The live set is the Gemini-flagged 40 plus 20 unflagged, so it is enriched for hard pages and its precision is not a corpus precision.

**Results** (threshold = the value at which 90% of clean controls fall at or below it, so about 10% of clean controls flagged)

| | controls AUC | controls recall | clean flagged | live AUC | live precision | live recall |
|---|---:|---:|---:|---:|---:|---:|
| w1 | 0.964 | 32/37 = 86% | 6/57 = 11% | 0.803 | 16/30 = 53% | 16/22 = 73% |
| w2 | 0.959 | 86% | 5/57 | 0.760 | 15/31 = 48% | 68% |
| mean | 0.960 | 86% | 6/57 | 0.807 | 16/32 = 50% | 73% |

- **A/A:** 20 pages re-run (10 controls, 10 live): mean |delta p| 0.017 (w1), 0.012 (w2). The score is stable.
- **Cost:** 174 calls (154 pages + 20 A/A), 291,301 input tokens, $0.0122 gateway-billed ($0.00007 per page). The Gemini detector cost about $0.0013 per page in the same experiment: Jev is roughly 18 times cheaper.
- **Controls versus live:** planted whole-sentence commentary is nearly separable (AUC 0.96); real additions are not (AUC 0.80). Real ones are often short parentheses or a definition run into a sentence, and Jev flags 30 of 60 live pages at the control threshold, 14 of them with no addition.
- Of the 20 unflagged pages (no addition), Jev flagged 4 (20%); that is the false-flag rate at this threshold on ordinary pages.

**Limits.** n = 22 true live pages (AUC 95% interval wide, about +-0.1, not computed). One threshold, chosen on controls. Truncation at 6,000 characters. Wordings picked a priori, two tried, none tuned. The by-eye labels came from the same session that built the detector.

**Reading.** As a first pass that discards the bottom half of pages, Jev would keep 16 of 22 true additions (73%) and halve the Gemini reads; it would drop 6 of 22. That is a recall loss the detector does not have. Whether that trade is acceptable is a decision for the owner of #5982; this run does not make it.
