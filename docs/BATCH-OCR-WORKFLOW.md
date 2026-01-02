# Batch OCR/Translation Workflow

## Overview

Source Library uses Google's Gemini Batch API for OCR and translation, which provides 50% cost savings over real-time API calls. However, batch results **expire after 2 days**, so a cron job must regularly download and save results.

## Key Constraint: 2-Day Result Expiration

**CRITICAL**: Gemini Batch API results expire after 48 hours. If results aren't downloaded within this window, they're lost and jobs must be resubmitted.

## Scripts

| Script | Purpose |
|--------|---------|
| `submit-all-ocr.mjs` | Submit OCR batch jobs for books without OCR |
| `sync-batch-status.mjs` | Poll Gemini for job status updates, mark expired jobs |
| `save-batch-results.mjs` | Download and save results from completed jobs |
| `cleanup-batch-jobs.mjs` | Delete orphan and expired job records |
| `cron-batch-processor.mjs` | **Combined cron job**: sync + save + mark expired |

## Recommended Workflow

### 1. Submit Jobs

```bash
node scripts/submit-all-ocr.mjs
```

This will:
- Find books needing OCR
- Create JSONL batch files with base64 images
- Upload to Gemini File API
- Create batch jobs
- **Delete uploaded files immediately** (they count against 20GB quota)
- Save job records to `batch_jobs` collection

### 2. Set Up Cron Job

Run the batch processor every 6 hours to stay well within the 2-day window:

```bash
# Add to crontab
0 */6 * * * cd /path/to/sourcelibrary-v2 && node scripts/cron-batch-processor.mjs >> logs/batch-cron.log 2>&1
```

Or use a service like Vercel Cron, GitHub Actions, or Railway.

### 3. Monitor Progress

```bash
# Check job status breakdown
curl https://www.sourcelibrary.org/api/batch-jobs | jq '.jobs | group_by(.status) | map({status: .[0].status, count: length})'

# Check OCR progress
curl https://www.sourcelibrary.org/api/admin/blob-stats | jq '.processing'
```

## Job States

| State | Meaning |
|-------|---------|
| `pending` | Job created locally, not yet submitted to Gemini |
| `processing` | Gemini is processing the batch |
| `completed` | Gemini finished, results available |
| `saved` | Results downloaded and saved to pages |
| `expired` | Results expired (404 from Gemini) |
| `failed` | Job failed at Gemini |

## Troubleshooting

### Jobs Show "Succeeded" But Return 404

This happens when results expired before being saved. Run:

```bash
# Mark expired jobs
node scripts/sync-batch-status.mjs

# Clean up expired records
node scripts/cleanup-batch-jobs.mjs

# Resubmit
node scripts/submit-all-ocr.mjs
```

### Gemini File Storage Quota

Gemini has a 20GB file storage limit. The submit script deletes files immediately after job creation, but if you hit quota errors:

1. List files: `GET https://generativelanguage.googleapis.com/v1beta/files`
2. Delete old files manually

### Image Optimization

Images are resized before submission to reduce file sizes:
- Max width: 800px
- JPEG quality: 85%
- Result: ~78% smaller files with identical OCR quality

## Cost Estimates

| Operation | Real-time Cost | Batch Cost (50% off) |
|-----------|---------------|---------------------|
| OCR (per 1000 pages) | ~$5.00 | ~$2.50 |
| Translation (per 1000 pages) | ~$3.00 | ~$1.50 |

## Research Findings

From `docs/research/ocr-batch-size-experiment.md`:

- **Batch size 5** is optimal (4.4x fewer API calls, no quality loss)
- **Never exceed batch size 10** for OCR
- **Two-pass pipeline** (OCR → Translate separately) beats single-pass 85% of the time
- Elaborate prompts hurt quality at large batch sizes

## Database Collections

### `batch_jobs`
```javascript
{
  id: string,
  gemini_job_name: string,  // e.g., "batches/abc123"
  type: 'ocr' | 'translate',
  book_id: string,
  book_title: string,
  model: string,
  language: string,
  status: string,
  gemini_state: string,
  page_ids: string[],
  total_pages: number,
  completed_pages: number,
  failed_pages: number,
  created_at: Date,
  updated_at: Date,
  completed_at: Date,
}
```

## Vercel Cron Alternative

Add to `vercel.json`:

```json
{
  "crons": [{
    "path": "/api/cron/batch-processor",
    "schedule": "0 */6 * * *"
  }]
}
```

Create `/api/cron/batch-processor/route.ts` that calls the same logic as the script.

## Gemini API Response Formats

Gemini Batch API returns results in multiple formats. The scripts handle all of these:

### 1. File-based (responsesFile) - Most common
```javascript
job.metadata.output.responsesFile  // e.g., "files/batch-abc123"
// Download via: GET /download/v1beta/{fileName}:download?alt=media&key=...
```

### 2. Legacy file-based (destFile)
```javascript
job.metadata.destFile
```

### 3. Inline responses (double nested)
```javascript
job.metadata.output.inlinedResponses.inlinedResponses
```

### 4. Inline responses (single nested)
```javascript
job.response.inlinedResponses
```

## Other API Notes

- `application/jsonl` MIME type has a bug - use `text/plain` as workaround
- State naming varies: `BATCH_STATE_*` vs `JOB_STATE_*` - code handles both
- **Results expire after 2 days** - download promptly!
