# Handoff: Re-OCR + Re-Translate All Books (Feb 18, 2026)

## What Happened

Submitted ~2,150 Gemini Batch API jobs to re-OCR the most-read books with `gemini-3-flash-preview`. Collected 74,409 pages successfully. Fixed 3 bugs in the bulk-reocr route and rewrote the shell script.

### Bugs Fixed (committed + deployed)
1. **Parent batch_job created before children** — caused orphan parents when image downloads failed. Now created AFTER children succeed.
2. **Failed books counted as submitted** — `booksExamined` counter was wrong. Fixed.
3. **nextOffset used `submitted.length`** — should use `booksExamined` for correct pagination.
4. **Positional matching in process-batches cron** — Gemini Batch API doesn't echo `metadata.key` in responses. Fixed both cron and collection script to match results by array index using `job.page_ids[idx]`.

### Cleanup Done
- 2,129 stale "processing" batch_jobs → marked `completed` (results already collected)
- 176 "saved" batch_jobs → marked `completed`
- 1 empty parent deleted, 6 stale `book.job` refs cleared

## Current State

### Scope (from CSV — `reprocessing-needed.csv` in repo root)
| Category | Books | Pages | Est. Cost (batch) |
|----------|-------|-------|--------------------|
| Need re-OCR | 316 | 76,718 | $60.61 |
| Need re-translation | 372 | 109,648 | $86.62 |
| **Total** | — | — | **$147.23** |

- 316 books need both re-OCR AND re-translation
- ~56 additional books were already re-OCR'd (Feb 18 batch) but need re-translation (stale translations from old OCR text)
- Old models: `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini`, `mistral`

### What's Done
- ~74k pages re-OCR'd to `gemini-3-flash-preview` in the Feb 18 batch
- All batch_jobs cleaned up (no stale records)
- GitHub issue #17: https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/17

### What's Blocked
- **118 Gemini batch jobs stuck** in `BATCH_STATE_PENDING` after 18+ hours — likely quota-related
- **Gemini quota exhausted** (429 RESOURCE_EXHAUSTED) — need to wait for reset (~midnight Pacific)
- Remaining ~76k pages of re-OCR can't proceed until quota resets

## Next Steps

### 1. Check pending Gemini jobs
```bash
# Are the 118 pending jobs still stuck?
secret-lover run -- node -e "
const { MongoClient } = require('mongodb');
const c = new MongoClient(process.env.MONGODB_URI);
c.connect().then(async () => {
  const db = c.db('bookstore');
  const pending = await db.collection('batch_jobs').find({ status: 'pending' }).toArray();
  console.log('Pending:', pending.length);
  c.close();
});
"
```

### 2. Resume bulk re-OCR
```bash
secret-lover run -- bash scripts/run-bulk-reocr.sh
# Or with offset if partially done:
secret-lover run -- bash scripts/run-bulk-reocr.sh --offset=27
```

### 3. Re-translate after OCR completes
After all re-OCR finishes, trigger batch translation for the 372 books with stale translations. The `batch-translate-async` route handles this per-book. Could write a similar bulk script, or set `pipeline_auto.status: 'ocr_complete'` on each book to let the pipeline cron handle it.

### 4. Regenerate summaries + indexes
After translation completes, regenerate `reading_summary` and `index` for each affected book.

## Key Files
- `src/app/api/admin/bulk-reocr/route.ts` — fixed bulk re-OCR endpoint
- `scripts/run-bulk-reocr.sh` — rewritten shell orchestrator
- `scripts/generate-reprocessing-csv.mjs` — CSV generation script
- `reprocessing-needed.csv` — current state of all books needing work

## Lessons Learned
- **Create-after-success pattern**: Don't create parent records before children succeed
- **Gemini Batch API quota**: ~25k requests/day. 2,150 jobs × ~10 pages each ≈ 21,500 requests
- **No `metadata.key` in responses**: Gemini Batch API returns results in same order as submitted, but doesn't echo the `metadata.key` field. Use positional matching.
- **Commit before running against prod**: Always commit fixes before testing against production data
- **Collection scripts must update job status**: The process-batches cron had a bug where it saved page results but didn't transition job status
