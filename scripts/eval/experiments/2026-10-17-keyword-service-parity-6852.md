---
stage: pipeline
measure: [agreement]
languages: []
scripts: []
canons: []
n_books: 72173
n_pages: 9341133
verdict: "A tantivy index of the same page text returns 96% of the books and 90% of the pages the Atlas page lane puts in its top 20, every roll-up book, and Atlas's first page every time, on 180 scored logged queries. It answers in 20 ms at p50 and 147 ms at p90 when warm (195 / 491 ms cold, on a network volume). Atlas takes 787 / 2,200 ms for the same lane. SQLite FTS5 was measured out first: 175–978 ms for common words on 8.7% of the corpus."
status: adopted
decision: "Serve the /api/search keyword page lane from tantivy, not SQLite FTS5. Shadow first (KEYWORD_SEARCH_MODE=shadow), serve after a shadow week."
issue: [6852]
---

PRIOR ART: `scripts/eval/search-word-forms/lanes.harness.ts` reads the Atlas page lane for word forms. `2026-10-16-vector-service-recall-6821.md` is the sibling measurement for the vector lane's service. Instruments: `scripts/eval/keyword-lane-parity/` (`parity.harness.ts`, `score.mjs`, `route-modes.harness.ts`).

## 2026-10-17 · Can a Hetzner BM25 index stand in for the Atlas keyword page lane?

**Question.** The `/api/search` page lane asks Atlas Search `pages_search` up to four questions per query:
- the 25 best pages;
- name-variant pages;
- the roll-up count of pages per book;
- the best page per added book.

In production it takes 1.3 s at the median and 2.9 s at p90 (#6852). Does a local BM25 index over the same text return the same pages, and how fast?

**Engine choice, measured first.** SQLite FTS5 (the brief's first choice) and tantivy each indexed the same 815,900 pages (8.7% of the corpus, 3.1 G characters). Same top-25 queries, warm cache, main box:

| query | matching pages | FTS5 top 25 | tantivy top 25 |
|---|---|---|---|
| god | 139,318 | 175 ms | 2.3 ms |
| nature | 142,229 | 313 ms | 2.1 ms |
| nature of god | 237,091 | 323 ms | 3.6 ms |
| the | 593,761 | 978 ms | 8.4 ms |
| alchemy | 13,735 | 23 ms | 0.3 ms |
| "prima materia" (phrase) | 828 | 5 ms | 1.0 ms |

FTS5 scores every page a term matches, with no top-k pruning. Its roll-up count (a full iteration) doubled these times, and over the whole corpus a common word would take seconds. That is slower than the lane it replaces, so FTS5 failed on speed. tantivy's block-max WAND skips what cannot reach the top k.

**Design.**
- **Index.** tantivy (tantivy-py 0.26.2) over every page with `page_number > 0` and any text, from every book: 9,341,133 pages, 35.8 G characters. Fields are `translation.data` and `ocr.data` raw, wrappers included, as Atlas indexes them.
- **Analyzer.** A regex tokenizer approximating `lucene.standard`:
  - UAX#29 joiners: letter–letter or digit–digit only;
  - one token per Han/Hiragana character;
  - lowercase; no folding, no stemming.
- **Index size.** 15.52 GB. The build took 25.7 min.
- **Pull.** Mongo → shards, 27.8 min over zlib wire compression.
- **Queries.** Drawn from `search_queries`: route `search`, the last 60 days, main site, no filters, English. The pool is the distinct queries. A seeded shuffle (6852) filled five strata by quota: names 50, phrases 40, single words 50, non-Latin 30, multi-word 30. "Names" means `expandNameQuery` finds a person.
  - The same 200 queries ran for both runs below (`SAMPLE_FROM`).
  - The queries stay in scratch, not in this public repo.
- **Atlas side.** The route's own building blocks, in the route's order: `expandNameQuery`; `buildPageSearchStage` (main, then the variant query); `rollupTerms` → `countMatchingPagesByBook` → the liveness check → `bestPagePerBook`. Run from main.
- **Service side.** The same question in one `POST /lane` on 127.0.0.1.
- **Live books.** Both sides are confined to live books (visible, `pages_count > 0`, not hidden), because the route drops the others at its join.
- **Scored.** 180 queries; 20 had no live Atlas page (mostly quoted phrases that print nowhere).

**Results** (n = 200 queries, 180 scored).

| stratum | n | scored | recall@20 | p10 | books@20 | lane recall | roll-up books@30 | top-1 | Atlas lane p50 / p90 ms | prod page p50 / p90 ms | service p50 / p90 / p99 ms (warm) | serve lane p50 / p90 ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| all | 200 | 180 | 0.903 | 0.75 | 0.963 | 0.933 | 1.000 | 1.00 | 787 / 2200 | 761 / 2551 | 20.5 / 146.6 / 361.8 | 125 / 257 |
| names | 50 | 50 | 0.880 | 0.75 | 0.958 | 0.926 | 1.000 | 1.00 | 1019 / 2392 | 975 / 3142 | 39.1 / 198.6 / 361.8 | 164 / 320 |
| phrases | 40 | 22 | 0.982 | 0.95 | 1.000 | 0.964 | 1.000 | 1.00 | 364 / 1993 | 550 / 2556 | 8.5 / 23.2 / 75.5 | 80 / 135 |
| single | 50 | 49 | 0.880 | 0.75 | 0.943 | 0.923 | 1.000 | 1.00 | 842 / 2386 | 691 / 2518 | 16.9 / 83.2 / 388.3 | 122 / 202 |
| non-Latin | 30 | 30 | 0.930 | 0.80 | 0.981 | 0.950 | 1.000 | 1.00 | 547 / 1115 | 532 / 1489 | 9.0 / 72.1 / 182.9 | 80 / 135 |
| multi-word | 30 | 29 | 0.891 | 0.80 | 0.959 | 0.923 | 1.000 | 1.00 | 1126 / 2527 | 1349 / 2931 | 27.2 / 162.7 / 177.9 | 135 / 268 |

Column definitions:
- **recall@20**: the share of the Atlas lane's top-20 live pages that the service also returns in its top 20.
- **books@20**: the same, counted on books. The route shows a book once, so this is what a reader sees.
- **lane recall**: the whole page list (main, variant and roll-up pages), as sets.
- **Atlas lane**: timed from main, not from Vercel. **prod page**: `stage_ms.page` as logged for the same queries.
- **serve lane**: the name expansion that stays in the app, plus the service round trip, plus the Mongo find by page id that serve mode adds for snippets. All from main.

**Cold cache.** The service is fast once the posting lists it reads are in memory. The first pass over a freshly built index (the same index, before fixes 3 and 4 below) gave 195 / 491 / 1,202 ms at p50 / p90 / p99. Each query read its posting lists from main's network-attached volume for the first time. A replay of the same queries ran at 52 / 167 / 334 ms. The serving box should hold the index on a local disk with room in its page cache; the cloudlayer install (phase 2) measures that box.

**What the misses are.**
- **Mostly order, not omission.** Atlas's top 10 is inside the service's top 25 for 97.9% of queries. The lowest page recall@20 ("Pythagoras" 0.35, "Ecclesia" 0.70) comes from the same books with different pages first. A word printed on many pages of one book gives near-tied BM25 scores, and Lucene and tantivy encode length norms differently. Book recall for those queries is high.
- **Fuzzy expansion order.** Atlas keeps 50 expansions by edit similarity; the service keeps the 50 most frequent. That differs only when a word has more than 50 neighbours.
- **Stop-like OCR markup.** "page" is in 6.8M of 9.3M OCR fields: the OCR text carries `<page-type>` and similar tags, and Atlas indexes them too. A query containing such a word is the service's slow case (100–400 ms) and Atlas's (1–2 s). Stripping editorial wrappers from the index is #2236, a ranking change for both engines, not done here.

**Fixes this eval drove** (all before the table above):
1. **The tokenizer.** It joined a letter to a digit across a period, so "c.1.a" became one token where Lucene makes three, and the phrase "a Astronomia" missed pages. Every phrase miss traced on the first run had this cause. Phrase recall@20 was 0.943 there and 0.982 in the table, but those are different samples; the first run drew its 200 queries earlier in the day.
2. **Fast fields.** Hits are now filtered and identified from fast fields, not stored documents.
3. **Fuzzy per token.** Fuzzy applies to every token of a one-word query, as Atlas does. "pseudo-Paracelsian" went from 0.10 to 0.80, same sample.
4. **One search for the roll-up's best pages.** The 30 best-page searches became one. Items 3 and 4 are the only change between the cold run and the table, both on the same 200 queries.

**End to end** (`route-modes.harness.ts`: the real `/api/search` handler; the semantic lanes stubbed so that no model is called; 6 fixed queries):

| mode | page stage |
|---|---|
| `off` | 867–2,494 ms |
| `serve` | 88–122 ms |

- In `serve`, every page row had a snippet, and the log carried `keyword_lane: served`. Final page rows overlapped `off`'s by 0.69–1.0.
- `shadow` returned Atlas's rows and handed the logger a `keyword_shadow` comparison: service 69–159 ms, recall_main 0.79–1.0, roll-up books 1.0.

**Caveats.**
- This measures agreement with Atlas, not quality. Where the two engines disagree, neither is shown to be right.
- Atlas times here were taken from main. Production reaches Atlas from Vercel fra1, and the logged `stage_ms.page` for the same queries sits close to them (761 vs 787 ms median).
- One sample and one seed. The 20 unscored queries carry no information about recall.

**Next.** A shadow week in production (`search_queries.keyword_shadow`), once the service is behind TLS (#6843). Then serve, with Atlas as the fallback.
