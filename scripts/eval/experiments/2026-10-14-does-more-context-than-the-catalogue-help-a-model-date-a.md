---
stage: metadata
measure: accuracy
languages: [la, grc, lzh, ja, sa, ar, fa, he, en, de]
scripts: []
canons: []
n_books: 318
n_pages: null
verdict: "For the WORK date, catalogue fields alone (85.9%) do as well as adding the opening leaves (85.4%) or a summary/translated pages (84.7%), n=318 Wikidata gold; one alternative wording (conventional year, narrowest window) lowers the mean interval score 824→525 at the same coverage."
status: informational
decision: "No context added for work dates; leaves stay for edition dates (title-page evidence). Route decision pending the paid-vs-CLI question on #6721."
superseded_by: null
issue: [6721]
---
## 2026-10-14 · Does more context than the catalogue help a model date a work?

**Design.** Same 318 Wikidata-gold works as the entry above, one engine and model (sealed `claude -p` Sonnet 5.5, 15
books per call), three context arms and one wording arm (#6721 amendment 3): C1 = title + author + catalogue fields;
C2 = + the opening leaves' OCR (the production prompt); C3 = C2 + `books.summary.data` (225 books), else the first two
translated body pages (48), else nothing (45); C2-p2 = C2 with the year defined as the date scholars conventionally
cite and the window as the narrowest defensible. Scored by coverage (gold interval meets the window) and the interval
score (Gneiting–Raftery, α = 0.1: width + 20 × miss distance; lower is better).

**Result.**

| arm | coverage high/med (CI) | n | median width | mean interval score | HIT all rows |
|---|---|---:|---:|---:|---|
| C1 catalogue only | 85.9% (81–90) | 249 | 5 y | 704 | 85.8% |
| C2 + opening leaves | 85.4% (81–89) | 268 | 5 y | 824 | 84.6% |
| C3 + summary / translated pages | 84.7% (80–89) | 262 | 5 y | 766 | 83.3% |
| C2-p2 wording | 85.5% (81–89) | 262 | 4 y | 525 | 83.0% |

No arm differs from another beyond noise. Leaves change confidence, not accuracy: with C1 the model marks more Chinese
books low (21 of 49 rows high/medium vs 40 with leaves). The edition date still needs the leaves, because title-page
evidence must be a span of them. The interval-score means are driven by a few far misses (one *Timaeus* dated to its
1888 edition costs ~45,000).

**Replicated?** No.

**Artifact.** `scripts/eval/library-dating-6721/score.mjs` (interval-score table); arms under
`/mnt/HC_Volume_105839809/jobs/library-dating/ctx2/` on Hetzner; #6721.
