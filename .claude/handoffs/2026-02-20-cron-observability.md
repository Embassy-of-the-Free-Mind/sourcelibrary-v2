# Cron Observability: Structured Logging for All 9 Crons

**Date:** 2026-02-20
**Status:** Complete, deployed to production

## Problem

6 of 9 crons wrote nothing to the database. Critical decisions like "OCR submission skipped due to 200 active batch jobs" or "time budget exhausted at Phase 4" vanished into Vercel function stdout. The 3 crons that did log used ad-hoc inline writes with inconsistent schemas. The `cron_runs` collection and `/api/analytics/pipeline` route existed as consumers but had sparse, inconsistent data.

## Solution

Created a shared `cron-logger.ts` utility (builder pattern), instrumented all 9 crons, added indexes, and extended the analytics pipeline route with `recentDecisions`.

## Files Changed

| File | Change |
|------|--------|
| `src/lib/cron-logger.ts` | **NEW** — core utility (CronLogger class, createCronLogger factory) |
| `src/app/api/admin/ensure-indexes/route.ts` | Added 3 `cron_runs` indexes |
| `src/app/api/cron/sync-page-counts/route.ts` | Migrated from inline write to logger |
| `src/app/api/cron/social-reset/route.ts` | Added logger |
| `src/app/api/cron/archive-ocr/route.ts` | Added logger |
| `src/app/api/cron/sync-gallery-images/route.ts` | Added logger |
| `src/app/api/cron/submit-batch-ocr/route.ts` | Added logger |
| `src/app/api/cron/submit-ocr/route.ts` | Added logger |
| `src/app/api/cron/social-post/route.ts` | Added logger (try/finally pattern for 7 early returns) |
| `src/app/api/cron/process-batches/route.ts` | Migrated + added decision logging |
| `src/app/api/cron/post-import-pipeline/route.ts` | Migrated + added decision logging |
| `src/app/api/analytics/pipeline/route.ts` | Added `recentDecisions` query |
| `.claude/docs/observability.md` | Documented cron logger system |

## Key Design Decisions

1. **Builder pattern** — accumulate state during cron execution, write one document on `flush()`. Non-blocking with try/catch (follows `logGeminiCall` pattern).
2. **Decisions array** — the core innovation. Captures *why* work was skipped (backpressure, time budget, circuit breaker, etc.). Capped at 100 entries per run.
3. **Backwards compatibility** — `failed: boolean` field preserved for existing `analytics/pipeline` reads that check `r.failed`.
4. **try/finally for social-post** — has 7 early return points. All assign to a `response` variable; `finally` block calls `flush()`.
5. **In-memory caching on analytics/pipeline** — 3-minute TTL added during implementation to reduce DB load from repeated dashboard queries.

## Verification

After crons fire, verify all 9 are writing:
```javascript
db.cron_runs.aggregate([
  { $group: { _id: '$cron', count: { $sum: 1 }, lastRun: { $max: '$timestamp' } } },
  { $sort: { _id: 1 } }
])
```

Check decisions are being captured:
```javascript
db.cron_runs.find({ 'decisions.0': { $exists: true } }).sort({ timestamp: -1 }).limit(10)
```

## Known Issue

The 3 new `cron_runs` indexes haven't been created yet — the `ensure-indexes` route timed out when triggered manually. They'll be created on the next successful ensure-indexes run or can be created manually in Atlas.
