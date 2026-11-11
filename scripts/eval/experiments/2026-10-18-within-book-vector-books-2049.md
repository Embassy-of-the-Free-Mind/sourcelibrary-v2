---
stage: pipeline
measure: [none]
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "The page-vector service answers match_pages_in_books' question with an exact float32 scan of the named books' rows. On 30 real search_within_book calls it takes 14 ms p50 / 28 ms p90 (10 / 21 ms in the server), against the RPC's 215 / 507 ms. It returned the RPC's top 10 on 28 of 30 calls and the same top result on 29. In the other two, and in 2 of 10 twelve-book calls at k=20, the similarity lists are identical value for value: pages with identical vectors tie, and the two systems break the tie differently. Recall by similarity is 1.0. Shared pages agree within 3e-7."
status: adopted
decision: "Shipped for search_within_book and the Librarian's scoped page search (semanticPageSearchScoped, English, ≤ 50 books) in VECTOR_SEARCH_MODE=serve, with the RPC as the fallback on any error, timeout, complete:false or a service that ignores book_ids. Deployed to l7a with one restart on 2026-10-18 23:23Z."
issue: [2049]
---

PRIOR ART: `2026-10-18-within-book-keyword-service-2049.md` (the same route's keyword leg, and the part-by-part timing that named this leg as the remaining p90). `2026-10-17-vector-service-filtered-recall-6821.md` (the service's filtered paths against an exact scan; it had no book filter). Instrument: `scripts/eval/search-evals-2049/within-book-vector.ts`.

## 2026-10-18 · Can the vector service answer search_within_book's semantic leg?

**Question.** After #6963, search_within_book's p90 (~1.0 s) is its semantic leg: the Gemini query embedding plus Supabase `match_pages_in_books` (65–750 ms). The service on l7a already holds the same 7.64M `page_translations` vectors. Can it answer the per-book question, and does it return the RPC's pages?

**Method.** The service's `/match` takes `book_ids` (≤ 50). It looks the books' keys up in a book index (CSR over the row store, built at startup and after each save, 7.64M keys in well under a second). Keys a delta sets in between are checked on every query. It scores every live row of those books by float32 cosine from the shards, which hold the RPC's rows as pulled; a row changed since the build is scored from its int8 override. It keeps the RPC's `> threshold`. The reads are coalesced, because a book's pages sit next to each other in one shard.

**Panel.** 30 real `search_within_book` calls (`mcp_tool_calls`, ok, English, one per distinct (book, query), 14 days, seed 2049; the sampler of `within-book-parts.ts`). Each query was embedded once and the vector kept, so the before and after runs used the same 30 vectors and no further Gemini calls. The panel holds users' queries, so it is not committed. A second check used 10 of those vectors over a 12-book set at k=20, the Librarian's shape.

### Results (l7a, local listener, 2026-10-18 23:25Z)

| | RPC `match_pages_in_books` | service `book_ids` |
|---|---|---|
| p50 / p90 / max ms (client) | 215 / 507 / 648 | **14 / 28 / 34** |
| server-side p50 / p90 ms | — | 10.2 / 20.8 |
| top 10 identical | — | 28 / 30 |
| same top result | — | 29 / 30 |
| overlap@10 mean | — | 0.993 |
| largest similarity difference on a shared page | — | 3.1e-7 |

- **The two calls that differ are ties.** Both differ at the 10th slot only. In one, two pages have the same similarity to 15 digits (0.510144816965393). In the other, eleven pages share 0.60557. They are pages with identical vectors. Which tied page the RPC returns depends on heap order; the service keeps key order.
- **Twelve books, k=20:** the top 20 were identical on 8 of 10 calls. In the other two, the 20 similarities match an exact SQL scan value for value. The 10th to 20th places are all one tied value (0.62540 and 0.60557), shared by 11 to 17 identical-vector pages. The RPC took 100–128 ms on this set, the service 31–36 ms (4,724 rows scanned).
- **Before the restart**, the same scan run offline over generation 3's rows and overrides gave the same 28/30 and the same two ties (4 ms p50, 10 ms p90).
- **Not measured:** the network from Vercel fra1 to l7a (the client's 400 ms budget covers it; the global lane's calls already pay it), and the route end to end in production. Recount `mcp_tool_calls` for search_within_book at +24 h after the app PR deploys.

### Deploy

There was one restart, under the delta flock. Before it, `/admin/save` wrote generation 4 (1,091 pending changes, 13 s). After it, `/health` read generation 4 again, with 7,643,574 live rows before and after, and was up in 40 s. Its new `book_index` field read 7,643,574 keys over 50,843 books.
