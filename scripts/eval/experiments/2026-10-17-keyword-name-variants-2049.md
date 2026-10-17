---
stage: pipeline
measure: [accuracy]
languages: []
scripts: [Latn]
canons: []
n_books: null
n_pages: null
verdict: "Typing a variant spelling of a person's name (40 entities pairs: Platone, Salomon, Plinius, Iuppiter …) brings back pages printing the canonical spelling in both the Atlas lane and the keyword service: 40/40 at any rank in both, 39 vs 38 in the top 10, at 587 ms vs 34 ms p50. The service returns twice as many name-variant pages (290 vs 139), because it de-duplicates against the main list before taking 10, not after. That is a behaviour change to decide before keyword serve."
status: informational
issue: [2049, 5888, 6852]
---

PRIOR ART: `scripts/eval/search-recall/` (#5905) scores 5 spelling-variant queries on books through the whole route. `2026-10-17-keyword-service-parity-6852.md` compares the lanes on logged queries. Neither builds a variant panel from `entities` or checks that the canonical spelling is on the returned pages. Instrument: `scripts/eval/search-evals-2049/name-variants.harness.ts`.

## 2026-10-17 · Does a variant spelling find the canonical name's pages, in the service as in Atlas? (#2049 eval check 5)

**Method.**
- **Panel.** `entities` persons with `book_count ≥ 3`, most books first. Keep those with an alias token that `isSpellingOf` the canonical surname, one pair per surname, seed 2049: 40 pairs.
- **Query.** The variant. `expandNameQuery(variant)` is computed once and given to both lanes. Atlas runs the main stage (25) and the variant stage (10, `requireNameVariant`), then the route's live drop and de-duplication. The service gets one `POST /lane`.
- **Scoring.** A page names the canonical form when its OCR or translation prints the surname as a whole word (`indexOfWord`).

**Results.**

| | pairs | canonical page in top 10 | any canonical page | canonical pages / returned | variant-query pages | ms p50 / p90 |
|---|---|---|---|---|---|---|
| Atlas | 40 | 39 | 40 | 765 / 1,049 (0.73) | 139 | 587 / 1,447 |
| service | 40 | 38 | 40 | 925 / 1,280 (0.72) | 290 | 34 / 67 |
| Atlas, 29 expanded | 29 | 28 | 29 | 569 / 797 | 139 | 581 / 1,286 |
| service, 29 expanded | 29 | 27 | 29 | 720 / 1,015 | 290 | 34 / 53 |
| Atlas, 11 not expanded | 11 | 11 | 11 | 196 / 252 | 0 | 644 / 1,447 |
| service, 11 not expanded | 11 | 11 | 11 | 205 / 265 | 0 | 25 / 67 |

Lane overlap with Atlas: mean 0.90, min 0.65. 0 service errors. The per-pair table is on #2049.

**Conclusion.**
- Parity on the reader's question.
  - The one extra top-10 miss in the service (Ambrose ← Ambrosius) is a main-list ranking difference.
  - Both lanes miss Origen ← Origène in the top 10: its canonical pages come only from the variant query, which the lane appends after the 25 main pages.
- **Contract difference** (`scripts/workers/keyword-search/server.py`, `exclude=seen`). The service takes `variant_k` pages after excluding the main list. The route takes the variant query's top 10 and then drops duplicates. Under serve, every expanded name query carries up to 10 more pages into RRF. Decide on purpose, or align the service.
- 11 of 40 typed variants get no expansion: `expandNameQuery` matches exact `entities.name` / `aliases` strings, and these spellings occur only inside longer aliases. Fuzzy matching on 6+ letter single words still reaches the canonical pages. Shorter variants (Iesu, Iacob) have no such net. This is a #5888 coverage note.
