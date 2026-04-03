#!/usr/bin/env node
/**
 * Enrichment Snapshot Worker
 *
 * Computes all pipeline stats and writes them to system_config._id: 'enrichment_snapshot'.
 * Runs every 2 hours on Hetzner. /progress reads this doc instead of running 15+ slow queries.
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

async function run() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const start = Date.now();

  console.log(`[enrichment-snapshot] Starting at ${new Date().toISOString()}`);

  // 1. Pipeline funnel (merge live + warehouse collections)
  const funnelLive = await db.collection('books').aggregate([
    { $match: { 'pipeline_auto.status': { $exists: true } } },
    { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
  ]).toArray();
  const funnelWarehouse = await db.collection('books_warehouse').aggregate([
    { $match: { 'pipeline_auto.status': { $exists: true } } },
    { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
  ]).toArray();
  const funnelMap = {};
  for (const f of [...funnelLive, ...funnelWarehouse]) {
    funnelMap[f._id] = (funnelMap[f._id] || 0) + f.count;
  }
  console.log(`  funnel: ${Object.keys(funnelMap).length} statuses (live + warehouse)`);

  // 2. Enrichment coverage (single aggregation)
  const [enrichment] = await db.collection('books').aggregate([
    { $match: { status: { $ne: 'deleted' }, pages_count: { $gt: 0 } } },
    { $group: {
      _id: null,
      total: { $sum: 1 },
      has_ocr: { $sum: { $cond: [{ $gt: ['$pages_ocr', 0] }, 1, 0] } },
      has_translation: { $sum: { $cond: [{ $gt: ['$pages_translated', 0] }, 1, 0] } },
      has_metadata: { $sum: { $cond: [{ $ifNull: ['$ai_metadata.enriched_at', false] }, 1, 0] } },
      has_ft_verification: { $sum: { $cond: [{ $ifNull: ['$translation_verification.verified_at', false] }, 1, 0] } },
      has_summary: { $sum: { $cond: [{ $ifNull: ['$index.generatedAt', false] }, 1, 0] } },
      has_chapters: { $sum: { $cond: [{ $ifNull: ['$chapters', false] }, 1, 0] } },
      has_collections: { $sum: { $cond: [{ $ifNull: ['$collection_scores', false] }, 1, 0] } },
      has_quality_score: { $sum: { $cond: [{ $ifNull: ['$quality_score', false] }, 1, 0] } },
      has_faceted_tags: { $sum: { $cond: [{ $ifNull: ['$faceted_tags', false] }, 1, 0] } },
      has_author_entity: { $sum: { $cond: [{ $ifNull: ['$author_entity_id', false] }, 1, 0] } },
      fully_translated: { $sum: { $cond: [{ $eq: ['$is_fully_translated', true] }, 1, 0] } },
      pipeline_complete: { $sum: { $cond: [{ $eq: ['$pipeline_auto.status', 'complete'] }, 1, 0] } },
    }}
  ]).toArray();
  console.log(`  enrichment: ${enrichment.total} books with pages`);

  // 3. Milestones (all use indexed fields — no $expr)
  const first_translations = await db.collection('books').countDocuments({ is_first_translation: true });
  const over_90_pct = await db.collection('books').countDocuments({ over_90_translated: true });
  const fully_translated = await db.collection('books').countDocuments({ is_fully_translated: true });
  console.log(`  milestones: ${first_translations} first translations, ${over_90_pct} >90%, ${fully_translated} fully translated`);

  // 4. Gallery
  const books_with_images = (await db.collection('gallery_images').distinct('book_id')).length;
  const gallery_images = await db.collection('gallery_images').estimatedDocumentCount();
  console.log(`  gallery: ${books_with_images} books, ${gallery_images} images`);

  // 5. Active jobs
  const active_jobs = await db.collection('jobs').aggregate([
    { $match: { status: { $in: ['pending', 'processing'] } } },
    { $group: {
      _id: { type: '$type', note: '$note' },
      count: { $sum: 1 },
      total_pages: { $sum: '$progress.total' },
      completed_pages: { $sum: '$progress.completed' },
      failed_pages: { $sum: '$progress.failed' },
      oldest: { $min: '$created_at' }
    }}
  ]).toArray();

  // 6. Stuck jobs
  const twoHoursAgo = new Date(Date.now() - 2 * 3600000);
  const stuck_jobs = await db.collection('jobs').countDocuments({
    status: 'processing', 'progress.completed': 0, created_at: { $lt: twoHoursAgo }
  });

  // 7. Throughput (page-level)
  const throughput = {};
  for (const hours of [1, 3, 6]) {
    const since = new Date(Date.now() - hours * 3600000);
    throughput[`translation_${hours}h`] = await db.collection('pages').countDocuments({
      'translation.updated_at': { $gte: since }
    });
    throughput[`ocr_${hours}h`] = await db.collection('pages').countDocuments({
      'ocr.updated_at': { $gte: since }
    });
  }

  // 8. Pause status
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });

  // 9. Stall detection — flag when translation throughput is 0 but jobs exist
  const translationActive = active_jobs.some(j => j._id.type === 'translation');
  const translationStalled = translationActive && throughput.translation_1h === 0;
  if (translationStalled) {
    console.log(`[enrichment-snapshot] WARNING: Translation stalled — active jobs exist but 0 pages translated in 1h`);
    await db.collection('processing_control_log').insertOne({
      action: 'stall_detected', timestamp: new Date(), source: 'enrichment-snapshot',
      detail: `translation_1h=0 with ${active_jobs.filter(j => j._id.type === 'translation').reduce((s, j) => s + j.count, 0)} active translation jobs`,
      paused: control?.paused || false,
    }).catch(() => {});
  }

  // Write snapshot
  const snapshot = {
    _id: 'enrichment_snapshot',
    computed_at: new Date(),
    computation_ms: Date.now() - start,
    funnel: funnelMap,
    enrichment: {
      total: enrichment.total,
      ocr: enrichment.has_ocr,
      translation: enrichment.has_translation,
      metadata: enrichment.has_metadata,
      ft_verification: enrichment.has_ft_verification,
      summary: enrichment.has_summary,
      chapters: enrichment.has_chapters,
      collections: enrichment.has_collections,
      quality_score: enrichment.has_quality_score,
      faceted_tags: enrichment.has_faceted_tags,
      author_entity: enrichment.has_author_entity,
      fully_translated: enrichment.fully_translated,
      pipeline_complete: enrichment.pipeline_complete,
    },
    milestones: {
      first_translations,
      over_90_pct,
      fully_translated,
    },
    gallery: {
      books_with_images,
      gallery_images,
    },
    active_jobs: active_jobs.map(j => ({
      type: j._id.type,
      note: j._id.note || null,
      count: j.count,
      total_pages: j.total_pages,
      completed_pages: j.completed_pages,
      failed_pages: j.failed_pages,
      oldest: j.oldest,
    })),
    stuck_jobs,
    throughput,
    paused: control?.paused || false,
    paused_phases: control?.paused_phases || [],
    translation_stalled: translationStalled,
  };

  await db.collection('system_config').replaceOne(
    { _id: 'enrichment_snapshot' },
    snapshot,
    { upsert: true }
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[enrichment-snapshot] Done in ${elapsed}s`);

  // ── Data page snapshot ──
  // Computes stats for /data page (languages, centuries, categories, providers).
  // Same connection, avoids a separate cron entry.
  await computeDataPageSnapshot(db);

  await client.close();
}

/**
 * Compute and cache the /data page stats in system_config._id: 'data_page_snapshot'.
 * Only counts books with visible: true AND pages_count > 0 (excludes empty catalog stubs).
 */
async function computeDataPageSnapshot(db) {
  const t0 = Date.now();
  console.log(`[data-page-snapshot] Starting...`);

  const books = db.collection('books');
  const maxTimeMS = 45000;
  const real = { visible: true, pages_count: { $gt: 0 } };

  function formatCentury(yearBucket) {
    if (yearBucket <= 0) return '1st c.';
    const c = Math.floor(yearBucket / 100) + 1;
    const mod10 = c % 10, mod100 = c % 100;
    const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th';
    return `${c}${suffix} c.`;
  }

  const PIPELINE_STATUS_ORDER = [
    'queued','archiving','archive_complete','ocr_submitted','ocr_complete',
    'metadata_enriched','translate_submitted','translate_complete',
    'enriching','enriched','chapters','chapters_complete',
    'images_submitted','images_complete','complete','needs_attention','failed',
  ];

  // Group 1: counts
  const [totalBooks, firstTranslations, hiddenCount, emptyShells] = await Promise.all([
    books.countDocuments(real, { maxTimeMS }),
    books.countDocuments({ ...real, is_first_translation: true }, { maxTimeMS }),
    books.countDocuments({ hidden: true }, { maxTimeMS }),
    books.countDocuments({ visible: true, $or: [{ pages_count: 0 }, { pages_count: { $exists: false } }] }, { maxTimeMS }),
  ]);

  // Group 2: breakdowns
  const [languagesAgg, centuriesAgg, pageTotalsAgg] = await Promise.all([
    books.aggregate([{ $match: real }, { $group: { _id: '$language', count: { $sum: 1 } } }, { $sort: { count: -1 } }], { maxTimeMS }).toArray(),
    books.aggregate([{ $match: { ...real, year: { $exists: true, $type: 'number' } } }, { $addFields: { century: { $multiply: [{ $floor: { $divide: ['$year', 100] } }, 100] } } }, { $group: { _id: '$century', count: { $sum: 1 } } }, { $sort: { _id: 1 } }], { maxTimeMS }).toArray(),
    books.aggregate([{ $match: real }, { $group: { _id: null, pages: { $sum: { $ifNull: ['$pages_count', 0] } }, ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } }, translated: { $sum: { $ifNull: ['$pages_translated', 0] } } } }], { maxTimeMS }).toArray(),
  ]);

  // Group 3: categories, providers, collections, illustrations
  const [categoriesAgg, providersAgg, collectionsAgg, totalIllustrations] = await Promise.all([
    books.aggregate([{ $match: { ...real, categories: { $exists: true } } }, { $unwind: '$categories' }, { $group: { _id: '$categories', count: { $sum: 1 } } }, { $sort: { count: -1 } }], { maxTimeMS }).toArray(),
    books.aggregate([{ $match: { ...real, 'image_source.provider_name': { $exists: true } } }, { $group: { _id: '$image_source.provider_name', count: { $sum: 1 } } }, { $sort: { count: -1 } }], { maxTimeMS }).toArray(),
    db.collection('collections').find({}).sort({ order: 1 }).project({ slug: 1, name: 1, book_count: 1, _id: 0 }).toArray(),
    db.collection('gallery_images').estimatedDocumentCount(),
  ]);

  // Group 4: enrichment counts
  const [hasSummary, hasIndex, hasChapters, hasSourceDates, hasEditions] = await Promise.all([
    books.countDocuments({ 'reading_summary.overview': { $exists: true } }, { maxTimeMS }),
    books.countDocuments({ 'index.generatedAt': { $exists: true } }, { maxTimeMS }),
    books.countDocuments({ 'chapters.0': { $exists: true } }, { maxTimeMS }),
    books.countDocuments({ 'source_work_dates.0': { $exists: true } }, { maxTimeMS }),
    db.collection('editions').estimatedDocumentCount(),
  ]);

  // Group 5: pipeline statuses (no $facet — too heavy for regular refresh)
  const pipelineAgg = await books.aggregate([
    { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ], { maxTimeMS }).toArray();

  const pageTotals = pageTotalsAgg[0] || { pages: 0, ocr: 0, translated: 0 };

  const pipelineMap = new Map();
  for (const p of pipelineAgg) pipelineMap.set(p._id || 'no pipeline', p.count);
  const pipelineStatuses = [];
  for (const s of PIPELINE_STATUS_ORDER) { const c = pipelineMap.get(s); if (c) pipelineStatuses.push({ status: s, count: c }); }
  const noPipeline = pipelineMap.get('no pipeline');
  if (noPipeline) pipelineStatuses.push({ status: 'no pipeline', count: noPipeline });

  const data = {
    totalBooks, totalPages: pageTotals.pages, totalOcr: pageTotals.ocr,
    totalTranslated: pageTotals.translated, totalIllustrations, firstTranslations,
    hiddenCount, emptyShells, hasSummary, hasIndex, hasChapters, hasSourceDates, hasEditions,
    pipelineStatuses,
    ocrTiers: [], translationTiers: [], // Skip $facet in cron — too expensive
    languages: languagesAgg.filter(l => l._id && l._id !== 'Unknown').map(l => ({ language: l._id, count: l.count })),
    centuries: centuriesAgg.map(c => ({ century: c._id, label: formatCentury(c._id), count: c.count })),
    categories: categoriesAgg.map(c => ({ slug: c._id, name: c._id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '), count: c.count })),
    providers: providersAgg.filter(p => p._id).map(p => ({ name: p._id, count: p.count })),
    collections: collectionsAgg,
  };

  await db.collection('system_config').updateOne(
    { _id: 'data_page_snapshot' },
    { $set: { data, updated_at: new Date() } },
    { upsert: true },
  );

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[data-page-snapshot] Done in ${elapsed}s — ${totalBooks} books, ${data.languages.length} languages`);
}

run().catch(e => { console.error(e); process.exit(1); });
