---
stage: pipeline
measure: [accuracy]
languages: []
scripts: []
canons: []
n_books: null
n_pages: 7631047
verdict: "The l7a page-vector service at ef_search 256 returns 95.6% of the exact top-45 over all 7.63M page vectors, at 8.8 ms p50 / 12.4 ms p90 server time; the default ef 128 falls just short (94.6%)."
status: informational
issue: [6821]
---

PRIOR ART: none for the full-corpus service. Phase 1's quantization measurement (#6825,
numbers restated below) is the small-sample precursor; `recall-eval.mjs` in
`scripts/workers/vector-search/` is the instrument.

## 2026-10-16 · Does the Hetzner page-vector service find the same neighbours as exact search?

**Question.** Semantic page lookup goes through Supabase `match_semantic` today and costs
readers, the Librarian and MCP agents ~1.1 s. The phase-1 service (#6821, PR #6825) answers
from an in-RAM usearch HNSW index on l7a. Before it is wired in (a later tier:hold PR, shadow
mode first), how close are its results to exact search, and how fast is it?

**Design.** Index: usearch HNSW, cosine, M=16, ef_add 128, e4m3 quantization, built from the
float32 shards pulled from Supabase `page_translations` (7,631,047 rows; the bootstrap's count
check: Supabase 7,631,047 · service 7,631,047 · drift 0). Queries: 50 stored page vectors drawn
with seed 6821; the query page itself is excluded from both lists. Truth: exact float32 cosine
brute force over the same shards (45 s per pass of 50 queries). Measures: overlap@45 (share of
the exact top-45 the service returns), overlap@10, tie-tolerant recall@45 (a returned row counts
if its exact similarity ≥ the exact 45th's), absolute similarity error of returned rows, and
latency (server-side and HTTP round trip on 127.0.0.1), unfiltered and with
`filter_language: 'Latin', year_max: 1600, threshold 0.3`. Same seed, same queries at every ef;
ef changed by a systemd drop-in and a service restart, no rebuild.

**Results** (n = 50 queries, k = 45, 7,631,047 rows).

| ef_search | overlap@45 mean | min | p10 | overlap@10 | tie-tolerant @45 | sim err mean / max | server p50 / p90 ms | HTTP p50 / p90 ms | filtered server p50 / p90 ms | filtered HTTP p50 / p90 ms |
|---|---|---|---|---|---|---|---|---|---|---|
| 128 (default) | 0.946 | 0.556 | 0.91 | 0.948 | 0.946 | 0.00103 / 0.00464 | 5.7 / 8.3 | 8.7 / 13.3 | 25.7 / 40.1 | 28.9 / 42.8 |
| **256 (kept)** | **0.956** | 0.711 | 0.89 | 0.948 | 0.956 | 0.00103 / 0.00464 | **8.8 / 12.4** | 11.9 / 16.5 | 28.5 / 41.8 | 31.7 / 44.3 |
| 512 | 0.960 | 0.822 | 0.93 | 0.950 | 0.960 | 0.00103 / 0.00464 | 12.7 / 19.5 | 16.0 / 24.7 | 34.7 / 55.5 | 38.3 / 57.9 |

All 50 queries returned themselves first at every ef. The filtered path returned 20.2 rows per
query on average (of k = 45) at every ef.

**Reading.** ef 256 is the lowest setting that clears the 0.95 bar with server p90 under 20 ms,
and it is what l7a now runs (`/etc/systemd/system/vector-search.service.d/ef.conf`,
`VECTOR_SEARCH_EF=256`). ef 512 buys +0.004 for +7 ms at p90, landing at the 20 ms edge; not
worth it. Higher ef mostly lifts the worst queries (min 0.56 → 0.71 → 0.82), not the mean.
overlap@10 stays at ~0.95 at every ef, and the same 20–21 queries miss one or two of their
exact top-10 each time. Search depth doesn't explain those misses. The likely cause is e4m3
reordering of near-equal neighbours at the rank-10 boundary (the similarity error is ~0.001, and
10th/11th neighbours are often that close). This is inferred, not measured.

**Quantization, phase 1** (2,000 real rows, 30 queries, exact float32 cosine as truth,
2026-10-16):

| quantization | sim err mean / max | overlap@46 | note |
|---|---|---|---|
| i8 | 0.0129 / 0.031 | 0.951 | the atlas's choice; built 1.6× faster than e4m3 |
| **e4m3** | 0.0015 / 0.006 | 0.975 | chosen: same bytes as i8, ~8× smaller error |
| e5m2 | 0.0032 / 0.012 | 0.961 | |
| f16 | 0.00001 | 0.991 | 1,685 B/row: too big for the 14 GB slice at 7.6M rows |

On 54,413 rows, e4m3 gave overlap@45 0.967, similarity error 0.0012, server p50 3.1 ms. At 140×
the rows, the full index loses ~1–2 points of overlap at the same ef 128, which is why ef 256
is needed now.

**Caveats.**
- **Stored page vectors are not reader queries.** A page vector probably sits in a dense part of the
  space (near its own book's other pages). Reader queries embedded by Gemini from a
  few words can land in sparser regions, where HNSW recall behaves differently. Definition of done 2
  on #6821 (50 real queries from `search_queries`, and agreement with today's `match_semantic`)
  needs Gemini query vectors and is a later step. This job made no model calls.
- **The filtered path post-filters.** The service over-fetches k×4 and widens up to 4× again when
  the filter leaves fewer than k rows; it does not walk the graph under the predicate. A very
  selective filter can therefore return fewer rows than the RPC's iterative scan would. Latin ∧
  ≤1600 ∧ threshold 0.3 returned 20.2 of 45 on average. That number includes the threshold, and
  filtered recall against an exact filtered scan was **not** measured here. Measure it before the
  filtered path serves readers.
- Latency is on the l7a loopback, with the box shared with other jobs. The HTTP figures leave out
  the network hop from Vercel and the app's text hydration by primary key.
- n = 50 queries. The mean overlap moves by about ±0.01 between ef settings, about the size of the
  sampling noise on the worst few queries. The 0.95 bar is cleared at ef 256 by 0.006, not by a wide
  margin.
- The first delta after the build applied 0 changes, so the index and the shards were identical
  when the three runs were made (no sampled page had a newer vector).

**Replicated?** No: one seed, one build. The ef 128 run repeats the bootstrap's own eval (same
seed), not an independent draw.

**Artifacts** (on l7a): `/data/vector-search/logs/recall-20261016.json` (ef 128, written by the
bootstrap), `recall-ef256.json`, `recall-ef512.json` (per-query rows included), `bootstrap.log`
(count check). Instrument: `scripts/workers/vector-search/recall-eval.mjs`.
