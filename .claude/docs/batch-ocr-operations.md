# Batch OCR Operations Guide

## Overview

Batch OCR uses the Gemini Batch API to transcribe book page images at 50% lower cost than realtime API calls. The pipeline runs on Hetzner, not Vercel.

**Key files:**
- `scripts/workers/pipeline-orchestrator.mjs` — submits OCR jobs (Phase 2) and checks completion (Phase 3)
- `scripts/workers/batch-collector.mjs` — collects results from Gemini and saves to MongoDB
- Both run on Hetzner via crontab (every 10 minutes)

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

## Architecture Debt

1. **Orchestrator not fully in git** — The Hetzner `pipeline-orchestrator.mjs` has local patches that diverge from the repo. As of 2026-03-21, the key rotation and file cleanup patches are committed in `fix/batch-ocr-file-quota`.

2. **No automated alerting** — If batch OCR throughput drops to zero, nobody is notified. A simple check: "did any pages get OCR'd in the last 24h?" would catch most failures.

3. **No Gemini File API storage monitoring** — The 20GB quota should be tracked. A daily check for >10GB usage would give early warning.

4. **Error-only logging** — The orchestrator's `log.errors` array is written to `cron_runs` at end of run, but if the process crashes or hangs, errors are lost. Console.log is now the primary error channel.
