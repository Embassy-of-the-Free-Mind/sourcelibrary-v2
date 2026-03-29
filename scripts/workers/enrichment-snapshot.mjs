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

  // 1. Pipeline funnel
  const funnel = await db.collection('books').aggregate([
    { $match: { 'pipeline_auto.status': { $exists: true } } },
    { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
  ]).toArray();
  const funnelMap = Object.fromEntries(funnel.map(f => [f._id, f.count]));
  console.log(`  funnel: ${funnel.length} statuses`);

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
      fully_translated: { $sum: { $cond: [{ $and: [{ $gt: ['$pages_translated', 0] }, { $gte: ['$pages_translated', { $subtract: ['$pages_count', { $ifNull: ['$pages_blank', 0] }] }] }] }, 1, 0] } },
      pipeline_complete: { $sum: { $cond: [{ $eq: ['$pipeline_auto.status', 'complete'] }, 1, 0] } },
    }}
  ]).toArray();
  console.log(`  enrichment: ${enrichment.total} books with pages`);

  // 3. Milestones
  const first_translations = await db.collection('books').countDocuments({ is_first_translation: true });
  const over_90_pct = await db.collection('books').countDocuments({
    status: { $ne: 'deleted' }, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 },
    $expr: { $gte: ['$pages_translated', { $multiply: [{ $subtract: ['$pages_count', { $ifNull: ['$pages_blank', 0] }] }, 0.9] }] }
  });
  console.log(`  milestones: ${first_translations} first translations, ${over_90_pct} >90%`);

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
  };

  await db.collection('system_config').replaceOne(
    { _id: 'enrichment_snapshot' },
    snapshot,
    { upsert: true }
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[enrichment-snapshot] Done in ${elapsed}s`);

  await client.close();
}

run().catch(e => { console.error(e); process.exit(1); });
