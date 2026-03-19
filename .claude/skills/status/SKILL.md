---
name: status
description: Quick canon + pipeline health check. Use when asked "how's it going?", "status?", "how's the db?", or any quick health check. Lighter than /progress — focuses on mission metrics, not job debugging.
---

# Quick Status Check

Run a single MongoDB script that returns canon metrics and pipeline health in one shot. Use `set -a; source .env.production.local; set +a; node -e "..."` to run.

## The Script

```javascript
const { MongoClient } = require('mongodb');
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

async function status() {
  await client.connect();
  const db = client.db('bookstore');

  const [totals, readable, firstTranslations, jobs, paused, failed24h, recentTranslations] = await Promise.all([
    // Totals from book-level caches (fast)
    db.collection('books').aggregate([
      { $match: { hidden: { $ne: true } } },
      { $group: {
        _id: null,
        books: { $sum: 1 },
        pages: { $sum: { $ifNull: ['$pages_count', 0] } },
        ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } },
        translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
      }}
    ]).toArray(),

    // Readable books (>=90% translated)
    db.collection('books').countDocuments({
      hidden: { $ne: true },
      pages_ocr: { $gte: 1 },
      $expr: { $gte: ['$pages_translated', { $multiply: ['$pages_ocr', 0.9] }] },
    }),

    // First translations (strict: non-English, non-bilingual, >=90% translated, >=10 pages)
    db.collection('books').countDocuments({
      hidden: { $ne: true },
      language: { $nin: ['English', 'english', null], $not: { $regex: /english/i } },
      pages_ocr: { $gte: 10 },
      $expr: { $gte: ['$pages_translated', { $multiply: ['$pages_ocr', 0.9] }] },
    }),

    // Active jobs
    db.collection('jobs').aggregate([
      { $match: { status: { $in: ['processing', 'queued'] } } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]).toArray(),

    // Pause status
    db.collection('system_config').findOne({ _id: 'processing_control' }),

    // Failed jobs last 24h
    db.collection('jobs').countDocuments({
      status: 'failed',
      updated_at: { $gte: new Date(Date.now() - 86400000) }
    }),

    // Translation throughput (last 1h from gemini_usage — faster than scanning pages)
    // NOTE: Hetzner pipeline logs as 'translation', not 'translate'
    db.collection('gemini_usage').countDocuments({
      type: { $in: ['translate', 'translation'] },
      status: 'success',
      timestamp: { $gte: new Date(Date.now() - 3600000) }
    }),
  ]);

  const t = totals[0] || { books: 0, pages: 0, ocr: 0, translated: 0 };
  const jobMap = Object.fromEntries(jobs.map(j => [j._id, j.count]));

  console.log('=== Source Library Status ===');
  console.log('');
  console.log('Canon:');
  console.log(`  ${t.books.toLocaleString()} books | ${t.pages.toLocaleString()} pages`);
  console.log(`  ${readable.toLocaleString()} readable (${(readable/t.books*100).toFixed(1)}%)`);
  console.log(`  ${firstTranslations.toLocaleString()} first English translations`);
  console.log('');
  console.log('Coverage:');
  console.log(`  OCR: ${t.ocr.toLocaleString()} pages (${(t.ocr/t.pages*100).toFixed(1)}%)`);
  console.log(`  Translated: ${t.translated.toLocaleString()} pages (${(t.translated/t.pages*100).toFixed(1)}%)`);
  console.log('');
  console.log('Pipeline:');
  console.log(`  Processing: ${jobMap.processing || 0} | Queued: ${jobMap.queued || 0}`);
  console.log(`  Failed (24h): ${failed24h}`);
  console.log(`  Translation rate: ~${recentTranslations}/hr`);
  if (paused?.paused) console.log('  *** PIPELINE PAUSED ***');
  if (paused?.paused_phases?.length) console.log(`  Paused phases: ${paused.paused_phases.join(', ')}`);

  await client.close();
}

status().catch(e => { console.error(e.message); process.exit(1); });
```

## Output Format

Present results as a concise status block:

```
Source Library Status

Canon: 28,625 books | 8.8M pages
  2,150 readable (7.5%) | 1,800 first English translations

Coverage: OCR 15.4% | Translation 9.9%

Pipeline: 103 processing, 102 queued, 0 failed (24h)
  Translation rate: ~450/hr
```

Keep it tight. If something looks wrong (high failures, pipeline paused, zero throughput), call it out. Otherwise just report the numbers.

For deeper investigation, use `/progress` instead.
