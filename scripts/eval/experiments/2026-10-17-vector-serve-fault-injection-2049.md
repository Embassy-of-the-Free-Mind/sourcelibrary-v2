---
stage: pipeline
measure: [none]
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "A frozen or dead page-vector service costs readers nothing in shadow, and in serve costs ~410 ms per semantic page search with 0 errors and identical rows. Live: a 60 s SIGSTOP of the production service (shadow) logged the 400 ms timeout on every overlapping search, every search answered 200, and rpc_ms did not rise. Preview in serve against a host that drops packets: +412 ms p50 / +443 ms p90 paired, 0 non-200, 0 empty, identical rows. The bar was ≤ 400 ms; the timeout itself is 400. Found on the way: match_semantic fails on 42 of 236 (17.8%) real site searches after 3–15 s, and the service answered 41 of those."
status: informational
issue: [2049, 6821]
---

PRIOR ART: `2026-10-17-vector-service-text-latency-6843.md` and the 21:04Z incident note on #6821 (the service timed out under memory throttling, observed passively). This is the deliberate version: a controlled freeze in shadow and a dead host in serve. Instruments: `scripts/eval/search-evals-2049/fallback-latency.mjs`; the live-freeze traffic generator and row reader stayed in job scratch.

## 2026-10-17 · What does a reader lose when the vector service freezes? (#2049 eval check 2)

**2a. Live freeze, production in shadow.**
- **Precondition.** `VECTOR_SEARCH_MODE` (sensitive, unreadable) was unchanged since it was set to shadow at 19:56Z, and `vector_shadow` rows were still arriving, which serve does not write.
- **Freeze.** A helper job on l7a ran `kill -STOP` on vector-search from 22:16:53.769Z to 22:17:53.773Z, then `kill -CONT`. `/health` returned 200 afterwards.
- **Traffic.** Main sent the 10-query panel to `/api/search` every 3 s for 5 min (83 requests, all 200).

| window (`ts` is written at log time) | rows (panel / readers) | `svc_error` | `rpc_ms` p50 / p90 | route ms p50 / p90 | non-200 |
|---|---|---|---|---|---|
| before | 28 (17 / 11) | 0 | 1,991 / 3,545 | 3,266 / 5,725 | 0 |
| frozen | 22 (20 / 2) | 19 (`timeout after 400 ms`) | 154 / 1,226 | 1,854 / 3,785 | 0 |
| after | 77 (47 / 30) | 0 | 1,177 / 3,873 | 3,393 / 6,684 | 0 |

- The 3 frozen-window rows without an error started before the STOP.
- `rpc_ms` fell during the freeze because the panel repeats its vectors (Postgres cache). The shadow call is never awaited, so it cannot add to `rpc_ms`.

**2b. Serve against a dead host, on a preview.**
- **Deployments.** Same main commit twice:
  - A: no vector vars.
  - B: preview- and branch-scoped `VECTOR_SEARCH_MODE=serve`, `VECTOR_SEARCH_URL=http://192.0.2.1:3458` (packets dropped), dummy token. Production untouched; the vars were deleted afterwards.
- **Calls.** 10-query panel × 5 rounds × 2 routes, interleaved A/B, alternating order, after one warm-up pass.

| route | A p50 / p90 / p99 | B p50 / p90 / p99 | added, paired p50 / p90 | non-200 A / B | empty A / B | same rows |
|---|---|---|---|---|---|---|
| `/api/search/semantic?level=page` | 147 / 191 / 290 | 563 / 592 / 693 | **+412 / +443** | 0 / 0 | 0 / 0 | 1.000 |
| `/api/search` | 578 / 1,049 / 3,382 | 632 / 840 / 1,664 | +137 / +298 | 0 / 0 | 0 / 0 | — |

**Production finding (shadow rows since 21:05Z, readers only).**
- 42 of 236 site searches (17.8%) carry `rpc_failed`: `match_semantic` errored after 3,071–15,174 ms (p50 4,280).
- The response then carries `degraded_lanes: ["semantic_page", …]`, and those readers get no semantic page lane.
- The service answered 41 of the 42 with 40 rows (svc_ms p50 29).

**Conclusion.**
- Serve's fallback is safe: no errors, and exact rows.
- It costs the timeout plus ~10–40 ms. For a strict ≤ 400 ms, lower `VECTOR_SEARCH_TIMEOUT_MS` to ~360. The service's own p99 at 7 parallel is 157 ms (`2026-10-17-search-services-burst-isolation-2049.md`).
- The RPC failure rate is the strongest argument for serve so far: in serve those searches would keep their semantic page lane.

**Caveats.**
- The panel's repeated vectors made the RPC itself fast in 2b (warm cache). The *added* time does not depend on that.
- The freeze window had 2 reader rows. The 20 panel rows carry the result.
