---
stage: metadata
measure: agreement
languages: []
scripts: []
canons: []
n_books: null
n_pages: 4245
verdict: "Jev ranks a topic rubric (animism) against the flash-lite screen + Gemini CLI judge at AUC 0.92 (0.87 on the hard judged set); at 0.5 it keeps 96% of confirmed passages and flags 2.1% of random pages, for $0.00005 a page."
status: adopted
decision: "Jev is usable as a cheap topic ranker in front of the two-pass instrument; it does not replace the judge, and its scores are not rates."
superseded_by: null
issue: 6652
---
PRIOR ART: scripts/eval/experiments/2026-09-24-can-jev-typesafe-s-typed-decision-model-screen-pages.md — same use (rubric screen, AUC 0.94 vs Sonnet labels) on a different topic and reference; this records the topic-ranker result for the aliveness atlas.

## 2026-10-13 · Can Jev rank pages for a topic rubric, as a search engine in front of the judge? (#6652)

**Question.** The aliveness atlas's animism layer (the inhabited world) is read by a flash-lite screen with a verbatim
evidence gate and then a Gemini CLI judge. Could Jev (`typesafe-ai/jev`, a different maker) score every page cheaply
enough to replace the 60-pages-per-phrase sample with a census?

**Method.** `scripts/analysis/experience-map/classify/jev-animism.py`: the judge's rubric as one noul question plus the
reverse wording scored 1 - p, averaged; first 6,000 characters of the English translation. 4,245 pages scored: the
3,500-page phrase draw and the 745-page random baseline. Reference = the two-pass instrument (screen positive, quote
verbatim, judge confirmed). Wordings a priori, not tuned.

**Result.** n = 906 confirmed, 3,339 not. AUC 0.918 on all scored pages; 0.865 among the 2,516 pages the judge read
(the harder set, all of them screen positives). At a 0.5 cut: recall 95.7% (94.2–96.8), agreement 73.8%, random pages
flagged 2.1% (1.3–3.5). The two-pass instrument confirmed 1 of 745 random pages, so baseline AUC (0.997) rests on one
positive and is not quoted. Cost $0.20 for 4,245 pages (4.79M input tokens).

**Reading.** At 2% of random pages flagged, a whole-corpus Jev pass would cut the pages a stronger reader must see by
about 45 times while keeping ~96% of what it would confirm. Agreement at the cut is 74%, so Jev is a ranker, not a
classifier: counts and rates still come from the judge. The reference is itself two Gemini models, so this measures
agreement with the instrument, not accuracy against a human reader.

**Limits.** One topic, one wording pair, 6,000-character truncation, English translations only.
