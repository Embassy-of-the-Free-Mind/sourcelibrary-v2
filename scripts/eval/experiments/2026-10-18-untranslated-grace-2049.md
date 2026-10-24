---
stage: pipeline
measure: [none]
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "The original-text lane's grace cannot be cut much without costing readers its rows. On 60 real global search_translations calls the lane answered a median 1,462 ms after its start (p10 486, p90 3,160); only 7 of 56 answered within 500 ms and none within 100 ms. Today's rule, 500 ms after the English answer, showed its rows on 8 searches (40 rows). Timed from the lane's start, 525 ms keeps all 40, 500 ms keeps 35 (0.875), 250 ms keeps 12 (0.30) and 0 ms none. The grace is now 550 ms from the lane's start: the same output on all 60 searches (overlap 1.000). It shortens the answer only by the English lane's own time (~66 ms p50), or by up to ~500 ms when the English lane falls back to the RPC."
status: adopted
decision: "UNTRANSLATED_GRACE_MS = 550, counted from the lane's start (the shared query vector is ready), not after the English answer. Dropping the grace (0) would save ~0.5 s on most searches and lose every original-text row the lane now shows (8 of 60 searches here; ~35% of /api/search calls in production in the 6 h before) — that trade is a product decision, raised on #2049, not taken here."
issue: [2049]
---

PRIOR ART: `2026-10-07-orig-lang-embedding-recall-5729.md` (what the lane finds, and why it exists); `2026-10-18-within-book-keyword-service-2049.md` (where the 500 ms wait was first named as most of global search_translations' time). Instrument: `scripts/eval/search-evals-2049/untranslated-grace.ts`.

## 2026-10-18 · How short can the original-text lane's grace be?

**Question.** Global `search_translations` (~1.2 s) waits up to `UNTRANSLATED_GRACE_MS` (500 ms) after the English answer for the original-text lane (`match_semantic_untranslated`, pages with no English). Since the English lane moved to the vector service (#6821) it answers in ~10–100 ms, so the wait is most of the semantic lane's time. Is that wait buying rows? Could the grace instead be timed from the lane's start, and how short could it be while keeping ≥ 95% of the rows readers see today?

**Panel.** 60 real global `search_translations` calls (`mcp_tool_calls`, ok, no `book_id`, English, one per distinct query, 14 days, seed 2049), in two disjoint panels of 30 (`--skip 30`). The panels hold users' queries, so they are not committed. Each call ran the semantic page lane of `/api/search` as `conceptPageSearch` runs it, from l7a, with the English lane in `VECTOR_SEARCH_MODE=serve` as in production. The original-text lane was awaited to its own end (4 s abort), with timestamps; all times are from the lane's start, when the query vector both lanes share was ready. Each call was then fused twice (`fuseConceptLanes`: with the lane's rows, and without) and cut to the 15 rows the route takes. A rule's output on a call is exactly one of the two, so the overlaps below are exact. Gemini: one query embedding per call (60).

### When the lane's rows arrive (56 calls where the lane answered; 4 hit its abort)

| within … ms of the lane start | 0 | 100 | 250 | 500 | 750 | 1,000 | 2,000 |
|---|---|---|---|---|---|---|---|
| calls | 0 | 0 | 3 | 7 | 10 | 17 | 38 |
| share | 0 | 0 | 0.05 | 0.12 | 0.18 | 0.30 | 0.68 |

The English answer came at 66 ms p50, 95 p90, 292 max.

### What readers see at each setting (60 calls)

The rule for each setting: the lane's rows are shown when they arrive by max(English, G).

| grace | searches showing lane rows | original-text rows shown in the 15 | of today's rows kept | overlap@15 with today | wait after the English answer, p50 / p90 ms |
|---|---|---|---|---|---|
| **today: English + 500** | 8 | 40 | 1.000 | 1.000 | 500 / 500 |
| 0 | 0 | 0 | 0.000 | 0.950 | 0 / 0 |
| 100 | 0 | 0 | 0.000 | 0.950 | 34 / 52 |
| 250 | 3 | 12 | 0.300 | 0.969 | 184 / 202 |
| 400 | 4 | 18 | 0.450 | 0.976 | 334 / 352 |
| 500 | 7 | 35 | 0.875 | 0.994 | 433 / 451 |
| 525 | 8 | 40 | 1.000 | 1.000 | 458 / 476 |
| **550 (shipped)** | 8 | 40 | 1.000 | 1.000 | 483 / 501 |
| 750 | 10 | 49 | 1.000 | 0.990 | 683 / 699 |
| 1,000 | 17 | 80 | 1.000 | 0.953 | 926 / 949 |

- **The lane is mostly cold.** Its index (7.5 GB) does not fit Supabase's cache. The rows the grace buys come from the ~1 in 8 searches where it is warm enough to answer within ~0.5 s. The 8 searches today's rule includes answered at 124–522 ms after the lane's start.
- **The shortest setting that keeps ≥ 95% is 525 ms.** The latest included row arrived at 522 ms. 550 ms leaves 25 ms of margin for production's English leg, which pays the fra1 → l7a round trip (svc_ms p50 29 from Vercel, `2026-10-17-vector-serve-fault-injection-2049.md`). With 8 included searches, the boundary is one call.
- **What changes for readers: nothing on this panel.** The output is identical on all 60 searches. The answer waits ~17 ms less at p50, because the clock no longer adds the English lane's own time. When the English lane falls back to the RPC (~1.1 s), the answer no longer waits a further 500 ms: by then the grace from the lane's start has run out.
- **Not chosen: a shorter grace.** 0 ms would answer ~0.5 s sooner on most searches. The cost is the lane's rows on every search that shows them today: 40 rows on 8 of 60 here, and production's `search_queries` had the lane `ok` on 293 of the 826 searches it ran on (late 532, failed 1) in the 6 h to 23:31Z. That changes what readers see, so it is a decision for #2049, not a latency fix.
- **Measured from l7a**, not Vercel. The lane's RPC from fra1 pays its own round trip. Production's late/ok mix (35% ok over those 6 h) is warmer than this panel (8/60). Both panels ran a call every few seconds, so a call's own lane query warmed the index only for the calls after it.
