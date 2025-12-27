# Batch Processing with Gemini Batch API

All batch OCR and translation jobs use Google's Gemini Batch API for **50% cost savings**. Results are typically ready within 2-24 hours.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Job Types                               │
├─────────────────────────────────────────────────────────────┤
│  Single Page (realtime)     │  Batch Jobs (async)           │
│  - /api/process/ocr         │  - batch_ocr                  │
│  - /api/process/translate   │  - batch_translate            │
│  - gemini-3-flash-preview   │  - gemini-2.5-flash           │
│  - Full price               │  - 50% off via Batch API      │
└─────────────────────────────────────────────────────────────┘
```

## How Batch Jobs Work

### Phase 1: Prepare (incremental)
Each `/process` call prepares 20 pages:
- Fetches images from URLs
- Encodes to base64
- Stores in `batch_preparations` collection

### Phase 2: Submit
When all pages prepared:
- Builds batch request array
- Submits to Gemini Batch API
- Stores `gemini_batch_job` reference

### Phase 3: Poll
Subsequent `/process` calls:
- Check Gemini job status
- When `JOB_STATE_SUCCEEDED`: download results, save to pages
- Mark job complete

## API Endpoints

### Create Job
```bash
POST /api/jobs
{
  "type": "batch_ocr",           # or "batch_translate"
  "book_id": "BOOK_ID",
  "book_title": "Book Title",
  "language": "Latin",
  "page_ids": ["page1", "page2", ...]
}
```

Response includes `use_batch_api: true` automatically for batch jobs.

### Process Job (call repeatedly)
```bash
POST /api/jobs/{id}/process
```

Responses by phase:
```json
// Phase 1: Preparing
{
  "phase": "preparing",
  "prepared": 40,
  "remaining": 92,
  "continue": true
}

// Phase 2: Submitted
{
  "phase": "submitted",
  "gemini_job": "batches/abc123...",
  "pages_submitted": 132
}

// Phase 3: Polling
{
  "gemini_state": "JOB_STATE_RUNNING",
  "done": false
}

// Complete
{
  "done": true,
  "message": "Batch job completed: 132 succeeded, 0 failed"
}
```

## Automating All Books

### Script: Process All Pending Work

```bash
#!/bin/bash
# process-all-batches.sh
# Processes all books that need OCR or translation via Batch API

BASE_URL="https://sourcelibrary.io"
SLEEP_BETWEEN_JOBS=2
SLEEP_BETWEEN_PROCESS=1

# Get all books
echo "Fetching books..."
BOOKS=$(curl -s "$BASE_URL/api/books" | jq -c '.[]')

for BOOK in $BOOKS; do
  BOOK_ID=$(echo "$BOOK" | jq -r '.id')
  TITLE=$(echo "$BOOK" | jq -r '.title' | head -c 40)

  echo ""
  echo "=== $TITLE ==="

  # Get pages needing OCR
  OCR_IDS=$(curl -s "$BASE_URL/api/books/$BOOK_ID" | \
    jq '[.pages[] | select((.ocr.data // "") | length == 0) | .id]')
  OCR_COUNT=$(echo "$OCR_IDS" | jq 'length')

  if [ "$OCR_COUNT" -gt 0 ]; then
    echo "Creating OCR job for $OCR_COUNT pages..."

    JOB_ID=$(curl -s -X POST "$BASE_URL/api/jobs" \
      -H "Content-Type: application/json" \
      -d "{
        \"type\": \"batch_ocr\",
        \"book_id\": \"$BOOK_ID\",
        \"book_title\": \"$TITLE\",
        \"language\": \"Latin\",
        \"page_ids\": $OCR_IDS
      }" | jq -r '.job.id')

    if [ "$JOB_ID" != "null" ]; then
      echo "Job $JOB_ID created. Processing..."

      # Process until submitted
      while true; do
        RESULT=$(curl -s -X POST "$BASE_URL/api/jobs/$JOB_ID/process")
        PHASE=$(echo "$RESULT" | jq -r '.phase // .gemini_state // "unknown"')

        if [ "$PHASE" = "submitted" ]; then
          echo "Submitted to Gemini Batch API"
          break
        elif [ "$PHASE" = "preparing" ]; then
          PREPARED=$(echo "$RESULT" | jq -r '.prepared')
          REMAINING=$(echo "$RESULT" | jq -r '.remaining')
          echo "Preparing: $PREPARED done, $REMAINING remaining"
        else
          echo "Phase: $PHASE"
          break
        fi

        sleep $SLEEP_BETWEEN_PROCESS
      done
    fi
  fi

  # Get pages needing translation (have OCR, no translation)
  TRANS_IDS=$(curl -s "$BASE_URL/api/books/$BOOK_ID" | \
    jq '[.pages[] | select((.ocr.data // "") | length > 0) | select((.translation.data // "") | length == 0) | .id]')
  TRANS_COUNT=$(echo "$TRANS_IDS" | jq 'length')

  if [ "$TRANS_COUNT" -gt 0 ]; then
    echo "Creating translation job for $TRANS_COUNT pages..."

    JOB_ID=$(curl -s -X POST "$BASE_URL/api/jobs" \
      -H "Content-Type: application/json" \
      -d "{
        \"type\": \"batch_translate\",
        \"book_id\": \"$BOOK_ID\",
        \"book_title\": \"$TITLE\",
        \"language\": \"Latin\",
        \"page_ids\": $TRANS_IDS
      }" | jq -r '.job.id')

    if [ "$JOB_ID" != "null" ]; then
      echo "Job $JOB_ID created. Processing..."

      while true; do
        RESULT=$(curl -s -X POST "$BASE_URL/api/jobs/$JOB_ID/process")
        PHASE=$(echo "$RESULT" | jq -r '.phase // .gemini_state // "unknown"')

        if [ "$PHASE" = "submitted" ]; then
          echo "Submitted to Gemini Batch API"
          break
        elif [ "$PHASE" = "preparing" ]; then
          PREPARED=$(echo "$RESULT" | jq -r '.prepared')
          REMAINING=$(echo "$RESULT" | jq -r '.remaining')
          echo "Preparing: $PREPARED done, $REMAINING remaining"
        else
          echo "Phase: $PHASE"
          break
        fi

        sleep $SLEEP_BETWEEN_PROCESS
      done
    fi
  fi

  sleep $SLEEP_BETWEEN_JOBS
done

echo ""
echo "All jobs submitted. Check status with:"
echo "curl $BASE_URL/api/jobs?status=processing"
```

### Script: Check and Complete Pending Jobs

```bash
#!/bin/bash
# complete-batch-jobs.sh
# Polls pending batch jobs and downloads results when ready

BASE_URL="https://sourcelibrary.io"

echo "Checking pending batch jobs..."

JOBS=$(curl -s "$BASE_URL/api/jobs?status=processing" | \
  jq -c '.jobs[] | select(.gemini_batch_job != null)')

for JOB in $JOBS; do
  JOB_ID=$(echo "$JOB" | jq -r '.id')
  TITLE=$(echo "$JOB" | jq -r '.book_title' | head -c 30)
  GEMINI_JOB=$(echo "$JOB" | jq -r '.gemini_batch_job')

  echo ""
  echo "=== $TITLE ($JOB_ID) ==="
  echo "Gemini: $GEMINI_JOB"

  RESULT=$(curl -s -X POST "$BASE_URL/api/jobs/$JOB_ID/process")
  STATE=$(echo "$RESULT" | jq -r '.gemini_state // "unknown"')
  DONE=$(echo "$RESULT" | jq -r '.done')

  if [ "$DONE" = "true" ]; then
    echo "COMPLETED!"
  else
    echo "State: $STATE"
  fi
done
```

### Cron Setup (Optional)

Add to crontab for automatic processing:

```bash
# Process new work every 6 hours
0 */6 * * * /path/to/process-all-batches.sh >> /var/log/batch-process.log 2>&1

# Check for completed jobs every hour
0 * * * * /path/to/complete-batch-jobs.sh >> /var/log/batch-complete.log 2>&1
```

## Monitoring

### List All Jobs
```bash
curl "https://sourcelibrary.io/api/jobs" | jq '.jobs[] | {id, type, status, book_title, progress}'
```

### Check Specific Job
```bash
curl "https://sourcelibrary.io/api/jobs/JOB_ID" | jq '.job'
```

### List Gemini Batch Jobs
```bash
curl "https://sourcelibrary.io/api/batch-jobs" | jq '.jobs'
```

## Database Collections

### `jobs`
Standard job tracking with additional fields:
- `use_batch_api`: boolean - true for batch_ocr/batch_translate
- `gemini_batch_job`: string - Gemini batch job name
- `gemini_state`: string - JOB_STATE_PENDING/RUNNING/SUCCEEDED/FAILED
- `batch_phase`: string - preparing/submitted/completed

### `batch_preparations`
Temporary storage for prepared requests:
- `job_id`: string - Reference to job
- `page_id`: string - Page being prepared
- `request`: object - Gemini request payload (with base64 image)
- `failed`: boolean
- `error`: string (if failed)

Cleaned up after job completion.

## Cost Comparison

| Operation | Realtime API | Batch API | Savings |
|-----------|--------------|-----------|---------|
| OCR (per 1000 pages) | ~$5.00 | ~$2.50 | 50% |
| Translation (per 1000 pages) | ~$3.00 | ~$1.50 | 50% |

## Troubleshooting

### Job Stuck in "preparing"
Check `batch_preparations` collection for errors:
```javascript
db.batch_preparations.find({ job_id: "JOB_ID", failed: true })
```

### Gemini Job Failed
Check error in job document:
```javascript
db.jobs.findOne({ id: "JOB_ID" }, { error: 1, gemini_state: 1 })
```

### Reset Job
Delete preparations and retry:
```javascript
db.batch_preparations.deleteMany({ job_id: "JOB_ID" })
db.jobs.updateOne({ id: "JOB_ID" }, {
  $unset: { gemini_batch_job: "", gemini_state: "", batch_phase: "" },
  $set: { status: "pending" }
})
```

## Files

- `/src/lib/gemini-batch.ts` - Gemini Batch API client
- `/src/app/api/jobs/[id]/process/route.ts` - Phased batch processing
- `/src/app/api/batch-jobs/route.ts` - Direct batch job management
- `/src/lib/types.ts` - DEFAULT_MODEL / DEFAULT_BATCH_MODEL constants
