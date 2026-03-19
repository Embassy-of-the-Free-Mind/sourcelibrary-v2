---
name: status
description: Quick canon + pipeline health check. Use when asked "how's it going?", "status?", "how's the db?", or any quick health check. Lighter than /progress — focuses on mission metrics, not job debugging.
---

# Quick Status Check

Read the latest pipeline snapshot (written every 10 min by Hetzner cron) + 3 lightweight queries. Use `set -a; source .env.production.local; set +a; node -e "..."` to run.

## The Script

```javascript
const { MongoClient } = require('mongodb');
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

async function status() {
  await client.connect();
  const db = client.db('bookstore');

  // Read latest snapshot (instant) + 3 small indexed queries
  const [snap, jobs, paused, failed24h] = await Promise.all([
    db.collection('pipeline_snapshots').findOne({}, { sort: { timestamp: -1 } }),
    db.collection('jobs').aggregate([
      { $match: { status: { $in: ['processing', 'queued'] } } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]).toArray(),
    db.collection('system_config').findOne({ _id: 'processing_control' }),
    db.collection('jobs').countDocuments({
      status: 'failed',
      updated_at: { $gte: new Date(Date.now() - 86400000) }
    }),
  ]);

  if (!snap) { console.log('No pipeline snapshots found'); await client.close(); return; }

  const p = snap.pages || {};
  const c = snap.canon || {};
  const ft = snap.first_translations || {};
  const jobMap = Object.fromEntries(jobs.map(j => [j._id, j.count]));
  const age = Math.round((Date.now() - new Date(snap.timestamp).getTime()) / 60000);

  console.log('=== Source Library Status (' + age + 'min ago) ===');
  console.log('');
  console.log('Canon: ' + (c.visible || '?') + ' books | ' + (c.readable || '?') + ' readable (' + (c.visible ? (c.readable/c.visible*100).toFixed(1) : '?') + '%)');
  console.log('First Translations: ' + (ft.complete || '?') + '/' + (ft.total || '?') + ' complete');
  console.log('');
  console.log('Coverage:');
  console.log('  OCR: ' + (p.ocr || 0).toLocaleString() + '/' + (p.total || 0).toLocaleString() + ' (' + (p.total ? (p.ocr/p.total*100).toFixed(1) : '0') + '%)');
  console.log('  Translated: ' + (p.translated || 0).toLocaleString() + '/' + (p.total || 0).toLocaleString() + ' (' + (p.total ? (p.translated/p.total*100).toFixed(1) : '0') + '%)');
  console.log('');
  console.log('Pipeline: ' + (jobMap.processing || 0) + ' processing, ' + (jobMap.queued || 0) + ' queued, ' + failed24h + ' failed (24h)');
  if (paused?.paused) console.log('  *** PIPELINE PAUSED ***');
  if (paused?.paused_phases?.length) console.log('  Paused phases: ' + paused.paused_phases.join(', '));

  await client.close();
}

status().catch(e => { console.error(e.message); process.exit(1); });
```

## Notes

- Snapshot data is written by the `post-import-pipeline` cron every ~10 minutes. The `canon` and `first_translations` fields were added 2026-03-19.
- If snapshots don't have `canon`/`first_translations` yet, fall back to showing `?`.
- For live (non-cached) numbers or deeper investigation, use `/progress` instead.

## Output Format

Present results as a concise status block. Show the snapshot age so it's clear this is cached data. Keep it tight.
