---
stage: pipeline
measure: [none]
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "The /api/search book lane was slow because of its regex metadata fallback. On 40 sampled reader queries it fired on 16, read every live book from Mongo (42,372 docs) at 0.9–2.2 s, and found a book on only 2 of them. The same RegExp objects run over an in-memory snapshot of the five fields take 27 ms p50 and 34 ms p90, and return the same match set on 40 of 40 sampled queries and 150 of 150 further multi-word queries. With that, the lane goes from p50 385–456 / p90 1,341–1,658 ms to p50 219 / p90 386 ms, measured from the main box. What is left is single-word queries, about 30% of the sample: books_catalog has no index on language or subject_keywords, so they filter the whole 229 MB heap (p90 656 ms)."
status: adopted
decision: "In-memory fallback shipped in the PR for #2049. Two GIN indexes on books_catalog are proposed as a DECISION and not applied."
issue: [2049]
---

PRIOR ART: `2026-10-17-search-services-burst-isolation-2049.md` and the other #2049 entries measure the page services and whole routes; none splits the book lane. Instrument: `scripts/eval/search-evals-2049/book-lane.ts`.

## 2026-10-18 · Why the book lane is the slowest stage of /api/search, and the fix (#2049)

**Question.** After the page lanes moved to the Hetzner services on 2026-10-18, `stage_ms.book` (1.4–3.1 s on fresh queries) set the wall time of `/api/search`. Which part of the lane is slow? Can it reach p90 < 400 ms without changing what it returns?

**Panel.**
- 40 distinct queries from `search_queries`: route `search`, last 7 days, global and unfiltered.
- Stratified 10 per quartile of the logged `stage_ms.book`. The logged p50/p90/max over the panel was 761 / 3,518 / 5,904 ms.
- The panel is kept on the main box at `/mnt/HC_Volume_105839809/jobs/book-lane-speed/book-lane-before.json`. It holds reader queries, so it is not committed to this public repo.
- Each part was timed as the route runs it, with the route's default `limit` of 20, from the main Hetzner box (fra region, as Vercel fra1).

### Per part (ms; run 2 on the same panel, run 1 in brackets where it differs)

| part | n | p50 | p90 | max |
|---|---|---|---|---|
| Supabase, typed filter | 40 | 195 (178) | 380 (445) | 599 (1,031) |
| Supabase, related word forms (parallel) | 13 | 149 | 656 | 679 |
| `searchBookIds`, max of the two | 40 | 196 | 380 | 679 |
| Mongo `find` by id | 20 | 7 | 8 | 10 |
| **regex metadata fallback (Mongo)** | **16** | **934 (1,310)** | **1,475 (2,015)** | **2,031 (2,228)** |
| same fallback, in-memory snapshot | 16 | 27 | 34 | 37 |
| snapshot load, once per instance | 1 | 3,044 (other runs 1,624 and 2,181) | | |

- **The fallback fires on 16 of 40 queries.** It fires whenever the catalogue finds no book for a query of two or more content words.
- **It found a book on 2 of the 16.**
- **Its plan.** `explain` shows a FETCH of all 42,372 live books through `books_visible_created_idx` or `browse_default_sort_covered`; the planner switches between the two from run to run. The regex is unanchored, and `subject_keywords` and `display_title` have no index.

### The lane, before and after

| | p50 | p90 | max |
|---|---|---|---|
| logged in production (`stage_ms.book`) | 761 | 3,518 | 5,904 |
| today's lane, run 1 | 456 | 1,658 | 2,541 |
| today's lane, run 2 | 385 | 1,341 | 2,338 |
| **with the in-memory fallback** | **219** | **386** | **686** |

Production logs higher than the same code measured from here, also on queries where the fallback does not fire: Eusebius Caesariensis logged 627 ms against 197 ms here. The four lanes run at once on one Vercel instance. The after-deploy number has to come from `search_queries`.

### Is the result set the same?

- **The 40-query panel.** Overlap@20 against today's lane is 1.0 on 40 of 40.
  - Order is identical on 38.
  - On the other 2 (2 books each), the order of the two books is swapped. Today's order depends on which of the two indexes the planner picked, so it was never stable.
  - The catalogue part of the lane is unchanged, so only fallback queries could differ.
- **A wider check: 150 random distinct multi-word queries** (14 days of `search_queries`). The full match set (up to 2,000, not just 20) was compared. It is identical on 150 of 150; 53 of them are non-empty, and none reached the cap. Three were non-Latin (Devanagari, Cyrillic).

### What changed (PR for #2049)

- `src/lib/search/book-metadata-snapshot.ts` keeps `id` + the five fallback fields of every live book in memory.
  - Rows are held in `browse_default_sort_covered` order.
  - It loads on an instance's first fallback, then refreshes in the background when it is older than 30 min and still being used.
- **The route uses it first.**
  - Unfiltered: the first 40 matches go through the same `find`, which re-applies `visible` and `pages_count`, keeping the first 20 in snapshot order.
  - Filtered: up to 2,000 candidates go through the same `find`.
  - The Mongo regex still runs if the snapshot fails to load, or if a filtered query has more than 2,000 candidates.
- **Cost.**
  - About 11 MB of Atlas egress per load, at most once per 30 min per active instance.
  - The first fallback on a cold instance waits for the load (1.6–3.0 s), the same order as today's regex.
- **Staleness.** A book made visible in the last 30 min can be missing from the fallback. One hidden since then is dropped by the `find`.

### What is left: single-word queries

| catalogue time by query shape | n | p50 | p90 |
|---|---|---|---|
| one word | 12 | 372 | 656 |
| two or more words | 28 | 156 | 282 |

- **The cause.** For a single word, the OR adds `language ILIKE '%w%'` and `subject_keywords && {…}`. Neither column is indexed, so Postgres cannot build a BitmapOr. It walks `idx_bc_human_read_count` and filters every visible row: 58K rows, ~29,900 buffers, 300–460 ms (`EXPLAIN ANALYZE`, read-only, for "Mormius" and "Svarodaya").
- **Proposed SQL. Not applied: it is a schema change on a shared table.**

```sql
-- #2049: let the single-word book-lane OR use a BitmapOr instead of filtering the 229 MB heap.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bc_language_trgm
  ON public.books_catalog USING gin (language gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bc_subject_keywords
  ON public.books_catalog USING gin (subject_keywords);
```

- **Expected effect on results.** For a word with at most 40 matches (the lane's limit), the set cannot change. For a common word, the planner may move from read-count order to bitmap (physical) order, which changes which 40 of the many matches are sampled. Check that with the same harness after the indexes are built.

*Replicated?* The lane was timed twice on the same panel. The set-equality check ran on a second, independent sample.
