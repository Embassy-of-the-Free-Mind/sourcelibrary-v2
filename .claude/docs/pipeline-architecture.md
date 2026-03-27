# Source Library Pipeline Architecture

> Authoritative reference as of March 18, 2026. Detailed enough for any developer (human or AI) to operate, debug, or migrate the pipeline.
>
> **See also:** `pipeline.md` for the full processing pipeline (states, crons, prompts, costs).

---

## Table of Contents

1. [Where Everything Runs](#where-everything-runs)
2. [Book Lifecycle (State Machine)](#book-lifecycle-state-machine)
3. [OCR (Gemini Batch API on Hetzner)](#ocr-gemini-batch-api-on-hetzner)
4. [Translation (Hetzner Inline Worker)](#translation-hetzner-inline-worker)
5. [Adaptive Limits (Backpressure)](#adaptive-limits-backpressure)
6. [Emergency Controls](#emergency-controls)
7. [Current Velocity](#current-velocity-march-18-2026)
8. [Cost per Page](#cost-per-page-measured)
9. [Archiving to Cloudflare R2](#archiving-to-cloudflare-r2)
10. [Known Bugs and Gotchas](#known-bugs--gotchas)
11. [Batch API Failure History](#batch-api-failure-history)
12. [How to Switch Back to Vercel](#how-to-switch-back-to-vercel)
13. [Observability](#observability)
14. [Hetzner Server Setup (Disaster Recovery)](#hetzner-server-setup-disaster-recovery)

---

## Where Everything Runs

### Vercel (4 lightweight crons)

These are NOT pipeline orchestration -- they handle social posting, health checks, and reporting only.

| Route | Schedule | Purpose |
|-------|----------|---------|
| `/api/cron/social-post` | Every 3h | Post to social media |
| `/api/cron/social-reset` | Daily midnight | Reset social post state |
| `/api/cron/health-check` | Hourly | System health monitoring |
| `/api/cron/daily-pipeline-report` | Daily 6am | Email pipeline summary |

Note: `enrich-books` cron code exists in the codebase but is NOT in `vercel.json` -- enrichment runs from Hetzner now.

### Hetzner (root@46.224.122.120, cax31, "clawdbot") -- ALL pipeline orchestration

- Main script: `scripts/workers/pipeline-orchestrator.mjs` (~2000 lines)
- Independent phase crons with per-phase lock files
- **Crontab is versioned** at `scripts/workers/crontab.production` (dumped 2026-03-27)

#### Hetzner Cron Schedule

**Pipeline core (high frequency):**

| Cron | Interval | Lock file | Purpose |
|------|----------|-----------|---------|
| `pipeline-orchestrator.mjs` (main) | */2 min | `sl-pipeline.lock` | All phases (fallback orchestrator) |
| `translate-worker.mjs` | */2 min | `sl-translate.lock` | Inline translation via Gemini (no Lambda) |
| `--phase 1.5` (preview OCR) | */2 min | `sl-preview-ocr.lock` | First 25 pages via Lambda for fast preview |
| `--phase 5` (translate complete) | */5 min | `sl-translate-complete.lock` | Translation completion check |
| `--phase 0` (enrollment) | */10 min | `sl-enroll.lock` | New books -> queued |
| `--phase 1` (archive check) | */10 min | `sl-archive-check.lock` | queued -> archive_complete |
| `--phase 2` (OCR submit) | */10 min | `sl-ocr-submit.lock` | Submit to Gemini Batch API |
| `--phase 3` (OCR complete) | */10 min | `sl-ocr-complete.lock` | Batch results -> pages |
| `batch-collector.mjs` | */10 min | `sl-collector.lock` | Poll Gemini Batch API |
| `archive-bulk.mjs` | */10 min | `sl-archive-bulk.lock` | IA bulk JP2 zip download -> R2 |

**Archiving & image processing (medium frequency):**

| Cron | Interval | Lock file | Purpose |
|------|----------|-----------|---------|
| `archive-ocr.mjs` | */30 min | `sl-archive-ocr.lock` | Per-page IIIF download -> R2 |
| `resize-worker.mjs` | */30 min | `sl-resize.lock` | Generate display-size from full-res |
| `sync-worker.mjs` | */2 hr | `sl-sync.lock` | Page count cache refresh |

**Daily maintenance:**

| Cron | Time | Lock file | Purpose |
|------|------|-----------|---------|
| `warm-author-pages.mjs` | 5:00 UTC | `sl-warm-authors.lock` | ISR cache warmup for author pages |
| `prewarm-browse.mjs` | 5:15 UTC | `sl-prewarm.lock` | ISR cache warmup for browse pages |
| `pipeline-health-alert.mjs` | 7:00 UTC | `sl-health.lock` | Daily throughput + storage alerts |

**Vercel proxy (calls Vercel endpoints from Hetzner):**

| Cron | Interval | Lock file | Purpose |
|------|----------|-----------|---------|
| `cron-caller.mjs social-post` | */3 hr | `sl-social-post.lock` | Calls Vercel endpoint |
| `cron-caller.mjs social-reset` | Daily midnight | -- | Calls Vercel endpoint |
| `cron-caller.mjs daily-pipeline-report` | Daily 6am | -- | Calls Vercel endpoint |

### AWS Lambda (eu-central-1)

| Function | Runtime | Memory | Timeout | Last Modified |
|----------|---------|--------|---------|---------------|
| `sourcelibrary-ocr-processor` | Node 24 | 384 MB | 240s | Mar 9 |
| `sourcelibrary-translation-processor` | Node 24 | 384 MB | 90s | Mar 16 |

- IAM user: `sourcelibrary` (account 984498058219)
- Narrow permissions: can deploy but can't list functions/queues or read CloudWatch

Deploy command:
```bash
npm run lambda:prepare && secret-lover run -- bash -c \
  'export AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID_SOURCELIBRARY; \
   export AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY_SOURCELIBRARY; \
   aws lambda update-function-code \
     --function-name sourcelibrary-ocr-processor \
     --zip-file fileb://dist/packages/ocr-processor.zip \
     --region eu-central-1'
```

### SQS Queues (eu-central-1)

| Queue | Type | Notes |
|-------|------|-------|
| OCR | Standard (parallel) | -- |
| Translation | FIFO (sequential per job) | MessageGroupId = job ID |
| Image extraction | Standard (parallel) | -- |
| Write results | Standard | Batched: 10 messages, 5s window |

### MongoDB Atlas (db: bookstore)

- 28,625 books, 4.22M `gemini_usage` records
- Key collections: `books`, `pages`, `jobs`, `batch_jobs`, `gemini_usage`, `cron_runs`, `system_config`, `page_revisions`
- **Saturates at ~40 concurrent Lambda jobs** -- adaptive limits prevent this

---

## Book Lifecycle (State Machine)

```
Import (API or batch script)
  |
  v
Phase 0: Auto-enroll (books created <14 days, no pipeline_auto)
  -> queued
  |
  v
Phase 1: Archive check (Hetzner downloads images to R2)
  -> archiving -> archive_complete (or 24h timeout, advances anyway)
  |
  v
Phase 2: OCR submission (Hetzner builds JSONL, submits to Gemini Batch API)
  -> ocr_submitted
  |
  v
Phase 3: OCR completion (batch-collector polls Gemini, saves to pages)
  -> ocr_complete
  |
  v
Phase 3.5: Metadata enrichment (language, categories, description, dates)
  -> metadata_enriched
  |
  v
Phase 3.7: Transliteration (inline on Hetzner for non-Latin scripts: Greek, Hebrew, Arabic, Chinese, etc.)
  [No status change -- adds transliteration.data to pages]
  |
  v
Phase 4: Translation dispatch (pages enqueued to SQS FIFO)
  -> translate_submitted
  |
  v
Phase 5: Translation completion (Lambda workers process sequentially per book)
  -> translate_complete
  |
  v
Enrichment (summary + index generation via Gemini)
  -> enriching -> enriched
  |
  v
Chapter extraction
  -> chapters -> chapters_complete
  |
  v
Image extraction (Lambda workers via SQS standard queue)
  -> images_submitted -> images_complete
  |
  v
Finalization (validates >10% OCR coverage)
  -> complete
```

### Failure States

| Status | Meaning |
|--------|---------|
| `failed` | After 3 retries |
| `needs_attention` | Manual triage required |
| `empty_shell` | 0-page imports |
| `paused` | Manually or automatically paused |

Non-critical phases (enrichment, chapters) skip ahead on persistent failure rather than blocking the pipeline.

---

## OCR (Gemini Batch API on Hetzner)

**Why Hetzner:** 50% cost discount via Batch API, no timeout for hours-long batch waits.

### Flow

1. Phase 2 downloads page images locally from IIIF URLs
2. Builds JSONL file with OCR prompts + base64 images
3. File upload for >20 pages (via Gemini File API), inline for <=20 pages
4. One job per book (was 25 small jobs, changed to avoid 100 concurrent limit)
5. File-based batches hold ~150 pages per job
6. API key rotation: `GEMINI_API_KEY_2`, `GEMINI_API_KEY_TIER3`, `GEMINI_API_KEY`
7. `batch-collector.mjs` polls every 10 min, saves results to `pages.ocr.data`

### Configuration Constants

| Constant | Value |
|----------|-------|
| `OCR_INLINE_BATCH_SIZE` | 20 |
| `OCR_FILE_BATCH_SIZE` | 150 |
| `MAX_ACTIVE_BATCH_OCR` | 500 |
| Model | `gemini-3-flash-preview` |

### Cost

$0.0017/page (measured from `gemini_usage`: $354 / 211K pages over 7 days)

---

## Translation (Hetzner Inline Worker)

**Why not Batch API:** Cross-page context continuity. Each page must see the previous page's translation to maintain coherent output. The Batch API returns results in arbitrary order -- this was learned the hard way on Feb 18 when 17K pages got wrong translations.

**Why Hetzner, not Lambda/SQS:** The `translate-worker.mjs` calls Gemini directly, avoiding SQS/Lambda overhead and enabling model routing (flash for BPH, lite for others). Lambda translation still exists for preview and manual jobs.

### Flow (Production)

1. Orchestrator Phase 4 creates a `jobs` record, sets book to `translate_submitted`
2. `translate-worker.mjs` (Hetzner cron, every 2 min) picks up books in `translate_submitted`
3. Translates pages sequentially per book (previous page's translation as context)
4. Calls Gemini directly -- model: `gemini-3-flash-preview` (BPH) or `gemini-3.1-flash-lite-preview` (others)
5. Writes translation directly to `pages` collection
6. Rotates API keys on rate limits (up to 11 keys)
7. Concurrency: 20 books simultaneously, 8,000 page cap per run

### Legacy Lambda Path (Fallback)

Lambda translation processor + SQS FIFO queue still work. Used only for:
- Preview translation (first 25 pages via `preview-translate.ts`)
- Manual job submission via `/api/jobs/queue-books`

### Special Cases

- **English books** use `ENGLISH_MODERNIZATION_PROMPT` instead of the translation prompt

### Cost

$0.0045/page (measured: $408 / 91K pages over 7 days)

---

## Adaptive Limits (Backpressure)

Stored in `system_config._id: 'adaptive_limits'`

| Resource | Min | Default | Max |
|----------|-----|---------|-----|
| OCR books/run | 2 | 10 | 20 |
| OCR Lambda concurrency | 3 | 10 | 20 |
| Translation books/run | 2 | 20 | 50 |
| Translation Lambda concurrency | 3 | 15 | 30 |
| Global active jobs | 5 | 20 | 40 |
| Image extraction/run | 3 | 10 | 20 |

### Health Signal Responses

| Health State | Action |
|--------------|--------|
| Healthy | Ramp up 20% |
| Degraded | Reduce 50% |
| Critical | Slam to minimums + cancel pending |

Health signals: DB query latency, active job count, cron duration, SQS depth.

**Override:** `PATCH /api/admin/adaptive-limits` with `locked: true`

---

## Emergency Controls

| Action | How |
|--------|-----|
| Stop all processing | Set `system_config._id: 'processing_control'` -> `paused: true` |
| Resume processing | `POST /api/admin/emergency-stop?resume=true` |
| Selective pause | Set `paused_phases: ['ocr','translation','images']` |

**WARNING:** `paused: true` does NOT stop Lambda workers that are already running. You must CANCEL the jobs in MongoDB to actually stop in-flight work.

---

## Current Velocity (March 18, 2026)

### Last 24 Hours

| Type | Calls | Pages | Cost |
|------|-------|-------|------|
| Translation | 57,893 | 56,475 | $221.51 |
| Index | 4,012 | 44,568 | $23.57 |
| Transliteration | 21,160 | -- | $17.92 |
| OCR | 10,921 | 53,083 | $7.17 |
| FT verification | 1,046 | -- | $4.93 |
| Image extraction | 966 | 966 | $1.65 |
| Summary | 91 | 1,602 | $0.70 |
| Chapters | 93 | 22,417 | $0.69 |
| **Total** | -- | -- | **$278.14** |

### Last 7 Days

| Type | Calls | Pages | Cost |
|------|-------|-------|------|
| Translation | 106,781 | 91,256 | $407.82 |
| OCR | 139,013 | 211,327 | $354.30 |
| Index | 19,138 | 163,258 | $112.20 |
| Transliteration | 21,160 | -- | $17.92 |
| FT verification | 2,348 | -- | $13.76 |
| Other | 1,122 | 23,688 | $8.19 |
| Chapters | 436 | 86,005 | $3.00 |
| Summary | 306 | 5,126 | $2.40 |
| Image extraction | 966 | 966 | $1.65 |
| **Total** | -- | -- | **$921.24** |

### Projections

- Current run rate: ~$130/day average over 7 days, spiking to $278 today
- Monthly estimate: **~$3,700-$4,000/month**
- Remaining backlog: ~20K books with no OCR, ~24K with no translation
- Full processing of backlog: **~$35K** at current per-page costs

---

## Cost per Page (Measured)

| Phase | $/page | Per 300-page book |
|-------|--------|-------------------|
| OCR (batch) | $0.0017 | $0.51 |
| Translation (realtime) | $0.0045 | $1.35 |
| Index generation | $0.0007 | $0.21 |
| Image extraction | $0.0017 | $0.51 |
| Transliteration | ~$0.001 | $0.30 |
| **Full pipeline** | **~$0.009** | **~$2.70** |

---

## Archiving to Cloudflare R2

Script: `archive-ocr.mjs` (every 4 hours on Hetzner)

### Flow

1. Finds pages with `ocr.data` but no `archived_photo`
2. Downloads from source IIIF URL
3. Uploads to `https://images.sourcelibrary.org/archived/{bookId}/{pageNumber}.jpg`
4. Stores `archive_metadata.archived_at`, `source_url`, `bytes`

### R2 Cost

- Storage: $0.015/GB/month
- Writes: $4.50/M operations
- Egress: Free within Cloudflare

---

## Known Bugs & Gotchas

1. **`gemini_usage.timestamp` is a string, not Date.** Date-range queries with Date objects return nothing. Use ObjectId range filtering as a workaround.

2. **Hetzner crontab is local, not in git.** If the server dies, cron config is lost. Must recreate manually from the table in this document.

3. **`paused: true` doesn't stop running Lambdas.** Must cancel jobs in MongoDB to stop in-flight work.

4. **MongoDB saturates at ~40 concurrent Lambda jobs.** Adaptive limits prevent this, but be aware when adjusting limits manually.

5. **Gemini Batch API files are key-scoped.** Must use the same API key for file upload AND job creation. A different key cannot see the uploaded file.

6. **Stale Vercel connection pools after DB recovery.** After any MongoDB outage or failover, redeploy Vercel to reset connection pools.

---

## Batch API Failure History

| Date | Issue | Root Cause | Fix |
|------|-------|-----------|-----|
| Feb 18 | 17K pages got wrong translations | Batch results return in arbitrary order; code used array index to match | Match by `metadata.key` instead |
| Feb 19-20 | 553 orphan jobs in DB | DB records created before Gemini submission; submission failed silently | Atomic insert + submit |
| Feb 28 | File upload key mismatch | Uploaded with Key 1, created job with Key 0 (files are key-scoped) | Use same key for upload + create |
| Mar 17 | 700 inline jobs exceeded limit | Many small books -> >100 concurrent batch jobs | One job per book via file upload |

---

## How to Switch Back to Vercel

All pipeline code still exists in the codebase. To re-enable Vercel-based orchestration:

### Steps

1. Add crons back to `vercel.json`:
```json
{ "path": "/api/cron/post-import-pipeline", "schedule": "*/10 * * * *" },
{ "path": "/api/cron/process-batches", "schedule": "*/2 * * * *" },
{ "path": "/api/cron/submit-batch-ocr", "schedule": "*/10 * * * *" },
{ "path": "/api/cron/enrich-books", "schedule": "*/10 * * * *" }
```

2. Disable Hetzner crons (comment out in crontab on `46.224.122.120`)

3. Test that 300s timeout is sufficient -- the March 17 bounded-query optimizations (50 books/cycle) should keep cycles under 300s

4. Cost impact: +$195/month on Vercel plan

### Key Files

| File | Purpose |
|------|---------|
| `vercel.json` | Cron schedule |
| `src/app/api/cron/post-import-pipeline/route.ts` | Main orchestrator |
| `src/app/api/cron/process-batches/route.ts` | Batch collector |
| `src/app/api/cron/submit-batch-ocr/route.ts` | OCR submission |
| `src/app/api/cron/enrich-books/route.ts` | Enrichment |
| `src/lib/sqs-client.ts` | SQS queue config |
| `src/lib/queue-utils.ts` | Job enqueueing |
| `src/lib/gemini-batch.ts` | Batch API client |

---

## Observability

### MongoDB Collections for Monitoring

| Collection | Purpose |
|------------|---------|
| `cron_runs` | Execution logs per cron (duration, status, actions, errors) |
| `gemini_usage` | Every AI call (4.22M records), indexed by type/status/book_id/timestamp |
| `jobs` | Lambda job tracking |
| `batch_jobs` | Gemini Batch API job tracking |
| `page_revisions` | Full OCR/translation history per page |
| `audit_log` | Admin actions |

### Key API Routes

| Route | Purpose |
|-------|---------|
| `GET /api/books/{id}/history` | Chronological timeline (6 data sources) |
| `GET /api/admin/adaptive-limits` | Current limits + health |
| `POST /api/admin/emergency-stop` | Pause/resume processing |
| `GET /api/admin/processing-dashboard` | Metrics overview |

---

## Hetzner Server Setup (Disaster Recovery)

If the Hetzner server needs to be recreated from scratch:

1. **Provision:** cax31 (ARM, 8 vCPU, 16GB RAM) -- cheap, plenty for orchestration
2. **Clone repo:** `git clone <repo-url> /root/sourcelibrary`
3. **Install runtime:** Node.js 24, then `npm install`
4. **Environment:** Copy `.env.production.local` from Vercel or local machine
5. **Set up crontab:** Use entries from the [Hetzner Cron Schedule](#hetzner-cron-schedule) table above
6. **Create lock directory:** `mkdir -p /root/sourcelibrary/locks`
7. **Test:** Run `pipeline-orchestrator.mjs --phase 0` manually
8. **Verify:** Check `cron_runs` collection for successful entries

**WARNING:** There may be local patches on the current server that are not in git. SSH in and check for uncommitted changes before rebuilding from scratch.
