# Post-Mortem: MongoDB Atlas Outage & Lambda OCR Failures — Feb 19, 2026

## Summary

**Duration:** ~4:00 PM – ~4:45 PM EST (site outage). Lambda OCR failures spanned all day.
**Impact:** 45-min site outage. 119,537 failed OCR pages across the day. ~8,600 pages of wasted Gemini tokens (API calls succeeded but MongoDB saves failed).
**Root causes:** Two compounding issues:
1. Pipeline cron stuck in a loop re-submitting 25 books with local filesystem image paths (not HTTP URLs) — 110k failed pages from hours 0-12
2. Combined database load from the looping cron + a 310-book manual submission + local zombie processes with default 100-connection pools overwhelmed MongoDB Atlas in the afternoon

## Verified Data

| Metric | Value | Source |
|--------|-------|--------|
| Total OCR jobs today | 2,042 | `jobs` collection |
| Total OCR pages submitted | 194,283 | `jobs.progress.total` sum |
| Failed OCR pages | 119,537 | `jobs.progress.failed` sum |
| Completed OCR pages | 62,742 | `jobs.progress.completed` sum |
| Cron loop jobs (H0-12) | 1,560 jobs / 110,094 pages / 110,076 failed | Same 25 books re-submitted ~50x |
| Manual submission (H13) | 403 jobs / 77,983 pages / 310 books | `reocr-old-models.mjs` |
| H13 succeeded | 214 jobs / 27,624 pages | Lambda workers work when DB is healthy |
| H13 failed | 150 jobs / 8,589 pages | MongoDB timeouts during connection storm |
| Cancelled jobs | 420 / 43,852 pages | Manual cancellation |
| Translation jobs completed | 945 / 20,259 pages / 0 failed | Unaffected |
| OCR jobs yesterday (Feb 18) | 2,880 | Cron loop was running since at least yesterday |
| Scripts with `new MongoClient` | 54 | Grep of `scripts/` |
| Scripts with `maxPoolSize` set | 2 | Only `batch-extract-chapters.mjs` and `collect-postmortem-stats.mjs` |

## Timeline

| Time (UTC) | Event |
|-----------|-------|
| Feb 18 | Pipeline cron already submitting OCR for 25 books with bad image URLs. 2,880 jobs created, all failing. |
| 00:00 | Cron continues: 120 OCR jobs/hour, same 25 books. 100% failure rate (0 completed pages H0-9). |
| 10:00 | Some pages start succeeding (2,858 completed in H10). Unclear what changed. |
| 12:00 | Session B: Translation jobs processing (957 translate + 233 translation jobs). Working fine. |
| 13:00 | Session B: `reocr-old-models.mjs` submits 310 books / 77,983 pages to Lambda OCR queue. |
| 13:00 | Session B: `batch-extract-chapters.mjs` + diagnostic queries running. 6+ zombie `secret-lover run`/`node -e` processes from timed-out tool calls holding MongoDB connections (default poolSize 100 each). |
| ~13:30 | Combined load peaks: 10 Lambda workers (3-5 DB ops/page) + cron loop + zombie processes (~600 potential connections) + Vercel functions |
| ~15:45 | MongoDB starts refusing connections. Lambda Gemini calls succeed but DB saves fail. |
| ~16:00 | Full site outage. All API routes returning 500. |
| ~16:05 | User reports "no books found in the library" |
| 16:10-16:20 | Three waves of local process kills (18+ PIDs including zombies) |
| ~16:25 | OCR SQS queue self-draining (0 pending / 64 in-flight). IAM user lacks `sqs:PurgeQueue` — can't manually drain. |
| ~16:45 | Atlas recovered. Site confirmed working. |

## Root Cause #1: Cron Loop on Books with Bad Image URLs

25 books had `page.photo` set to **local filesystem paths** (e.g., `/Users/dereklomas/secondrenaissance/data/...`) instead of HTTP URLs. Their `archived_photo` fields showed `failed:Failed to parse URL from...`.

The pipeline cron (`post-import-pipeline`, every 10 min) kept submitting these books because:
1. Books were at `archive_complete` status
2. Cron submitted them for OCR → Lambda workers failed on every page (bad image URL)
3. Jobs completed as `completed_with_errors`
4. Cron checked: "does this book have OCR?" → No → re-submitted

This loop ran since at least Feb 18 (2,880 jobs yesterday). On Feb 19 hours 0-12: 1,560 jobs, ~110k failed "pages" (really the same 2,175 pages submitted ~50 times each).

**The Gemini cost for these was likely zero** — image URL fetch fails before any API call.

## Root Cause #2: Connection Storm from Stacked Workloads

At ~1 PM UTC, multiple heavy workloads converged:

1. **Cron loop:** Still submitting 120 jobs/hour (mostly failures, but each Lambda invocation opens a MongoDB connection)
2. **Manual 310-book submission:** 77,983 pages queued to SQS. 10 concurrent Lambda workers × 3-5 DB ops/page
3. **Local zombie processes:** 6 stale `node` processes from timed-out `secret-lover run` diagnostic queries. Each with default `maxPoolSize: 100` = up to 600 connection slots
4. **`batch-extract-chapters.mjs`:** Long-running script with its own MongoDB connections
5. **Vercel serverless functions:** Normal traffic + retries during degradation

The combined connection load exceeded Atlas capacity. MongoDB started timing out, creating a cascade:
- Lambda workers got Gemini results but couldn't save to MongoDB → ~8,589 pages of wasted tokens
- Vercel API routes couldn't connect → 500 errors
- User retry storms added more connection attempts

## Root Cause #3: No Emergency Stop

When the outage was detected:
- IAM user lacks `sqs:PurgeQueue` — can't drain the OCR queue
- IAM user lacks `lambda:PutFunctionConcurrency` — can't throttle workers to 0
- No kill switch API route
- OCR queue had to self-drain naturally (64 in-flight messages completing over ~10 min)

## What Went Wrong

1. **25 books with local filesystem image paths** entered the pipeline. The cron had no guard against non-HTTP URLs, creating an infinite re-submission loop.

2. **Claude Code tool timeouts create zombie processes.** `secret-lover run -- node -e "..."` killed at the tool timeout, but the child `node` process survives with a default 100-connection MongoDB pool.

3. **52 of 54 local scripts use default MongoClient settings** (100-connection pool). The app code (`mongodb.ts`) properly limits to 5 (Vercel) / 1 (Lambda), but scripts bypass this.

4. **No emergency stop capability.** Once pages are in SQS, we can't stop Lambda workers without AWS console access.

5. **Lambda OCR concurrency of 10** is aggressive for the database tier when combined with other workloads.

## Immediate Actions Taken

- [x] Killed all local zombie processes
- [x] Lambda OCR queue self-drained
- [x] Atlas recovered (~15 min after load reduced)
- [x] Site verified working
- [x] Fix the 25 books with local image paths → only 3 had local paths (reimported 2, updated URLs for 1)
- [x] Re-process H13 pages → actual damage was 2,155 pages / 35 books (not 8,600). 30 at `archive_complete` auto-processing via pipeline; 5 stragglers (36 pages) reset to `archive_complete`

## The Bigger Picture

The specific failures are symptoms. The underlying issue: we're operating a complex distributed system — crons, Lambda workers, SQS queues, MongoDB Atlas, Vercel, Gemini Batch API — without an operational layer.

1. **No visibility.** Great audit trails for individual books, but nothing answers "is the system healthy right now?" Outage discovered by a user, not monitoring.
2. **No flow control.** Cron submits as fast as it can. Lambda processes as fast as it can. SQS accepts unlimited. Nothing says "stop, this isn't working." The cron loop ran for 2 days unchecked.
3. **Multiple autonomous actors, one shared resource, zero coordination.** Two AI agent sessions, pipeline cron, Lambda workers, Vercel functions, batch API cron — all competing for the same Atlas connection pool.
4. **No isolation.** Scripts from a laptop hit the same cluster serving live users. A zombie diagnostic query can take down the site.
5. **Failures amplify.** Failed jobs get resubmitted. Timeouts trigger retries. Retries open more connections. No circuit breakers anywhere.
6. **No emergency controls.** Can't stop Lambda, can't purge SQS, can't throttle anything from CLI.

## Fixes

### Immediate — Patch the specific failures

- [x] Guard cron against non-HTTP image URLs — URL guard in Phase 2 + `batch-ocr-async` returns 422 for non-HTTP URLs + retry tracking with MAX_RETRIES in Phases 2/4
- [ ] Grant IAM `sqs:PurgeQueue` + `lambda:PutFunctionConcurrency`
- [x] Add `maxPoolSize: 1` to all 52 local scripts — other dev already applied to all 51+ scripts
- [x] Fix the 25 books with local filesystem paths — only 3 had local paths (reimported 2, updated URLs for 1)
- [x] Re-process H13 pages — 2,155 pages / 35 books re-enrolled in pipeline

### Visibility — Know when things are broken before users do

- [ ] `/api/health` endpoint — MongoDB connection count, active jobs, SQS queue depths, Lambda error rate (last hour). Simple JSON: "is the system OK?"
- [ ] Cron run logging — each pipeline cron run logs: books processed, jobs submitted, errors, duration. Currently a black box.
- [ ] Alert when error rate exceeds threshold (e.g., >50% Lambda OCR failures over 1 hour). Could be Slack webhook or simple email.

### Flow Control — Stop failures from amplifying

- [x] Circuit breaker in pipeline cron — other dev added `ocr_loop_count` / `translate_loop_count` circuit breakers in Phases 3/5; we added retry tracking with MAX_RETRIES=3 in Phases 2/4 + `needs_attention` status for permanent failures
- [ ] Backpressure check — cron checks active job count and SQS depth before submitting. If queue > N or jobs > M, skip this cycle.
- [ ] Reduce Lambda OCR concurrency from 10 to 3-5 — lower sustained DB load.
- [x] Per-book retry limit — max 3 retries for OCR/translation submission before `needs_attention` or `failed`

### Coordination — Multiple actors sharing one resource

- [x] Kill switch route — `POST /api/admin/emergency-stop` implemented by other dev. Pipeline cron checks emergency stop flag before processing.
- [ ] System status singleton — MongoDB doc or flag tracking current load (`{ active_ocr_jobs: N, active_scripts: [], last_updated }`). Crons and scripts check before starting.
- [ ] Script lockfile — batch scripts write `/tmp/sourcelibrary-*.lock` with PID. Others check before starting. Stale locks auto-expire.

### Isolation — Local dev shouldn't take down production

- [ ] Script max-runtime timeouts (30 min) with clean exit and connection cleanup.
- [ ] Shared `getScriptClient()` helper enforcing `maxPoolSize: 1` — all scripts import this instead of creating their own MongoClient.
- [ ] Verify Atlas tier and evaluate upgrade if warranted.

## Pipeline Status (Feb 19 evening, post-recovery)

| Metric | Count |
|--------|-------|
| Total OCR'd pages | 323,160 |
| New OCR (prompt v3-v5) | 247,848 (76.7%) |
| Old OCR (no prompt version) | 75,312 (23.3%) |
| Model: gemini-3-flash-preview | 87.5% |
| Model: gemini-2.5-flash (old) | 12.5% (~40k pages) |
| Total translated | 148,880 |
| New OCR + translated | 98,397 |
| New OCR + needs translation | 149,482 |
| Stale translations (new OCR, old translation) | 30,015 pages / 228 books |

**Priority backlog:**
1. **30k stale translations** — OCR upgraded but translations still based on old OCR output. Highest ROI (OCR work already done).
2. **75k old OCR pages** — still on pre-v3 prompts, need re-OCR.
3. **149k untranslated pages** — new OCR but no translation yet. Biggest backlog.

## Lessons Learned

1. **Bad data creates infinite loops.** 25 books with local paths → 4,440+ failed jobs over 2 days. No circuit breaker.
2. **The system is a black box.** Nobody knew the cron was looping until the site went down. Operational visibility ≠ audit trails.
3. **Headline numbers are misleading.** "119k failed pages" was 2,175 pages resubmitted 50 times. Always dig into the data.
4. **Multiple autonomous actors need coordination.** Two AI agents + crons + Lambda + Vercel all hitting one database needs flow control, not just bigger connection limits.
5. **You need an emergency stop button.** Without it, you watch helplessly.
