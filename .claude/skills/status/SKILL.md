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

  const [totals, readable, firstTranslations, jobs, paused, failed24h, recentTranslations, batchHealth, funnel, ocrQueue, warehouse, translated] = await Promise.all([
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
      $expr: { $gte: ['$pages_translated', { $multiply: [{ $subtract: [{ $ifNull: ['$pages_ocr', 0] }, { $ifNull: ['$pages_blank', 0] }] }, 0.9] }] },
    }),

    // First translations (verified flag from metadata enrichment)
    db.collection('books').countDocuments({
      hidden: { $ne: true },
      is_first_translation: true,
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

    // Batch API health (written by batch-collector every 10 min)
    db.collection('system_config').findOne({ _id: 'batch_health' }),

    // Pipeline funnel (pipeline_auto.status is the real field)
    db.collection('books').aggregate([
      { $match: { pages_count: { $gt: 0 } } },
      { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray(),

    // OCR queue depth (pages needing OCR)
    db.collection('books').aggregate([
      { $match: { 'pipeline_auto.status': { $in: ['archive_complete', 'ocr_submitted'] } } },
      { $group: { _id: null, books: { $sum: 1 }, totalPages: { $sum: '$pages_count' }, ocrDone: { $sum: '$pages_ocr' } } }
    ]).toArray(),

    // Warehouse backlog
    db.collection('books_warehouse').countDocuments({}),

    // Books with any translation
    db.collection('books').countDocuments({ pages_translated: { $gt: 0 } }),
  ]);

  const t = totals[0] || { books: 0, pages: 0, ocr: 0, translated: 0 };
  const jobMap = Object.fromEntries(jobs.map(j => [j._id, j.count]));
  const oq = ocrQueue[0] || { books: 0, totalPages: 0, ocrDone: 0 };
  const funnelMap = Object.fromEntries(funnel.map(f => [f._id, f.count]));

  console.log('=== Source Library Status ===');
  console.log('');
  console.log('Library:');
  console.log(`  ${t.books.toLocaleString()} visible books | ${t.pages.toLocaleString()} pages`);
  console.log(`  ${translated.toLocaleString()} translated | ${readable.toLocaleString()} readable (>=90%)`);
  console.log(`  ${firstTranslations.toLocaleString()} first English translations`);
  console.log(`  ${warehouse.toLocaleString()} warehouse (not yet live)`);
  console.log('');
  console.log('Coverage:');
  console.log(`  OCR: ${t.ocr.toLocaleString()}/${t.pages.toLocaleString()} pages (${(t.ocr/t.pages*100).toFixed(1)}%)`);
  console.log(`  Translated: ${t.translated.toLocaleString()}/${t.pages.toLocaleString()} pages (${(t.translated/t.pages*100).toFixed(1)}%)`);
  console.log('');

  // Pipeline funnel in lifecycle order
  const funnelOrder = ['archiving', 'archive_complete', 'ocr_submitted', 'ocr_complete', 'translate_submitted', 'translate_complete', 'chapters_complete', 'images_submitted', 'images_complete', 'complete'];
  const funnelLines = funnelOrder.filter(s => funnelMap[s]).map(s => `${s}: ${funnelMap[s].toLocaleString()}`);
  const special = funnel.filter(f => !funnelOrder.includes(f._id) && f._id).map(f => `${f._id}: ${f.count}`);
  console.log('Pipeline funnel:');
  console.log(`  ${funnelLines.join(' → ')}`);
  if (special.length) console.log(`  Other: ${special.join(', ')}`);
  console.log('');

  // OCR queue
  const ocrNeeded = oq.totalPages - oq.ocrDone;
  console.log('OCR queue:');
  console.log(`  ${oq.books.toLocaleString()} books | ${ocrNeeded.toLocaleString()} pages to OCR`);
  if (batchHealth?.recentPagesSaved1h > 0) {
    const hoursLeft = (ocrNeeded / batchHealth.recentPagesSaved1h).toFixed(0);
    console.log(`  At current rate (~${batchHealth.recentPagesSaved1h}/hr): ~${hoursLeft}h`);
  }
  console.log('');

  console.log('Pipeline health:');
  console.log(`  Jobs: ${jobMap.processing || 0} processing, ${jobMap.queued || 0} queued, ${failed24h} failed (24h)`);
  console.log(`  Translation rate: ~${recentTranslations}/hr`);
  if (paused?.paused) console.log('  *** PIPELINE PAUSED ***');
  if (paused?.paused_phases?.length) console.log(`  Paused phases: ${paused.paused_phases.join(', ')}`);
  console.log('');
  if (batchHealth) {
    const age = ((Date.now() - new Date(batchHealth.updated_at).getTime()) / 60000).toFixed(0);
    console.log(`Batch API (${age}m ago):`);
    console.log(`  Gemini: ${batchHealth.geminiActive} active (${batchHealth.geminiActiveByKey?.join('/')}) | DB: ${batchHealth.dbActive}`);
    console.log(`  OCR: ${batchHealth.recentPagesSaved1h}/1h, ${batchHealth.recentPagesSaved6h}/6h`);
    if (!batchHealth.healthy) console.log(`  *** ISSUES: ${batchHealth.issues?.join('; ')} ***`);
  } else {
    console.log('Batch API: no health data (collector not run yet?)');
  }

  await client.close();
}

status().catch(e => { console.error(e.message); process.exit(1); });
```

## Output Format

Present results as a concise status block. Example:

```
Source Library Status

Library: 13,000 visible books | 4.2M pages
  10,900 translated | 9,800 readable (>=90%) | 1,800 first English translations
  22,500 warehouse (not yet live)

Coverage: OCR 2.8M/4.2M (67%) | Translation 2.1M/4.2M (50%)

Pipeline funnel:
  archiving: 1,400 → archive_complete: 2,400 → ocr_complete: 34 → translate_complete: 2,200 → complete: 7,900
  Other: needs_attention: 114, failed: 36

OCR queue: 2,400 books | 680K pages to OCR
  At current rate (~2,500/hr): ~272h

Pipeline health: 3 processing, 0 queued, 2 failed (24h)
  Translation rate: ~450/hr

Batch API (5m ago): Gemini 12 active (4/4/4) | DB 12
  OCR: 2,500/1h, 15,000/6h
```

Keep it tight. If something looks wrong (high failures, pipeline paused, zero throughput), call it out. Otherwise just report the numbers.

For deeper investigation, use `/progress` instead.
