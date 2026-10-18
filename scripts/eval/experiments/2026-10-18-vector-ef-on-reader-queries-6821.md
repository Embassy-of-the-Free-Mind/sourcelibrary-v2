---
stage: pipeline
measure: [accuracy]
languages: []
scripts: []
canons: []
n_books: null
n_pages: 7631047
verdict: "On 38 real reader queries the page-vector service at ef 256 matched match_semantic's mean recall (0.900 vs 0.909 of the exact top-40) but missed two queries almost entirely (0.05, 0.60). ef 1024 lifts the mean to 0.948 with the worst query at 0.85, against match_semantic's worst of 0.55, for ~31 ms p50 / 100 ms p99 live. l7a runs ef 1024 from 2026-10-18; production serves from the service."
status: informational
issue: [6821, 2049]
---

PRIOR ART: `2026-10-16-vector-service-recall-6821.md` chose ef 256 on 50 stored page vectors used as queries. This file re-asks the question on real reader queries, which turned out to be harder.

## 2026-10-18 · Which ef serves real reader queries? (#6821)

**Queries.** 144 `/match` requests from production shadow traffic, captured on l7a's loopback with tcpflow on 2026-10-17. 38 are unique and unfiltered. They are Gemini query embeddings that production had already computed, so the test made no model calls.

**Reference.** Exact cosine top-40 by brute force over all 7,631,047 float32 page vectors (`usearch.exactSearch`, chunked over the pull shards), with each request's own threshold.

**Arms.**
- `match_semantic` (Supabase HNSW): one pass, live RPC.
- The service's e4m3 HNSW index (M = 16) at ef 256 / 512 / 768 / 1024 / 2048, on a read-only memory-mapped copy of the live generation-1 index.
- The ef 256 arm reproduces the live service's 0.900 exactly, which confirms the copy is a fair stand-in.

| arm | mean recall@40 | worst query | queries < 0.75 | search ms p50 / p90 |
|---|---|---|---|---|
| match_semantic | 0.909 | 0.55 | 4 | (RPC: seconds) |
| ef 256 (was live) | 0.900 | 0.05 | 2 | 7.5 / 8.9 |
| ef 512 | 0.941 | 0.80 | 0 | 13.8 / 16.4 |
| ef 768 | 0.944 | 0.80 | 0 | 18.6 / 24.1 |
| **ef 1024 (now live)** | **0.948** | **0.85** | **0** | 23.0 / 29.1 |
| ef 2048 | 0.950 | 0.85 | 0 | 40.0 / 55.4 |

**The two ef-256 misses.** These are navigation misses, not duplicates: all 40 exact texts were distinct.
- **q0.** The exact top hit was a page of *Oeuvres spirituelles*, and the service found 2 of the exact 40. At ef 512 it found 0.82, with the right top hit.
- **q21.** The exact top hit was Ānandakanda at 0.797, but the service returned Indian Hemp pages at 0.756. At ef 512 it found 0.95, with the right top hit.

**Live, after the restart at ef 1024.** 80 captured requests (filtered and unfiltered) went over loopback while a delta catch-up was running:
- sequential: p50 31, p90 38, p99 100 ms;
- 8 in parallel: p50 110, p90 199, p99 269 ms;
- errors: 0.

**Reading.**
- Stored page vectors used as queries overstate recall. The 2026-10-16 run found 0.956 at ef 256; real reader queries got 0.900 at the same setting. A page vector sits inside a dense neighbourhood of its own book. A short reader query lands between neighbourhoods, where an M = 16 graph needs a wider search to find its way.
- Tune on captured real queries.
- ef 1024 is past the knee: ef 512 already removes both failures, and 2048 adds 0.002 for twice the time. It was chosen for the extra 0.05 on the worst query, at a cost that stays inside the 400 ms client timeout under burst.
- Search-evals' proposal to lower the timeout to 360 ms is not taken. At ef 1024 the parallel p99 needs that headroom.

**Caveats.**
- n = 38 unique queries, from one evening's traffic.
- The reference covers the unfiltered path only. Filtered recall is in `2026-10-17-vector-service-filtered-recall-6821.md`.
- Instruments are in l7a scratch (`/data/scratch/sl/referee-ef.mjs`, `efsweep2.mjs`, `livelat.mjs`; the exact top-40 lists are in `referee-exact.json`).
