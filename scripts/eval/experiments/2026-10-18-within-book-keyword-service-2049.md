---
stage: pipeline
measure: [none]
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "search_within_book was slow for two reasons. Its keyword leg asked Atlas a book-filtered $search, which took 0.3–5.7 s cold (p90 4.2 s on 30 real calls), nearly all of it before the first document came back. On top of that, the tool fetched its own route over HTTPS. Asking the keyword page service instead, with the book as the allow-list, takes the route from p50 1,555 / p90 5,299 ms to p50 452 / p90 1,012 ms on the same 30 calls (cloudlayer, both arms in-process). Overlap@10 with today's output is 0.973, with the same top result on 28 of 30. Book-scoped search_translations goes from 561 / 1,477 to 184 / 447 ms, the same single passage on 22 of 25 calls that return one. The differing pages print as much of the query as the ones they replace, with two exceptions that favour the service. What is left of search_within_book's p90 is the semantic leg: the Gemini embedding plus a Supabase RPC, ~0.5–1.1 s."
status: adopted
decision: "Shipped in the PR for #2049 for live books. Hidden books, tenants, ?lang= and any service failure stay on Atlas."
issue: [2049]
---

PRIOR ART: `2026-10-18-search-book-lane-speed-2049.md` (the /api/search book lane) and `2026-10-17-keyword-*-2049.md` (the service against Atlas on the GLOBAL page lane). None of them measured a `book_id` search. Instruments: `scripts/eval/search-evals-2049/within-book-parts.ts` (the route's parts, Atlas only) and `within-book-overlap.harness.ts` (both arms, in-process, read-only).

## 2026-10-18 · The two search tools the speed wave did not reach (#2049)

**Question.** `search_within_book` (p50 2,051 / p90 5,105 ms in `mcp_tool_calls` since 02:30Z) and `search_translations` (p50 1,766 / p90 5,802 ms in the 7 days before) were the slowest MCP search tools after the page lanes moved to Hetzner. Where does the time go? Can it go without changing what they return?

**Panels.** These are real MCP calls (`mcp_tool_calls`, ok, English), one per distinct (book, query), from the 14 days before 2026-10-18 22:00Z, in a seeded shuffle:
- 30 `search_within_book` calls;
- 30 `search_translations` calls with a `book_id` and no other filter.

The harness draws the same calls on any box, so nothing is copied. The panels hold users' queries, so they are not committed and not quoted here.

### Where the time goes (search_within_book, 30 calls, from main, cold, Atlas only)

| part | p50 ms | p90 ms | max |
|---|---|---|---|
| `books.findOne` gate | 7 | 8 | 24 |
| `expandPersonNames` | 11 | 36 | 79 |
| **Atlas `$search`, book-filtered** | **791** | **4,178** | **5,712** |
| Gemini query embedding | 284 | 667 | 785 |
| Supabase `match_pages_in_books` | 273 | 637 | 747 |
| `pages.find` for the semantic hits | 11 | 24 | 27 |
| `semanticCoverage` (only when semantic is empty) | 0 | 0 | 166 |
| critical path | 1,076 | 4,184 | 5,720 |

**The Atlas cost is mongot on a cold query, not the documents.**
- The same heavy queries re-run warm took 38–820 ms.
- Read in batches of 64, a book-filtered `$search` took 0.14–2.7 s to its *first* batch on 30 fresh calls, and a 3-document answer took 1.4 s.
- Reading 400 pages of one book by `(book_id, page_number)` takes 25–230 ms cold.

So an early stop on the Atlas cursor cannot help. Asking a different index can.

### Service against Atlas (cloudlayer, both arms in-process through the route handlers, alternating which goes first)

| surface | n | Atlas p50 / p90 / max ms | **served** p50 / p90 / max ms | overlap@10 (mean) | overlap@10 = 1 | same top result |
|---|---|---|---|---|---|---|
| search_within_book | 30 | 1,555 / 5,299 / 10,164 | **452 / 1,012 / 1,348** | 0.973 | 24 | 28 |
| search_translations + book_id | 30 | 561 / 1,477 / 2,256 | **184 / 447 / 1,320** | 0.90 (both empty on 5) | 27 | 27 |

- **Reached the service:** every served arm (30 + 29; the 30th `book_id` is not the id of a live book, so it stayed on Atlas, as designed). No Atlas arm called it. 0 non-200.
- **The served search_within_book time includes the semantic leg** (embedding + RPC), which is now what sets its p90. With a `book_id`, search_translations has no semantic lane.
- **search_translations with a `book_id` returns one passage** in both arms, on every call that found anything. This is existing behaviour: the route collapses page rows to one per book. It is not changed here and is worth its own look.

### Where the lists differ (pages scored by how many query words they print, and `phraseMatch`)

| call | what changed | Atlas page | served page |
|---|---|---|---|
| wb, 1 word | top result | prints 0/1 (a fuzzy match) | prints 1/1 |
| wb, 1 word | top two swapped | both 0/1 | — |
| wb, 7 words | rank 10 | 1/7 | 1/7 |
| wb, 6 words | rank ~8 | 6/6 | 5/6 |
| wb, 6 words | 2 tail pages | 1/6, 1/6 | 1/6, 1/6 |
| wb, 1 word | 2 tail pages | 1/1, 0/1 | 1/1, 1/1 |
| wb, 3 words | rank 4 | 1/3 | 2/3 |
| wb, 3 words | **Atlas hit its 10 s maxTimeMS** | the keyword leg came back empty; 10 semantic results | 50 results |
| st, 6 words | the one passage | 4/6 | 4/6 |
| st, 4 words | the one passage | 2/4, phrase 0 | 2/4, phrase 0.05 |
| st, 4 words | the one passage | 2/4 | 2/4 |

- `total` (pages matched, not returned) is 0–20% lower served on 15 of 30 within-book calls. Atlas's single-word fuzzy matching (`maxEdits: 1`) and the service's live-only index account for the tail. The top 10 do not move with it.

### What is left

- **search_within_book p90 (~1.0 s) is the semantic leg.**
  - The Gemini embedding takes 220–785 ms.
  - Supabase `match_pages_in_books` takes 65–750 ms.
  - The vector service on l7a has no book filter. One book is a few hundred vectors, an exact scan in single-digit ms, so that is a service-side change: a DECISION, not this PR.
- **Global search_translations (~1.2–1.3 s since 02:30Z) is the semantic page lane's 500 ms grace for the original-text lane** (`UNTRANSLATED_GRACE_MS`).
  - Over 6 h of `/api/search` that lane was `late` on 1,378 site searches against 67 `ok`, and on 22 MCP calls.
  - The grace was set while the English lane took ~1.1 s. Since #6821 it takes ~10 ms, so the wait now mostly costs 0.5 s and then drops the lane's rows.
  - Shortening it changes results: a DECISION.
