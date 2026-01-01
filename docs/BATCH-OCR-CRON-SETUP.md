# Batch OCR Cron Setup Guide

This document explains how to use the Vercel serverless functions for batch OCR submission and monitoring.

## Overview

Two serverless functions automate the entire batch OCR pipeline:

1. **Submit OCR** (`/api/cron/submit-ocr`) - Creates batch jobs for all pages needing OCR
2. **Batch Processor** (`/api/cron/batch-processor`) - Monitors progress and saves results

## Configuration

The cron schedule is configured in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/submit-ocr",
      "schedule": "0 0 * * *"        // Daily at midnight UTC
    },
    {
      "path": "/api/cron/batch-processor",
      "schedule": "0 */6 * * *"      // Every 6 hours (CRITICAL!)
    }
  ]
}
```

## Environment Variables Required

Set these in your Vercel project settings:

```
GEMINI_API_KEY=your-api-key-here
MONGODB_URI=mongodb+srv://...
```

## Function Details

### Submit OCR (`/api/cron/submit-ocr`)

**Runs**: Daily at midnight (or manually via curl)

**Does**:
1. Finds all pages with empty OCR data
2. Groups pages by book
3. Resizes images (800px max width for 78% size reduction)
4. Creates JSONL batch files (25 pages each)
5. Uploads to Gemini File API
6. Submits batch jobs
7. Saves job records to MongoDB

**Response**:
```json
{
  "success": true,
  "message": "Submitted 25 batch jobs",
  "pagesNeedingOcr": 625,
  "batchJobs": [
    {
      "batchNumber": 1,
      "pages": 25,
      "jobName": "batches/abc123..."
    }
  ],
  "estimatedCost": "$1.56",
  "nextStep": "Set up cron job to monitor results every 6 hours"
}
```

**Manual Trigger**:
```bash
curl -X POST https://your-domain.com/api/cron/submit-ocr
```

### Batch Processor (`/api/cron/batch-processor`)

**Runs**: Every 6 hours (CRITICAL - Gemini results expire after 48h)

**Does**:
1. Checks status of all active batch jobs from Gemini
2. Downloads results from completed jobs
3. Saves OCR text to MongoDB pages collection
4. Marks expired jobs (48h+ old)
5. Retries failed jobs

**Response**:
```json
{
  "success": true,
  "message": "Batch processor completed",
  "stats": {
    "synced": 5,
    "expired": 0,
    "saved": 125,
    "failed": 0,
    "pagesProcessed": 125
  },
  "nextStep": "Check back in 6 hours"
}
```

**Manual Trigger**:
```bash
curl -X POST https://your-domain.com/api/cron/batch-processor
```

## Timeline for 630 Pages

| Phase | Time | Action |
|-------|------|--------|
| T+0h | Now | Submit OCR batch jobs |
| T+24h | Tomorrow | Gemini processing complete |
| T+24.5h | Next cron run | Batch processor downloads first results |
| T+48h | 2 days | All results downloaded (before 48h expiry) |

**Critical**: Batch processor must run at least once every 48 hours, or results are lost.

## Monitoring

### Check Job Status

```bash
# Via API
curl https://your-domain.com/api/batch-jobs | jq '.jobs | group_by(.status) | map({status: .[0].status, count: length})'

# Via MongoDB
db.batch_jobs.aggregate([
  { $group: { _id: "$status", count: { $sum: 1 } } }
])
```

### View Logs

In Vercel dashboard:
- Functions → Cron
- Filter by `/api/cron/submit-ocr` or `/api/cron/batch-processor`
- View logs for each execution

## Troubleshooting

### "No pages need OCR"

All pages already have OCR. Queue translation jobs instead:

```bash
curl -X POST https://your-domain.com/api/cron/submit-translation
```

### "Batch processor failed: 404"

Results expired (older than 48 hours). This means the batch processor didn't run frequently enough.

**Fix**:
1. Check cron schedule in vercel.json (should be `0 */6 * * *`)
2. Resubmit failed jobs: `curl -X POST https://your-domain.com/api/cron/submit-ocr`
3. Monitor more carefully next time

### "GEMINI_API_KEY not set"

Environment variable missing in Vercel settings.

**Fix**:
1. Get API key from Google AI Studio (https://aistudio.google.com/app/apikey)
2. In Vercel: Project Settings → Environment Variables
3. Add `GEMINI_API_KEY` with your key
4. Redeploy

## Cost Tracking

Each batch job costs:
- **OCR**: ~$2.50 per 1,000 pages (batch pricing, 50% discount)

For 630 pages:
- **Total cost**: ~$1.56

All pricing is in USD using Gemini batch API.

## Advanced Configuration

### Change Submission Schedule

Edit `vercel.json`:
```json
{
  "path": "/api/cron/submit-ocr",
  "schedule": "0 6 * * *"  // 6 AM UTC instead of midnight
}
```

Cron syntax: `minute hour day month weekday` (standard crontab format)

### Change Monitoring Frequency

For faster completion (but more API calls):
```json
{
  "path": "/api/cron/batch-processor",
  "schedule": "0 */4 * * *"  // Every 4 hours instead of 6
}
```

⚠️ **Warning**: Must run at least every 48 hours to catch results before expiry.

## Database Schema

### batch_jobs Collection

```javascript
{
  _id: ObjectId,
  gemini_job_name: "batches/abc123...",
  type: "ocr" | "translate",
  status: "processing" | "completed" | "saved" | "expired",
  gemini_state: "PROCESSING" | "SUCCEEDED" | "FAILED",
  total_pages: 25,
  completed_pages: 25,
  failed_pages: 0,
  created_at: Date,
  updated_at: Date,
}
```

## Success Indicators

✓ **All going well if**:
- `submit-ocr` creates new batch jobs daily
- `batch-processor` downloads results every 6 hours
- Status progresses: processing → completed → saved
- No jobs show "expired" status
- Pages collection gets updated with OCR data

⚠️ **Warning signs**:
- Jobs stuck in "processing" for >48 hours
- Status shows "expired"
- Batch processor returns "failed"
- GEMINI_API_KEY error in logs

## Next Steps

1. ✅ Deploy these functions (done)
2. ✅ Set environment variables in Vercel
3. ✅ Add cron schedule to vercel.json (done)
4. 📌 Deploy: `git push origin main`
5. 🔍 Monitor for first 48 hours
6. ✨ After OCR complete: Queue translation pipeline

---

**Questions?** Check the main [BATCH-OCR-WORKFLOW.md](./BATCH-OCR-WORKFLOW.md) for detailed background on the batch OCR system.
