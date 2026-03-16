# Post-Mortem: Atlas Search Index Build Causes Database Outage

**Date:** March 10, 2026
**Duration:** ~30 minutes of degraded service, ~15 minutes of full outage
**Severity:** High — all database-dependent routes were unresponsive
**Impact:** Site pages served from cache were unaffected; all search, API, and pipeline operations failed during the outage window.

## Summary

Building an Atlas Search index on the 2.65M-document `pages` collection via the MongoDB Node.js driver's `createSearchIndex()` API overwhelmed the Atlas cluster, causing cascading query timeouts and a full database outage. The index had to be dropped to restore service.

## Timeline

| Time | Event |
|------|-------|
| T+0 | Created `books_search` and `pages_search` Atlas Search indexes via `_tmp-create-search-indexes.mjs` script using `db.collection().createSearchIndex()` |
| T+1m | Both indexes in PENDING state, then BUILDING. `books_search` on 7K docs builds quickly. |
| T+5m | `books_search` reaches READY. `pages_search` still BUILDING on 2.65M docs (8.8 GB data, 9.1 GB indexes). |
| T+10m | Deployed code that uses `$search` with regex fallback. Book search works via Atlas Search. |
| T+12m | `/api/search` route hangs indefinitely — `$search` on pages doesn't throw when index is BUILDING, it just blocks forever. No timeout, so no fallback to regex. |
| T+15m | Fix deployed: added `maxTimeMS` to all `$search` aggregation calls. Search routes now fall back to regex when Atlas Search hangs. |
| T+20m | DB queries start timing out across the board. `countDocuments`, search aggregations, and pipeline queries all fail with server selection timeouts. The `pages_search` index build is consuming all cluster IOPS. |
| T+25m | Dropped `pages_search` index via `db.collection('pages').dropSearchIndex('pages_search')`. |
| T+30m | DB begins recovering but heavy aggregations still time out. Simple operations (ping, findOne) respond. |
| T+45m | DB fully recovered. All queries responding normally. |

## Root Causes

### 1. Unthrottled index build via driver API

The MongoDB Node.js driver's `createSearchIndex()` initiates an index build that runs at full speed, consuming all available cluster IOPS. On a 2.65M-document collection with 8.8 GB of data and 9.1 GB of existing indexes, this saturated the Atlas cluster's I/O capacity.

The Atlas UI, by contrast, throttles index builds to maintain cluster availability. The driver API provides no throttling or priority options.

### 2. `$search` hangs instead of erroring on BUILDING indexes

When an Atlas Search index is in BUILDING state, `$search` queries don't throw an error — they block indefinitely waiting for the index to become available. This meant the catch block (which falls back to regex) never executed, and the route hung until the Vercel function timeout (30s).

This was fixed by adding `maxTimeMS` to all `$search` aggregation calls, which forces a timeout and triggers the regex fallback. But the root behavior (hanging instead of erroring) is a MongoDB design choice that can't be changed.

### 3. No resource impact assessment before building

The `pages` collection has:
- 2,691,645 documents
- 8.8 GB data size
- 9.1 GB total index size
- Text fields (`ocr.data`, `translation.data`) averaging several KB per document

Building a Lucene search index requires reading and tokenizing every text field in every document. On this scale, the I/O load is equivalent to a full collection scan that also writes a large secondary index. The Atlas cluster (likely M10 or M20 tier) didn't have enough headroom to handle this alongside normal operations.

## What Was Fixed

### During the incident

1. **Added `maxTimeMS` to all Atlas Search queries** (commit `10795d0d`):
   - `search/route.ts`: book search (5000ms), page search (10000ms), nearby books (5000ms)
   - `search/unified/route.ts`: book search (5000ms)
   - This ensures `$search` queries timeout and fall back to regex instead of hanging forever

2. **Dropped `pages_search` index** to stop the build and restore cluster I/O

### After the incident

3. **Created `scripts/maintenance/db-health.mjs`** — health check script that tests connectivity, latency, search indexes, pipeline status, active jobs, and recent cron health in ~1 second

4. **Updated `.claude/docs/search.md`** with Atlas Search index definitions and migration status (commit `35882dc5`)

## What Still Works

- `books_search` Atlas Search index is READY and serving book queries at ~37ms (was ~40ms with `$text`, but now with Lucene relevance ranking)
- All search routes have regex fallback — if Atlas Search is unavailable, they degrade gracefully
- The old `$text` indexes (`books_text_idx`, `pages_text_idx`) are still in place as fallback

## What's Deferred

- **`pages_search` index creation** — must be done via Atlas UI (not the driver API). The Atlas UI throttles index builds to avoid impacting cluster availability. Index definition is documented in `.claude/docs/search.md`.
- **Page content search performance** — still falls back to regex (~16s for content search). Will improve to sub-second once `pages_search` is built via Atlas UI.
- **Dropping old `$text` indexes** — keep them as fallback until Atlas Search is fully stable (both indexes READY for 1+ week).

## Lessons Learned

1. **Never build Atlas Search indexes programmatically on large collections.** The driver's `createSearchIndex()` runs at full speed with no throttling. Use the Atlas UI for any collection over ~100K documents — it throttles builds to maintain cluster availability.

2. **`$search` hangs on BUILDING indexes — always use `maxTimeMS`.** Unlike `$text` which errors on missing indexes, `$search` blocks indefinitely when the index exists but is still building. Every `$search` aggregation must have `maxTimeMS` to ensure fallback paths execute.

3. **Test index builds on staging first.** The 7K-document `books` collection built in seconds. The 2.65M-document `pages` collection saturated the cluster. Collection size matters enormously for index build impact.

4. **Have a health check script ready before making infrastructure changes.** The `db-health.mjs` script would have made it easier to assess the situation during the incident instead of ad-hoc Node.js one-liners.

5. **Regex fallback is essential during migration.** The try/catch fallback pattern saved the site — book search still worked (via Atlas Search for books, regex for pages) even during the outage. The maxTimeMS fix completed the safety net.

## Health Check

```bash
set -a; source .env.production.local; set +a; node scripts/maintenance/db-health.mjs
```

Exit codes: 0 = healthy, 1 = degraded, 2 = down.
