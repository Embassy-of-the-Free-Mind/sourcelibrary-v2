---
name: progress
description: Check pipeline processing progress — translation backfills, OCR jobs, image extraction. Shows real page-level verification, not just job counters. Use when asked "how's it going?", "progress?", "status?", "now?", or any progress check.
---

# Pipeline Progress Check

Report on processing progress with **verified page-level data**. Job counters lie — always cross-reference against actual page records.

## Critical Diagnostic Rules

1. **Never trust job counters alone.** A job showing `status: 'processing'` with `progress.completed: 0` for hours is STUCK, not "in progress".
2. **Never attribute global throughput to a specific operation.** Translation throughput from `pages.translation.updated_at` includes ALL sources (pipeline cron, Lambda workers, backfill jobs). Filter by book IDs to attribute correctly.
3. **Spot-check actual pages.** For any "processing" job, check if its pages actually have `translation.data` or `ocr.data`. This is ground truth.
4. **Flag stale jobs explicitly.** Any job in `processing` for >2 hours with 0 progress is stuck. Say so clearly.

## What to Check

Run a single MongoDB script that reports ALL of the following. Use `set -a; source .env.production.local; set +a; node -e "..."` to run.

### 1. Pipeline Funnel (bird's eye)

```javascript
// Pipeline status distribution
const funnel = await db.collection('books').aggregate([
  { $match: { 'pipeline_auto.status': { $exists: true } } },
  { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]).toArray();
```

### 2. Fully Translated Books

```javascript
// Count books where pages_translated >= pages_count
const fullyTranslated = await db.collection('books').countDocuments({
  pages_count: { $gt: 0 },
  pages_translated: { $gt: 0 },
  $expr: { $gte: ['$pages_translated', '$pages_count'] }
});
```

Note: `pages_translated` is a cache refreshed every 6h by `sync-page-counts` cron. For exact count, query pages collection directly (slower).

### 3. Active Jobs by Type

```javascript
const activeJobs = await db.collection('jobs').aggregate([
  { $match: { status: { $in: ['pending', 'processing'] } } },
  { $group: {
    _id: { type: '$type', note: '$note' },
    count: { $sum: 1 },
    totalPages: { $sum: '$progress.total' },
    completedPages: { $sum: '$progress.completed' },
    failedPages: { $sum: '$progress.failed' },
    oldest: { $min: '$created_at' }
  }}
]).toArray();
```

### 4. Stuck Job Detection (CRITICAL)

```javascript
const twoHoursAgo = new Date(Date.now() - 2 * 3600000);
const stuckJobs = await db.collection('jobs').countDocuments({
  status: 'processing',
  'progress.completed': 0,
  created_at: { $lt: twoHoursAgo }
});
// If stuckJobs > 0, these are DEAD. Report them prominently.
```

### 5. Real Throughput (page-level verification)

```javascript
// Translation throughput - last 1h, 3h, 6h
for (const hours of [1, 3, 6]) {
  const since = new Date(Date.now() - hours * 3600000);
  const count = await db.collection('pages').countDocuments({
    'translation.updated_at': { $gte: since }
  });
  console.log(`Translations last ${hours}h: ${count} (${Math.round(count/hours)}/hr)`);
}

// OCR throughput
for (const hours of [1, 3, 6]) {
  const since = new Date(Date.now() - hours * 3600000);
  const count = await db.collection('pages').countDocuments({
    'ocr.updated_at': { $gte: since }
  });
  console.log(`OCR last ${hours}h: ${count} (${Math.round(count/hours)}/hr)`);
}
```

### 6. Backfill-Specific Progress (when applicable)

For any named backfill operation (identified by `note` field on jobs), verify progress against actual pages:

```javascript
// Get a sample of "processing" backfill jobs
const sampleJobs = await db.collection('jobs').find({
  note: 'near-complete backfill', // or whatever the current operation is
  status: 'processing'
}).limit(5).toArray();

// For each, verify pages actually got translated
for (const job of sampleJobs) {
  const bookPages = await db.collection('pages').countDocuments({
    book_id: job.book_id,
    'translation.data': { $exists: true, $ne: '' }
  });
  const totalPages = await db.collection('pages').countDocuments({ book_id: job.book_id });
  console.log(`${job.book_title?.substring(0,40)} — ${bookPages}/${totalPages} pages actually translated, job says ${job.progress.completed}/${job.progress.total}`);
}
```

### 7. ETA Calculation

```javascript
// Only use VERIFIED throughput (page-level, not job-level)
const oneHourAgo = new Date(Date.now() - 3600000);
const hourlyRate = await db.collection('pages').countDocuments({
  'translation.updated_at': { $gte: oneHourAgo }
});

// Remaining work
const remaining = activeJobs
  .filter(j => j._id.type === 'translation')
  .reduce((sum, j) => sum + (j.totalPages - j.completedPages - j.failedPages), 0);

const etaHours = hourlyRate > 0 ? remaining / hourlyRate : Infinity;
```

### 8. Pause Status

```javascript
const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
if (control?.paused) console.log('PIPELINE PAUSED');
if (control?.paused_phases?.length) console.log('Paused phases: ' + control.paused_phases.join(', '));
```

## Output Format

Present results as a concise status report:

```
Pipeline Status — [timestamp]

Fully translated: X books (target: Y)
Pipeline funnel: Z queued, W archiving, ... N complete

Active jobs:
  Translation (backfill): X jobs, Y/Z pages done [rate/hr, ETA]
  Translation (pipeline): X jobs, Y/Z pages done
  OCR: X jobs
  Images: X jobs

STUCK JOBS: X jobs processing with 0 progress for >2h  ← only if > 0

Throughput (verified from pages):
  Translation: X/hr (1h), Y/hr (3h), Z/hr (6h)
  OCR: X/hr (1h), Y/hr (3h)

Spot check (5 random processing jobs):
  "Book Title" — 45/50 pages translated (job says 43/50) ✓
  "Book Title" — 0/30 pages translated (job says 0/30) ⚠ STUCK

Pauses: none (or list)
```

## Common Issues

- **Jobs stuck at 0 progress:** SQS messages consumed but Lambda never processed them. Cancel stuck jobs, clear `book.job` locks, re-submit.
- **Throughput looks good but backfill isn't moving:** You're seeing pipeline cron throughput, not backfill. Filter by backfill book IDs.
- **`pages_translated` stale:** `sync-page-counts` cron runs every 6h. For real-time count, query pages directly.
- **Book.job lock prevents re-submission:** Clear with `$unset: { job: '' }` on affected books.
