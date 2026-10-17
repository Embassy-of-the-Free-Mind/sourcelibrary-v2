---
stage: pipeline
measure: none
languages: []
scripts: []
canons: []
n_books: null
n_pages: 7635148
verdict: "Serving the page text from the l7a service's own store (with_text, over HTTPS) answers a 45-row semantic page search in 19–41 ms p50 (23–52 ms p90; the spread is whether the 19 GB text file is in the page cache), against 152–168 ms for the phase-3 path (service ids + Supabase hydration) and 985–1,002 ms for match_semantic. All 3,957 rows both returned agree with the RPC on every column. Measured from l7a, 0.7 ms from Hetzner main."
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
  job's cache (`spare-5853/qvecs-136.json`). No Gemini call was made. Run 1 drew them with a
  double-arithmetic LCG (seed 6843). CI bans that generator (#5373), so the committed script draws
  with mulberry32 (seed 6843) and run 2 is that draw. 20 queries appear in both runs.
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

**Result** (ms, n = 50 per run). Run 1 was at 14:52 UTC with a cold text cache, while the box's
archive jobs held ~20 GB. Run 2 was at 15:33 UTC, after the reconcile, with the text file largely
in the page cache.

| path | run 1 p50 | run 1 p90 | run 2 p50 | run 2 p90 |
|---|---|---|---|---|
| **service + text, warm connection** | **41.1** | **51.7** | **18.9** | **22.8** |
| service + text, new TLS connection | 31.2 | 56.9 | 32.6 | 37.6 |
| service ids + Supabase hydration (phase 3) | 168.0 | 203.4 | 151.9 | 206.4 |
| … of which the hydration | 157.1 | 193.1 | 139.7 | 193.9 |
| `match_semantic` RPC | 1,001.9 | 1,348.5 | 984.6 | 2,038.1 |

- **Server side, search + text:**
  - run 1: 33.8 ms p50, 44.2 ms p90, of which the text lookups were 24.6 and 34.2;
  - run 2: 10.5 ms p50, 13.0 ms p90, of which the text was 1.3 and 1.5.
  The text is 45 SQLite point reads into a 19.3 GB file. Whether they hit disk depends on how much
  of the file the page cache holds, which depends on what else the box is running.
- **New TLS connection:** about 14 ms more than a warm one in run 2. In run 1 the new-connection
  row came in lower at p50 because it repeats the query the warm row had just made, so its text
  was already cached. Node's TLS handshake on the box alone: 8.8 ms p50, 11.6 ms p90. From fra1,
  a new connection also pays one TCP and one TLS 1.3 round trip.
- **What 45 rows of text cost:** they make ~70 KB of JSON, which goes as 30 KB on the wire
  (Caddy gzip).
- **Columns:** 1,984 rows (run 1) and 1,973 rows (run 2) came back from both the service and the RPC.
  - book_id, page_number, translation, book_title, book_author, book_language and book_year are
    **equal on every one: 0 mismatches**.
  - 0 rows were missing from the text store.
  - Top-45 overlap with the RPC is 0.88. The RPC is approximate too; recall against exact search
    is in the 2026-10-16 entry.

**Caveats.**
- Measured from l7a, not from Vercel. Each leg, the RPC's included, gains fra1's round trip.
- The text read is the largest server-side cost and depends on the page cache. On a box under
  memory pressure it gets slower.
- Two runs, an hour apart, on 2026-10-17. Run 1 came before the first reconcile added its 4,055
  rows (below).
- A first attempt at run 2 exited partway with an error that was not captured. The rerun is the one
  reported.

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
