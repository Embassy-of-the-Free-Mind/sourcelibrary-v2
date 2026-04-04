# Batch OCR Operations Guide

## Overview

Batch OCR uses the Gemini Batch API to transcribe book page images at 50% lower cost than realtime API calls. The pipeline runs on Hetzner, not Vercel.

**Model routing (since 2026-03-27):** BPH books use `gemini-3-flash-preview`, all others use `gemini-3.1-flash-lite-preview` (additional 50% savings). Routing via `getModelForBook()` in `src/lib/types/ai-models.ts`.

**Key files:**
- `scripts/workers/pipeline-orchestrator.mjs` — submits OCR jobs (Phase 2) and checks completion (Phase 3)
- `scripts/workers/batch-collector.mjs` — collects results from Gemini and saves to MongoDB
- Both managed by unified scheduler (`scripts/workers/scheduler.mjs`)

## How It Works

```
Phase 2: Submit                    Gemini Cloud                  Collector
─────────────────                  ────────────                  ─────────
1. Find books at                   4. Gemini processes           7. Query batch_jobs
   archive_complete                   batch (30min-24h)             for pending jobs
2. Download images                                               8. Fetch results from
   from Internet Archive           5. Results available              Gemini API
3. Build JSONL, upload                via batch status            9. Parse OCR text,
   to File API, create             6. Files auto-expire             save to pages
   batch job                          after 48h                  10. Update book status
                                                                     to ocr_complete
```

## The Three Quotas That Can Break It

### 1. File Storage Quota (20GB per project)
- **What:** Each JSONL upload (50-400MB) consumes storage until deleted
- **Symptom:** 429 on file upload, but errors were invisible in logs before the fix
- **Fix:** Files are now deleted immediately after batch job creation. Collector sweeps stale files (>1h) as safety net
- **Monitor:** `GET /v1beta/files?key=KEY` — should show 0-5 files, never 100+

### 2. Batch Job Quota (100 concurrent per project)
- **What:** Max 100 active batch jobs per API key project
- **Symptom:** Jobs stuck at PENDING indefinitely
- **Fix:** Orchestrator has backpressure check (500 limit in code, but real limit is 100)
- **Monitor:** Check `batch_jobs` collection for jobs in `pending`/`processing` status

### 3. Rate Limits (requests per minute)
- **What:** Per-key rate limits on batch creation and file upload
- **Symptom:** 429 errors with retry-after header
- **Fix:** Key rotation across GEMINI_API_KEY_2, TIER3, and primary

## API Key Architecture

The orchestrator uses keys in this priority order:
```
Index 0: GEMINI_API_KEY_2     — preferred for batch (separate quota pool)
Index 1: GEMINI_API_KEY_TIER3 — fallback (higher tier, reliable File API)
Index 2: GEMINI_API_KEY       — last resort
```

**CRITICAL RULE:** The same key must be used for:
1. Uploading the JSONL file to the File API
2. Creating the batch job that references that file
3. Deleting the file after batch creation
4. Checking the batch job status (collector)

Files and batch jobs are scoped to the API key's Google Cloud project. Using a different key returns 404.

**Known issue (2026-03-20):** `GEMINI_API_KEY_2` has a permanently broken File API quota — returns 429 even with 0 files. The orchestrator now automatically falls through to TIER3.

## Monitoring & Diagnosis

### Quick health check
```bash
# On Hetzner — recent collector output
tail -5 /var/log/sourcelibrary/collector.log

# Should show "Collected: N (M pages)" not "Found 0 jobs"
```

### Check Gemini batch states
```bash
# From any machine with .env.production.local
set -a; source .env.production.local; set +a
node -e "
const keys = [process.env.GEMINI_API_KEY_TIER3, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY].filter(Boolean);
(async () => {
  for (let i = 0; i < keys.length; i++) {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/batches?pageSize=5&key=' + keys[i]);
    const data = await res.json();
    const ops = data.operations || [];
    console.log('Key', i, ':', ops.length, 'batches');
    for (const op of ops) {
      const m = op.metadata;
      console.log(' ', m.state, m.createTime?.substring(0,16), 'reqs:', m.batchStats?.requestCount);
    }
  }
})();
"
```

### Check file storage usage
```bash
node -e "
const key = process.env.GEMINI_API_KEY_TIER3;
(async () => {
  let total = 0, bytes = 0, pageToken = null;
  do {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/files');
    url.searchParams.set('key', key);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url);
    const data = await res.json();
    total += (data.files || []).length;
    for (const f of (data.files || [])) bytes += parseInt(f.sizeBytes || 0);
    pageToken = data.nextPageToken;
  } while (pageToken);
  console.log(total, 'files,', (bytes/1024/1024/1024).toFixed(2), 'GB / 20 GB');
})();
"
```

### Check pipeline throughput
```bash
# Pages OCR'd in last 24h
node -e "
const { MongoClient } = require('mongodb');
(async () => {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');
  const yesterday = new Date(Date.now() - 24*60*60*1000);
  const count = await db.collection('pages').countDocuments({ 'ocr.completed_at': { \$gte: yesterday } });
  console.log('Pages OCR\\'d last 24h:', count);
  await client.close();
})();
"
```

## Emergency: Clear File Storage
If the 20GB quota fills up:
```bash
node -e "
const key = process.env.GEMINI_API_KEY_TIER3;
(async () => {
  let deleted = 0, pageToken = null;
  do {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/files');
    url.searchParams.set('key', key);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url);
    const data = await res.json();
    for (const f of (data.files || [])) {
      await fetch('https://generativelanguage.googleapis.com/v1beta/' + f.name + '?key=' + key, { method: 'DELETE' });
      deleted++;
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  console.log('Deleted', deleted, 'files');
})();
"
```

## Emergency: Pause/Resume OCR Submission
```bash
# On Hetzner — disable Phase 2 cron
ssh root@46.224.122.120
crontab -e  # Comment out the --phase 2 line

# Re-enable
crontab -e  # Uncomment the --phase 2 line
```

## Log Files (Hetzner)

| Log | Content |
|-----|---------|
| `/var/log/sourcelibrary/ocr-submit.log` | Phase 2: image downloads, JSONL building, uploads, errors |
| `/var/log/sourcelibrary/collector.log` | Batch result collection: pages saved, status transitions |
| `/var/log/sourcelibrary/pipeline.log` | Main orchestrator (all phases) |

### What to look for in logs

**Healthy submission:**
```
Submitting OCR: Book Title...
  Downloading 300 images...
  Downloaded 300/300 images
  Building JSONL for 150 pages (file-based)...
  JSONL size: 85.3 MB for 150 pages
  Uploaded file: files/abc123 (key 1)
OCR submitted: Book Title — 300 pages in 2 batches
```

**File quota exhausted:**
```
ERROR OCR submit 69abc123: File upload start failed: {"error":{"code":429,"message":"...file_storage_bytes..."}}
```

**All keys exhausted:**
```
Upload key 0 quota exhausted, trying next...
Upload key 1 quota exhausted, trying next...
Upload key 2 quota exhausted, trying next...
ERROR OCR submit 69abc123: ALL_KEYS_QUOTA_EXHAUSTED
```

**Cross-key 404 (file uploaded with wrong key):**
```
Uploaded file: files/abc123 (key 1)
Key 0 failed for file batch (404): {"error":{"message":"Requested entity was not found."}}
```

## Failure History

| Date | Failure | Root Cause | Fix |
|------|---------|------------|-----|
| 2026-02-18 | Result scrambling | Positional index instead of metadata.key | Use metadata.key matching |
| 2026-02-19 | API key visibility | Collector used wrong key | Multi-key collection |
| 2026-02-24 | Duplicate submissions | No guard for existing batch_jobs | Check before submit |
| 2026-03-17 | RECITATION blocks | Missing BLOCK_NONE safety settings | Added to all request configs |
| 2026-03-20 | Silent 3-day outage | 20GB file storage quota + invisible errors | File cleanup + error logging + key rotation |
| 2026-03-26 | 450 batches stuck PENDING | Batch job quota (100/key) saturated by stale jobs that never ran | Cancel stale via API, mark MongoDB failed, reset books to archive_complete |
| 2026-03-26 | Zombie jobs blocking orchestrator | 51 `processing` jobs with no Lambda worker; 34 books stuck at `translate_submitted` | Cancel zombies, reset books to `ocr_complete`; orchestrator counts pipeline status, not job records |
| 2026-03-26 | Adaptive limits locked | `locked: true` prevented auto-scaling despite healthy Atlas | Unlock + manual bump to translate_lambda_max:50, global_active_max:50 |

## Emergency: Clear Stale Batches

When batches are stuck at PENDING and not processing (check with the monitoring commands above):

```bash
# 1. Cancel all active Gemini batches across all keys
node -e "
const keys = [process.env.GEMINI_API_KEY_TIER3, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY].filter(Boolean);
(async () => {
  let cancelled = 0;
  for (const key of keys) {
    let pageToken = null;
    do {
      const url = new URL('https://generativelanguage.googleapis.com/v1beta/batches');
      url.searchParams.set('key', key); url.searchParams.set('pageSize', '100');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const res = await fetch(url); const data = await res.json();
      for (const b of (data.operations || [])) {
        const state = (b.metadata || b).state;
        if (state === 'BATCH_STATE_PENDING' || state === 'BATCH_STATE_RUNNING') {
          const r = await fetch('https://generativelanguage.googleapis.com/v1beta/' + b.name + ':cancel?key=' + key, { method: 'POST' });
          if (r.ok) cancelled++;
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
  }
  console.log('Cancelled:', cancelled);
})();
"

# 2. Mark MongoDB batch_jobs as failed
node -e "
const { MongoClient } = require('mongodb');
(async () => {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');
  const r = await db.collection('batch_jobs').updateMany(
    { status: { \$in: ['pending', 'processing'] } },
    { \$set: { status: 'failed', error: 'Cancelled: stale batch cleanup', updated_at: new Date() } }
  );
  console.log('Marked failed:', r.modifiedCount);
  await client.close();
})();
"

# 3. Reset stuck books so orchestrator can resubmit
node -e "
const { MongoClient } = require('mongodb');
(async () => {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');
  const r = await db.collection('books').updateMany(
    { 'pipeline_auto.status': 'ocr_submitted' },
    { \$set: { 'pipeline_auto.status': 'archive_complete', 'pipeline_auto.last_updated': new Date(), updated_at: new Date() } }
  );
  console.log('Reset to archive_complete:', r.modifiedCount);
  await client.close();
})();
"
```

## Emergency: Clear Zombie Translation Jobs

When the orchestrator shows "In-flight translations: N/30 — dispatching up to 0" but Lambda isn't actually processing:

```bash
# 1. Cancel zombie jobs (processing but no update in 2h)
node -e "
const { MongoClient } = require('mongodb');
(async () => {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');
  const stale = new Date(Date.now() - 2 * 3600000);
  const r = await db.collection('jobs').updateMany(
    { status: 'processing', updated_at: { \$lt: stale } },
    { \$set: { status: 'failed', error: 'Cancelled: zombie job', updated_at: new Date() } }
  );
  console.log('Zombies cancelled:', r.modifiedCount);

  // 2. Reset stuck translate_submitted books with no active job
  const stuck = await db.collection('books').find(
    { 'pipeline_auto.status': 'translate_submitted' },
    { projection: { id: 1 } }
  ).toArray();
  let reset = 0;
  for (const b of stuck) {
    const hasJob = await db.collection('jobs').countDocuments({ book_id: b.id, status: { \$in: ['processing', 'queued'] } });
    if (hasJob === 0) {
      await db.collection('books').updateOne({ id: b.id }, { \$set: { 'pipeline_auto.status': 'ocr_complete', updated_at: new Date() } });
      reset++;
    }
  }
  console.log('Books reset to ocr_complete:', reset);
  await client.close();
})();
"
```

## Architecture Debt

1. **Orchestrator not fully in git** — The Hetzner `pipeline-orchestrator.mjs` has local patches that diverge from the repo. As of 2026-03-21, the key rotation and file cleanup patches are committed in `fix/batch-ocr-file-quota`.

2. **No automated alerting** — If batch OCR throughput drops to zero, nobody is notified. A simple check: "did any pages get OCR'd in the last 24h?" would catch most failures.

3. **No Gemini File API storage monitoring** — The 20GB quota should be tracked. A daily check for >10GB usage would give early warning.

4. **Error-only logging** — The orchestrator's `log.errors` array is written to `cron_runs` at end of run, but if the process crashes or hangs, errors are lost. Console.log is now the primary error channel.
