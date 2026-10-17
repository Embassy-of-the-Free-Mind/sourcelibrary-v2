---
stage: pipeline
measure: [accuracy]
languages: []
scripts: []
canons: []
n_books: null
n_pages: 7631047
verdict: "With the phase-3 filter planner, the l7a page-vector service returns a full page whenever it says its answer is complete (93 of 120 filtered answers; recall@45 0.964 against an exact float32 filtered scan). The other 27 are flagged complete:false, so the app falls back to the RPC. All 27 are a broad Latin filter on a query whose neighbourhood holds no Latin (26 of them Chinese or Tibetan page vectors)."
status: informational
issue: [6821]
---

PRIOR ART: `2026-10-16-vector-service-recall-6821.md` measured the unfiltered recall (0.956 at
ef 256) and flagged the filtered path's 20.2 of 45 rows, but did not measure filtered recall.
`scripts/workers/vector-search/filtered-recall-eval.mjs` is the instrument; it reuses that
entry's seed, shard layout and exactSearch usage.

## 2026-10-17 · Does the page-vector service's filtered path return the rows an exact filtered scan does?

**Question.** Before the service at l7a serves readers (#6821, shadow first), does a filtered
query (book language, year range, excluded languages) come back with a full page, and with the
same rows an exact search over the filtered set finds? Phase 2's post-filter returned 20.2 of
45 rows for Latin ∧ ≤1600.

**Design.** 30 stored page vectors as queries (seed 6821, the first 30 of phase 2's draw; query
languages: Chinese 12, Latin 7, English 3, German 2, Greek 2, Tibetan 1, French 1, Italian 1,
Hebrew 1). The query's own page is excluded from both lists. Four filter shapes, all taken from
what readers sent (`search_queries.filters`, 60 days), with names expanded the way the app's
`expandLanguages` does it. Truth: one pass over all 7,631,047 float32 shard rows, keeping the rows
that pass `match_semantic`'s predicates on the row's own `book_language` / `book_year`, exact
cosine, `> 0.3`, top 45. Every query had 45 such rows in every shape. Service: `POST /match`, k 45,
threshold 0.3, the same filter. Baseline: the phase-1/2 post-filter (k×4, widened to k×16), run
the same morning before the new server was deployed. recall@45 = |service ∩ exact| / |exact|.

**The new planner** (`server.mjs`, phase 3):
- The filtered row count comes exactly from per-(language, year) class counts: 5,479 classes, not
  7.6M rows.
- **≤ 300K rows → exact scan.** An int8 scan (per-vector scale) of exactly those rows, read
  contiguously from `exact.i8`, which `build-exact.mjs` orders by language and then year (5.86 GB,
  built in 3.4 min). The top 2k are then re-scored in float32 from the shards.
- **Otherwise → HNSW over-fetch.** The first ask is sized by the filter's share of the corpus. Later
  rounds are sized by the pass rate actually observed near this query, up to 16,384 candidates or a
  250 ms budget.
- **Still short and ≤ 600K rows → exact scan.** Past that, the answer goes back with
  `complete: false`.

**Results** (n = 30 queries per shape, k = 45, 7,631,047 rows; server ms on the l7a loopback).

| shape | rows passing | baseline recall / rows | **new recall / rows** | new, European-language queries | new, CJK/Tibetan queries | `complete:false` | path | server p50 / p90 / max ms |
|---|---|---|---|---|---|---|---|---|
| one language, selective (Sanskrit, 2%) | 154,299 | 0.037 / 1.7 | **1.000 / 45** | 1.000 (n 17) | 1.000 (n 13) | 0 | exact 30 | 63 / 80 / 146 |
| one language, broad (Latin, 31%) | 2,376,689 | 0.462 / 22.0 | **0.540 / 25.5** | 0.953 (n 17) | 0.000 (n 13) | 13 | hnsw 30 | 170 / 233 / 371 |
| language + year (Latin, ≤1600) | 1,115,433 | 0.396 / 19.0 | **0.499 / 24.0** | 0.881 (n 17) | 0.000 (n 13) | 14 | hnsw 30 | 118 / 250 / 278 |
| exclude_languages (Latin, French, German, English) | 3,519,659 | 0.798 / 37.6 | **0.950 / 45** | 0.948 (n 17) | 0.954 (n 13) | 0 | hnsw 30 | 11 / 166 / 214 |

Answers the service marked complete: 93 of 120. Each had 45 rows, with recall 0.964 (Sanskrit 1.000,
Latin 0.953 with a minimum of 0.844, Latin ≤1600 0.935 with a minimum of 0.800, exclude 0.950 with
a minimum of 0.822). The 27 `complete: false` answers are 13 + 14 Latin-filter queries: 26
Chinese or Tibetan page vectors with 0 rows, and one English query that found 1 row under Latin ≤1600.

Without the float32 re-score, the int8 exact scan alone had recall 0.959 on Sanskrit (the same
30 queries). Before the scan buffer was allocated once at startup, a fresh 96 MB buffer per query
cost 390 ms of reclaim stalls in a slice sitting at its `memory.high`. Into a resident buffer, the
same read takes 28 ms.

**Reading.**
- The selective and exclude shapes are solved. Sanskrit went from 1.7 rows to a full, exact page
  in 63 ms. The exclude shape went from 37.6 rows to a full page at the unfiltered path's recall.
- **The failure that remains is narrow and has a flag.** A broad filter fails when the query's
  neighbourhood holds none of the filtered language: a Chinese page's 16K nearest neighbours contain
  no Latin row, but 45 Latin rows above 0.3 exist. The service cannot see past its candidate
  ceiling, so it says `complete: false`. In serve mode the app then takes the RPC's answer, so a
  reader gets today's result plus about 200 ms. The planner never serves a short page as if it were
  the answer.
- Reader queries are English phrases embedded by Gemini, which is closer to the European rows here
  (0.88–0.95 recall on the broad Latin shapes) than to the Chinese page vectors. How often the
  flag fires on real traffic is what the shadow week measures (`vector_shadow.svc_complete`).

**Caveats.**
- **These are stored page vectors, not reader queries** (no Gemini calls in this job). Twelve of 30
  are Chinese pages, which is roughly the corpus share of untranslated originals that cluster by
  language. They make the broad shapes look worst-case.
- **Truth is the row's own `book_language`/`book_year`, as the RPC filters.** It is not compared
  with `match_semantic`'s output. The RPC's filtered branch (iterative scan, `max_scan_tuples`
  50,000, ef 100) has its own recall, which was not measured here. Agreement with the RPC is the
  shadow week's number.
- Latency is server-side on loopback, on a box shared with other jobs, with the 14 GB slice at its
  `memory.high`. Vercel (fra1) adds the network hop. The 250 ms budget assumes the app's 400 ms
  timeout.
- n = 30 per shape, one seed, one build.

**Next.** Filtering inside the walk would close the broad-filter gap: an IVF ordering of
`exact.i8` (rows clustered within each class, probe the nearest clusters), or per-language
sub-graphs. Neither is built. Measure the flag rate in shadow first.

**Replicated?** No: one seed, one build. The baseline and new runs used the same queries and truth,
the same morning.

**Artifacts** (on l7a): `/data/vector-search/logs/filtered-recall-20261017.json` (new planner,
per-query rows) and `filtered-recall-20261017-baseline.json` (post-filter). Instruments:
`scripts/workers/vector-search/filtered-recall-eval.mjs` and `build-exact.mjs`.
