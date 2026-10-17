---
stage: pipeline
measure: [none]
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "Both search services hold the 19:55 'plague' burst pattern (7 parallel) with no errors, idle and while sl-tsc runs on their box. The keyword service also holds 20 parallel (p99 ≤ 485 ms against a 1,500 ms budget). The vector service at 20 parallel sends 4.5–9.5% of calls past its 400 ms budget (p99 1.0–1.3 s) while its own handler time stays under 20 ms: a staircase of ~95 ms per request somewhere on l7a, outside the timed handler. The 21:04 memory-throttle condition was not reproduced, because vector-search is still in sourcelibrary.slice at the 20 GiB runtime stopgap."
status: informational
issue: [2049, 6821, 6852]
---

PRIOR ART: `scripts/workers/vector-search/latency-eval.mjs` measures the vector service one request at a time on l7a itself; `2026-10-17-keyword-service-parity-6852.md` measured keyword latency sequentially. Neither runs concurrency, nor runs under memory pressure on the serving box. Instruments: `scripts/eval/search-evals-2049/burst.mjs`, `lane-params.harness.ts`.

## 2026-10-17 · Do the vector and keyword services hold a burst, and does a type-check on their box hurt them? (#2049 eval check 3)

**Question.** In `serve`, a reader's search waits on these services (400 ms budget for vectors, 1,500 ms for keywords) before falling back. On 2026-10-17 at 19:55 one client fired seven parallel searches, and at 21:04 two `sl-tsc` runs on l7a pushed `sourcelibrary.slice` over `memory.high`, so the kernel throttled vector-search into timing out. Does each service keep its budget at 1, 7 and 20 parallel requests, and with a type-check running beside it?

**Method.**
- **Load.** From the main Hetzner box, over the public TLS fronts (`vectors.` / `keywords.sourcelibrary.org`), as Vercel calls them. 200 requests per run.
- **Vector bodies.** 200 stored `page_translations` vectors, so no model call. Shape as serve mode sends it: k 40, threshold 0.3, `with_text`. One arm sends ids only, as shadow does.
- **Keyword bodies.** 200 distinct logged site queries (14 days), each built into the route's exact `/lane` body.
- **"Over app budget"** = slower than the app's own timeout. That request would fall back in serve.
- **Isolation.** Helper jobs on l7a and cloudlayer ran `sl-tsc` back to back, 22:29:44–22:33:54Z, sampling cgroup memory every 10 s. Main ran three rounds of both bursts inside that window.
- **State.**
  - l7a: vector-search and Caddy in `sourcelibrary.slice`, `memory.high` 20 GiB / `max` 22 GiB (the runtime stopgap after 21:04). The own-slice fix is not installed.
  - cloudlayer: keyword-search in `search.slice/search-services.slice` (#6868).

**Results.**

| service | state | conc | n | client ms p50 / p90 / p99 / max | server ms p50 / p90 / p99 | req/s | over app budget | other errors |
|---|---|---|---|---|---|---|---|---|
| vector | idle | 1 | 200 | 33.5 / 49.3 / 61.9 / 378.4 | 20 / 33.3 / 46.4 | 30.1 | 0 | 0 |
| vector | idle | 7 | 200 | 57.2 / 106.1 / 144.9 / 180.7 | 7.7 / 9.9 / 12.7 | 107.3 | 0 | 0 |
| vector | idle | 20 | 200 | 118.9 / 247.2 / 1201.6 / 1276.4 | 7.5 / 9.4 / 13.1 | 111.2 | 16 | 0 |
| vector | idle, ids only (shadow shape) | 20 | 200 | 88.6 / 270.2 / 989.9 / 1108.3 | 6.2 / 8.5 / 17.1 | 135.8 | 12 | 0 |
| vector | idle, ids only (shadow shape) | 20 | 200 | 85.7 / 148.3 / 1011.2 / 1126.3 | 6.1 / 7.9 / 9.4 | 167 | 9 | 0 |
| vector | idle, repeat | 20 | 200 | 89.4 / 364 / 1124 / 1150.5 | 7.4 / 9.3 / 11.3 | 105.1 | 17 | 0 |
| keyword | idle | 1 | 200 | 67 / 124.1 / 278.2 / 359.5 | 19.8 / 75.9 / 232.4 | 12.2 | 0 | 0 |
| keyword | idle | 7 | 200 | 72.7 / 131.5 / 274.5 / 354.1 | 23.7 / 81 / 227.1 | 79.6 | 0 | 0 |
| keyword | idle | 20 | 200 | 197.1 / 339 / 484.8 / 645.2 | 108.5 / 235.8 / 386.1 | 91.4 | 0 | 0 |
| vector | sl-tsc running, round 1 | 1 | 200 | 21.2 / 29.3 / 39.9 / 101.9 | 9.5 / 12.3 / 15.9 | 48.7 | 0 | 0 |
| vector | sl-tsc running, round 1 | 7 | 200 | 58 / 99 / 139.4 / 177.5 | 7.5 / 9.5 / 10.8 | 111.6 | 0 | 0 |
| vector | sl-tsc running, round 1 | 20 | 200 | 119 / 267.1 / 1213.7 / 1335 | 7.4 / 9.5 / 12.2 | 109.9 | 17 | 0 |
| keyword | sl-tsc running, round 1 | 1 | 200 | 62.4 / 119.9 / 272.3 / 338.2 | 16.2 / 72.9 / 224 | 12.9 | 0 | 0 |
| keyword | sl-tsc running, round 1 | 7 | 200 | 72.7 / 125.1 / 269.8 / 339.4 | 24.1 / 75.9 / 225.8 | 81.4 | 0 | 0 |
| keyword | sl-tsc running, round 1 | 20 | 200 | 190.1 / 328.2 / 482.8 / 519.3 | 106 / 210.8 / 339.1 | 95.2 | 0 | 0 |
| vector | sl-tsc running, round 2 | 1 | 200 | 20.8 / 28.9 / 56.2 / 99 | 9.5 / 12.1 / 13.7 | 48.6 | 0 | 0 |
| vector | sl-tsc running, round 2 | 7 | 200 | 54.4 / 100 / 143.9 / 173.1 | 7.3 / 9.1 / 10.6 | 115.2 | 0 | 0 |
| vector | sl-tsc running, round 2 | 20 | 200 | 117.2 / 280.7 / 1269.5 / 1292.7 | 7.6 / 9.7 / 11.5 | 109 | 17 | 0 |
| keyword | sl-tsc running, round 2 | 1 | 200 | 63.3 / 120.1 / 270.5 / 346.4 | 16.8 / 72.7 / 223.7 | 13 | 0 | 0 |
| keyword | sl-tsc running, round 2 | 7 | 200 | 77.2 / 137.9 / 286.5 / 358.6 | 28.3 / 91.4 / 238 | 77.7 | 0 | 0 |
| keyword | sl-tsc running, round 2 | 20 | 200 | 201.9 / 330.5 / 455.6 / 475.7 | 109 / 222.5 / 355.6 | 92.3 | 0 | 0 |
| vector | sl-tsc running, round 3 | 1 | 200 | 20.1 / 30 / 37.2 / 124.7 | 9.6 / 11.9 / 13.6 | 49.2 | 0 | 0 |
| vector | sl-tsc running, round 3 | 7 | 200 | 53.2 / 100.9 / 157.1 / 180 | 7.2 / 9.1 / 10.6 | 116.8 | 0 | 0 |
| vector | sl-tsc running, round 3 | 20 | 200 | 92.1 / 383.3 / 996.7 / 1044.4 | 7.3 / 9 / 10.8 | 116.7 | 19 | 0 |
| keyword | sl-tsc running, round 3 | 1 | 200 | 63 / 120.3 / 267 / 342.2 | 16.6 / 71.7 / 221.8 | 12.9 | 0 | 0 |
| keyword | sl-tsc running, round 3 | 7 | 200 | 74.1 / 127.2 / 277.1 / 350.2 | 24.6 / 80.8 / 231.4 | 81.1 | 0 | 0 |
| keyword | sl-tsc running, round 3 | 20 | 200 | 193.2 / 331 / 466 / 487.4 | 108.2 / 210.9 / 362.8 | 93.6 | 0 | 0 |

**Memory during sl-tsc.**
- l7a: `sourcelibrary.slice` peaked at 17.7 GB, under its 20 GiB high. vector-search had 0 `memory.high` events and `memory.pressure some avg10` 0.00 throughout.
- cloudlayer: the jobs slice peaked at 11.4 GB and keyword-search at 2.9 GB, with 0 high events and no `earthai-*` failures.

**The vector tail at 20 parallel.** The service's own `ms` stays at 6–17 ms, and throughput flattens at ~105–167 req/s whatever the concurrency. Timestamping each request shows the slow ones, started together, finishing in a staircase about 95 ms apart (441, 522, 611 … 1,055 ms).
- It is not the HNSW search: handler time is flat.
- It is not the text store: the ids-only arm shows the same.
- It is not only TLS setup: in one run the slow calls were each worker's first request, in another they weren't.
- Not profiled; l7a can't be reached from main.

**Conclusion.**
- At production's real burst size (7), both services keep their budgets with room to spare, and a single type-check on the box does not touch them.
- **Not shown:** that the vector service survives the 21:04 condition. That needs its own slice installed and re-tested at the old 12 GiB limit, or two type-checks.
- **Pre-serve item for #6821:** the 20-parallel staircase. Each call past 400 ms falls back to `match_semantic`: correct, but slow.

**Caveats.**
- Stored page vectors are not reader query vectors. The HNSW cost is similar, but neighbourhoods differ.
- Keyword bodies were drawn from 14 days of logged queries, one sample (seed 2049).
- The check 4 known-item run was sending one request at a time to the keyword service during the idle rounds.
