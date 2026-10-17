---
stage: pipeline
measure: none
languages: []
scripts: []
canons: []
n_books: null
n_pages: 7635148
verdict: "Serving the page text from the l7a service's own store (with_text, over HTTPS) answers a 45-row semantic page search in 41 ms p50 / 52 ms p90, against 168 / 203 ms for the phase-3 path (service ids + Supabase hydration) and 1,002 / 1,349 ms for match_semantic. All 1,984 rows that both returned agree with the RPC on every column. Measured from l7a, which is 0.7 ms from Hetzner main."
status: informational
issue: [6843, 6821]
---

PRIOR ART: `2026-10-16-vector-service-recall-6821.md` (server-side search latency, no network,
no text) and the 2026-10-17 hydration measurement from Hetzner main quoted in the phase-4 brief
(45 rows: ~100 ms warm, ~350 ms cold). The instrument is
`scripts/workers/vector-search/latency-eval.mjs`.

## 2026-10-17 · What does a served semantic page search cost once the service supplies the text?

**Question.** Phase 3 (#6844) serves the service's page ids and then hydrates the text and book
columns from Supabase by primary key. That hydration had become the bottleneck: about 100 ms
warm against about 10 ms of search. Phase 4 adds a text store on l7a (`text/pages.sqlite`,
translation, book_title and book_author per page) and `with_text` on `/match`. Two questions:
is it faster end to end, and does it return exactly the RPC's columns?

**Design.**
- **Queries:** 50 real reader query vectors (`gemini-embedding-2-preview`), from a 2026-10-12
  job's cache (`spare-5853/qvecs-136.json`), seeded shuffle 6843. No Gemini call was made.
- **Settings:** k = 45, threshold 0.3, unfiltered.
- **Order per query:**
  1. service with text on a kept-alive TLS connection;
  2. the same on a new connection;
  3. service ids, then a PostgREST `select … in(page_id)`, which is the phase-3 path;
  4. `rpc/match_semantic` over PostgREST with the anon key, as the app calls it.
  Hydration runs before the RPC, so the RPC's heap reads do not warm it.
- **Where it ran:** from l7a, through `https://vectors.sourcelibrary.org` (Caddy). l7a is
  0.7 ms TCP connect from Hetzner main (same DC), so these are main's numbers within a round
  trip or two. Vercel fra1 adds its own RTT to every leg, the RPC's included.

**Result** (ms, n = 50):

| path | p50 | p90 | mean |
|---|---|---|---|
| **service + text, warm connection** | **41.1** | **51.7** | 40.4 |
| service + text, new TLS connection | 31.2 | 56.9 | 45.4 |
| service ids + Supabase hydration (phase 3) | 168.0 | 203.4 | 170.2 |
| … of which the hydration | 157.1 | 193.1 | 158.5 |
| `match_semantic` RPC | 1,001.9 | 1,348.5 | 1,020.0 |

- **Server side:** search + text 33.8 ms p50, 44.2 ms p90; the text lookups alone are 24.6 ms
  p50 and 34.2 ms p90. These are 45 SQLite point reads into a 19.3 GB file the page cache only
  partly holds, so most of them are disk reads. The new-connection row is lower at p50 because
  it repeats the query the warm row had just made: its text was already cached.
- **What 45 rows of text cost:** they make ~70 KB of JSON, which goes as 29 KB on the wire
  (Caddy gzip).
- **TLS handshake** (Node, new connection, on the box): 8.8 ms p50, 11.6 ms p90. From fra1, a new
  connection also pays one TCP and one TLS 1.3 round trip.
- **Columns:** 1,984 rows came back from both the service and the RPC.
  - book_id, page_number, translation, book_title, book_author, book_language and book_year are
    **equal on every one: 0 mismatches**.
  - 0 rows were missing from the text store.
  - Top-45 overlap with the RPC is 0.882. The RPC is approximate too; recall against exact
    search is in the 2026-10-16 entry.

**Caveats.**
- Measured from l7a, not from Vercel. Each leg, the RPC's included, gains fra1's round trip.
- The text read is the largest server-side cost and depends on the page cache. On a box under
  memory pressure it gets slower.
- One run, at 14:52 UTC on 2026-10-17. The service had not yet applied the 4,055 rows the
  first reconcile later added (below).

## 2026-10-17 · Finding: the updated_at delta misses most new rows

`sync-delta.mjs` (phase 1) keysets on `page_translations.updated_at`. The writer stamps that
column with the page's **Mongo source time**, not the time it wrote the row
(`scripts/lib/page-embedding-text.mjs`: `updated_at: mongoTs || new Date()`). A page translated
at 04:00 and embedded at 16:00 therefore lands behind a 14:50 checkpoint, and the delta never
sees it.

In the first 26 h after the pull:
- the delta saw 681 rows;
- the first `--reconcile` found **4,055 more**. Those are rows Supabase serves and the service
  did not have, across 26 books, with `updated_at` between 2026-10-15 21:22 and 2026-10-16 14:50.

The reconcile pass (one unordered cursor scan of every served page_id, 55 s, then a per-range
diff in the service, 88 s in all) is now on the cron every 2 h. It took the drift from −4,055 to
0.
