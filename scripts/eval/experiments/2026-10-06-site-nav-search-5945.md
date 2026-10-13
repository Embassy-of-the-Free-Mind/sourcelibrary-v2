---
stage: pipeline
measure: accuracy
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "Navigational recall@3 on 42 fixed queries rose from 0.40 to 0.69 with a re-index and to 1.00 with a name match; 0.88 on 25 held-out queries."
status: adopted
decision: "Site index rebuilt from a derived page list plus a name match in /api/search/unified (src/lib/search/site-nav.ts, #5945)"
superseded_by: null
issue: 5945
---
## 2026-10-06 · Does search take a visitor to a page they name, and what fixes it: the index or a name match? (#5945)
<!-- PRIOR ART: 2026-10-06-site-search-recall-5905.md scores /api/search for BOOK recall with the same runner; no earlier entry scores /api/search/unified for where a page's NAME leads. scripts/eval/search-quality-eval.mjs has pass/fail assertions on book queries only. -->

- **Question.** A visitor types "timeline", "check pages", "quality", "Drebbel collection" or "Huygens" into search. Does the page come up, and if not, is the cause a stale index or the lack of a keyword match on names?
- **Answer.** Both, in about equal parts. Of 42 fixed navigational queries, the page was among the first three destinations for **17 (0.40)**. Re-indexing from a derived page list (192 pages instead of a hand-kept 23, plus two aliases) brought that to **29 (0.69)**. A name match on titles, URL words and aliases, shown above the collection cards, brought it to **42 (1.00)**. On 25 queries written after the match existed, **22 (0.88)**.
- **measure:** recall against hand-set expected URLs (not judged, not accuracy). recall@k = 1 if an expected URL is among the first k destinations the search page shows above the book results, in the page's order: the client's "go here" card, pages the response marks as named, collection cards, other site links.

### Design

- 42 queries in `scripts/eval/search-recall/nav-queries.json` (22 pages, 7 tools, 4 collections, 4 authors, 3 essays, 2 browse pages), fixed before any change; 13 are the issue's own measured hits and misses. Every expected URL answered 200 on prod.
- Runner: `run.mjs --suite nav` (the #5905 runner with a second suite). The real `/api/search/unified` handler run locally on production data through `local/route.harness.ts`, loggers and the anonymous gate stubbed.
- Three arms: main's route on the old index; main's route after the re-index (with the two new `site-features.json` entries, which the client card reads); the new route on the new index.
- Held-out: 25 queries in `nav-queries-heldout.json`, written after the match was built and before it was run on them. After only: the old index no longer exists to run "before" on.

### Result (local, 42 queries)

| arm | recall@1 | recall@3 | pages (22) | tools (7) | collections (4) | authors (4) | essays (3) | browse (2) |
|---|---|---|---|---|---|---|---|---|
| before | 0.38 | 0.40 | 0.23 | 1.00 | 0.50 | 0.00 | 1.00 | 0.00 |
| re-index only | 0.57 | 0.69 | 0.73 | 1.00 | 0.75 | 0.00 | 1.00 | 0.00 |
| re-index + name match | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |

(Per-kind columns are recall@3.) 26 queries better, none worse.

- **What the re-index alone could not reach.** Author pages (no author was in the index), and one-word names where three collection cards render first: "about", "map", "libraries", "models", "vision", "latin", "hermeticism". The semantic lane had the right page for most of them, at rank 4 or lower.
- **What changed between the first and second name-match run.** The first run scored 0.98: "kabbalah" put two half-matches (the Jewish Kabbalah category, an author record named "Reuchlin Kabbalah") above the collection called Kabbalah, and `/categories/hermeticism` was missing from the index because the page had answered 500 during the crawl. Fixed by letting an exact name silence partial ones, and by one retry in the crawler.
- **Held-out (25, after only): 0.84 / 0.88.** Misses: "founder letter" and "how can i help" (questions of meaning; the semantic site lane returned nothing above its floor, and this work did not change that lane), and "böhme", which led to `/author/jakob-bohme` while the expected URL was `/author/jacob-boehme`: two author records for one person.
- **Latency (local, median / max per request).** 3.2 s / 7.4 s before, 2.1 s / 3.9 s after. The two runs were minutes apart on a shared box, so read this as "not slower", not as a speed-up. The name lookup is one GIN index scan (0.25 ms in `EXPLAIN ANALYZE`).
- **Caveat.** A perfect score on the 42 is a regression fixture, not an estimate: the match was designed with that list in view (the idea of naming a page by its URL words came from it). The held-out 0.88 is the better estimate, and it is still 25 hand-written queries by the person who wrote the match. Real navigational queries in the logs are mostly subject words that are also collection names ("astrology", "alchemy").
- **Also measured (item 5 of the issue, 30 days of `analytics_events`).** 9,398 searches by people on the main site's All tab, 7,806 distinct per address and hour (the unit the anonymous limit counts). 149 (1.9%) spell a page, collection or category name exactly; 223 (2.9%) an author's. 2,280 (29%) are typeahead prefixes of the same address's next query within a minute, each counted as a search. The sign-in wall was hit 36 times by 18 addresses; 7 of those hits (4 addresses) had a page or author name among the hour's queries. 328 of 3,124 address-hours logged more than five distinct queries: the limit is counted in each server instance's memory and the log does not record whether a visitor was signed in, so the two cannot be told apart.
- *Replicated?* The name-match arm was run twice locally (0.98 before the two fixes above, 1.00 after). The before and re-index arms were run once each.
- **Artifacts.** `scripts/eval/search-recall/` (`nav-queries.json`, `nav-queries-heldout.json`, `run.mjs --suite nav`, `local/route.harness.ts`, `results/2026-10-06-nav-*.json`).
