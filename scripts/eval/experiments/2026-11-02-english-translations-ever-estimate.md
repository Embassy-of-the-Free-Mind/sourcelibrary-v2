---
stage: metadata
measure: [judged, agreement]
languages: [la, de, fr, it, es, nl, en]
scripts: [Latn]
canons: []
n_books: 2500
n_pages: null
verdict: "Of about 855,000 works first printed in Europe 1400–1700 in six languages (USTC, grouped into works), roughly 26,000 to 73,000 have ever been published in English (3–9%), from the sampled shares already measured (Latin n=1000, #2684; five vernaculars n=300 each, 2026-10-30) times the work counts. Latin is 21,400–46,000 of it. A capture–recapture estimate from the three catalogue lists (LoC 041$h, Open Library, Wikidata) on the Latin works they land on gives only about 800 to 1,900: the lists share one blind spot, so they estimate the catalogue-visible part, about 2–9% of the sampled figure. The Renaissance Cultural Crossroads catalogue (6,482 entries in 2020, translations printed in Britain 1473–1640, editions) is a floor and is consistent. Source Library has 6,533 of these works readable in English. 2026-11-02."
status: informational
decision: "Published as /articles/how-many-translated-into-english. No write to any store. The catalogue-only figure must never be quoted as the size of the English record."
superseded_by: null
issue: [7751, 7769, 2684]
---
## 2026-11-02 · How many early printed works have ever been translated into English? Three estimates (#7751)
<!-- PRIOR ART: 2026-10-30-translation-share-by-language.md (the vernacular shares used here), .claude/docs/translation-gap-methodology.md (the Latin n=1000 study), the #7769 landing table (per-source counts on earthai-l7a, /data/scratch/sl/jobs/translation-staging-7769-mv/landing-table.txt). Nothing new was sampled or searched; this note combines measured figures and adds the capture–recapture step. -->

**Question.** Nobody has counted how many of the works printed before 1700 have ever been put into English. Derek asked whether it can be estimated. Three instruments, each with a different bias, were combined. No model calls and no writes.

### 1. Sampled share × number of works

Frames: phase-11 USTC works (K=6, PR #7774). Shares: Latin from the June n=1000 study (93% of Renaissance-composed works have no English; 85% of all works printed in the period have none, because the frame includes ancient and medieval texts reprinted then). Vernaculars from the 2026-10-30 study, n≈300 each: low = works composed in the language with an English translation (N column); high = any English edition, the larger of the raw share and the Rogan–Gladen corrected share.

| Language | Works | Share low–high | Works in English |
|---|---|---|---|
| Latin | 306,352 | 7–15% | 21,400–46,000 |
| French | 124,168 | 1.3–8.7% | 1,600–10,800 |
| Dutch | 74,378 | 0.7–7.6% | 500–5,700 |
| Spanish | 59,582 | 1.7–7.6% | 1,000–4,500 |
| Italian | 68,819 | 1.7–4.9% | 1,200–3,400 |
| German | 221,931 | 0.3–1.3% | 700–2,900 |
| **Total** | **855,230** | | **26,400–73,200** |

Caveats:
- The vernacular frames count each newspaper issue as a work (German 69,646 issues; fixed later in #7814). Newspapers are almost never translated, so the share falls and the work count rises by about the same factor; the product barely moves (German excluding newspapers: 2.0% of ~152,000 ≈ 3,000).
- The vernacular intervals rest on about 13 confirmed positives in the 60-work double-read subsets. They are wide and the point estimates are not stable.
- Searches were run by AI agents; no human panel yet. Search misses push the figure down; the Latin study's false positives were few.

### 2. Capture–recapture on the catalogue lists (Latin)

The three staged lists of English translations, landed on Latin USTC works (#7769 landing table): LoC 498 works, Open Library 104, Wikidata 53; union 576; works in one list only: 419, 57, 18. Assuming no work is in all three (the counts give −3 for the triple, i.e. about zero), the pairwise overlaps are LoC∩OL ≈ 45, LoC∩WD ≈ 33, OL∩WD ≈ 2.

Chapman estimator N = (n1+1)(n2+1)/(m+1) − 1:
- LoC × Open Library: 499 × 105 / 46 − 1 ≈ **1,140**
- LoC × Wikidata: 499 × 54 / 34 − 1 ≈ **790**
- Open Library × Wikidata: 105 × 54 / 3 − 1 ≈ **1,890** (two shared works; unstable)

Random landing failure does not bias this (it scales both counts and the overlap together). Dependence does: all three lists are modern library records and favour the same famous works and the same recent translations, so the overlap is too large and N too small. The method estimates the population the catalogues are able to see, about 800–1,900 Latin works, against 21,400–46,000 from sampling. Consistent with the two direct checks of catalogue recall: Latin catalogues find English for 1.4% of works against a sampled 7–15%; in the vernacular study, 0 of 72 confirmed translations were in the catalogues.

### 3. An outside count

Renaissance Cultural Crossroads (Warwick, Barker and Hosington): translations printed in England, Scotland and Ireland, and English translations printed abroad, 1473–1640. "Over four thousand translations" (project page); 6,482 entries in 2020 (review in *Renaissance et Réforme* 43.3, 2020). Entries are editions and include translations into Latin and other languages. Even counted whole it is a tenth of the low estimate, which is expected: it stops in 1640 and counts only what was printed in Britain then, while estimate 1 counts translations made at any date up to now. It is a floor, and the estimate clears it.

### Source Library

Within these six frames, Source Library has 6,533 works readable in English (Latin 5,234, German 652, Dutch 221, French 204, Italian 193, Spanish 29; phase-11 reports, `readable.sl`). That is the same order as a tenth to a quarter of the estimated English record for this period, although some of them had been translated before.

### Reproduce

Landing table and reports: earthai-l7a `/data/scratch/sl/jobs/translation-staging-7769-mv/`. Shares: the two prior experiment files. Arithmetic: this file.
