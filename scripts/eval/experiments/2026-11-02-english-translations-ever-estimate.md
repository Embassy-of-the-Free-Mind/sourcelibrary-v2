---
stage: metadata
measure: [judged, agreement]
languages: [la, de, fr, it, es, nl, en]
scripts: [Latn]
canons: []
n_books: 2500
n_pages: null
verdict: "Of about 815,000 works first printed in Europe 1400–1700 in six languages (USTC, grouped into works), roughly 20,700 to 33,600 have ever been published in English (2.5–4%). Latin is 15,600–25,400 (the validated work-level count, translation-gap-paper.md §5.10, paper reading, 95% interval); the five vernaculars add 5,100–8,200, counting only works composed in the language (17 sampled positives). A capture–recapture estimate from the LoC, Open Library and Wikidata lists on Latin gives about 800–1,900: the lists share one blind spot, so it measures what they can see, about a tenth. Renaissance Cultural Crossroads ('over four thousand translations' printed in Britain 1473–1640) is a floor, cleared. Source Library has 6,533 of these works readable in English, a fifth to a third of the English record. A first draft (26,000–73,000) was wrong; see Corrections. 2026-11-02."
status: informational
decision: "Published as /articles/how-many-translated-into-english. No write to any store. The catalogue-only figure must never be quoted as the size of the English record."
superseded_by: null
issue: [7954, 7751, 7769, 2684]
---
## 2026-11-02 · How many early printed works have ever been translated into English? Three estimates (#7954)
<!-- PRIOR ART: translation-gap-paper.md §5.7–5.10 (Latin work-level counts, catalogue capture); 2026-10-30-translation-share-by-language.md (the vernacular samples and origin tags); the #7769 landing table (earthai-l7a, /data/scratch/sl/jobs/translation-staging-7769-mv/landing-table.txt). Nothing new was sampled or searched; this note combines measured figures and adds the capture–recapture step. -->

**Question.** Nobody has counted how many of the works printed before 1700 have ever been put into English. Three instruments with different biases. No model calls and no writes.

### 1. Sampled share × number of works

**Latin** is taken whole from `translation-gap-paper.md` §5.10: translated works, all print 1400–1700, extrapolated from the 1480–1620 sample, corrected for title-group splitting: **20,176 [15,636–25,374]** (paper reading) of 266,593 works. Renaissance-composed only: 9,348 (paper), 6,988 (strict), 5,725 (sonnet). These are upper bounds (the split count k is a floor).

**Vernaculars** (2026-10-30 samples, n≈300 each, phase-11 frames). Only works **composed in the language** with an English translation count (origin tag N):
- E (the edition is a translation *from* English) is not a translation into English.
- V (the edition is itself a translation of a third-language work) is counted under that language already, if it is one of the six.
Low = N share as found; high = N share / 0.62, the measured sensitivity of the search (it found 8 of 13 confirmed translations). False positives among N are taken as ~0, since every positive was origin-tagged by reading its evidence.

| Language | Works | N / n | Low | High |
|---|---|---|---|---|
| Latin | 266,593 | (paper §5.10) | 15,600 | 25,400 |
| French | 124,168 | 4 / 299 | 1,700 | 2,700 |
| Italian | 68,819 | 5 / 295 | 1,200 | 1,900 |
| Spanish | 59,582 | 5 / 299 | 1,000 | 1,600 |
| German | 221,931 | 1 / 299 | 700 | 1,200 |
| Dutch | 74,378 | 2 / 299 | 500 | 800 |
| **Total** | **815,471** | | **20,700** | **33,600** |

Caveats:
- The vernacular figures rest on 17 positives; the Wilson intervals on each are wide (German 1/299: 0.06–1.9%).
- The vernacular frames count each newspaper issue as a work (German 69,646; Dutch 20,958; French 17,599; fixed later in #7814). That inflates the denominator, not the product.
- The vernacular frames use phase-11 grouping, which splits famous works more than the paper's corrected count; their translated counts lean high in the same way.

### 2. Capture–recapture on the catalogue lists (Latin)

The three staged lists, landed on Latin works (#7769 landing table): LoC 498 works, Open Library 104, Wikidata 53; union 576; in one list only: 419, 57, 18. Solving for pairwise overlaps with no triple (the counts give −3 for it): LoC∩OL ≈ 45, LoC∩WD ≈ 33, OL∩WD ≈ 2.

Chapman N = (n1+1)(n2+1)/(m+1) − 1: LoC×OL ≈ 1,140; LoC×WD ≈ 790; OL×WD ≈ 1,890 (two shared works, unstable).

Random landing failure does not bias this (it scales both counts and the overlap). Dependence does: the three are modern library records with the same bias to famous works and recent translations, so N is too small. It estimates what these lists can see: about 800–1,900 of 15,600–25,400, a tenth or less. The paper's direct measure for the larger assembled catalogue (Index Translationum, LoC, Open Library, HathiTrust, series) is one in four to one in ten (§5.9, quotable figure 3). The vernacular samples' 0 of 72 was against that assembled catalogue, not these three lists.

### 3. An outside count

Renaissance Cultural Crossroads (Warwick, Hosington): translations printed in England, Scotland and Ireland, and English translations printed abroad, 1473–1640: "over four thousand translations, involving almost thirty languages" (project page, checked 2026-11-02). Editions, including translations into Latin and other languages, and source languages beyond our six. A floor, cleared. A figure of 6,482 entries (2020) appeared in a search summary of a review, but the review could not be opened, so it is not used.

### Source Library

Within these frames, 6,533 works readable in English (Latin 5,234, German 652, Dutch 221, French 204, Italian 193, Spanish 29; phase-11 `readable.sl`). Against 20,700–33,600: a fifth to a third. The paper's §5.8(c) gives 25.9–36.6% for Latin in work units.

### Spot check (2026-11-02)

Six positive verdicts drawn at random from the vernacular final verdicts (seed 1102): 3 were English originals (James II's *Reasons for withdrawing from Rochester* in Spanish; a French *London Gazette* issue; Fuller's *Brief Discovery* in Dutch), 2 were translations of a third-language work whose English exists (La Puente's *Life of Balthasar Alvarez*, London 1868, checked on archive.org; Piatti's *Happines of a Religious State*, Rouen 1632, STC 20001, checked in library catalogues), and 1 was unsure. None was N. The sources were real; the use of "any English" in the first draft was the error.

### Corrections

The first draft of this note and of the article (PR #7956, before review) said 26,000–73,000. Two errors:
1. Latin used the cluster-level rates (7% / 15%) times the phase-11 work count. The paper's work-level count is about 2.5× lower on the translated side, because famous works are split across more title groups.
2. The vernacular high end used "any English edition", which includes English originals (E) and double-counts translations of works in another of the six languages (V). The spot check above found 5 of 5 positives were E or V.

### Reproduce

Landing table and reports: earthai-l7a `/data/scratch/sl/jobs/translation-staging-7769-mv/`. Vernacular verdicts: `/data/scratch/sl/jobs/translation-share-7751/artifacts/translation-share/`. Latin counts: `translation-gap-paper.md` §5.10. Arithmetic: this file.
