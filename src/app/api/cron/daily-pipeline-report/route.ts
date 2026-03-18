import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { createCronLogger } from '@/lib/cron-logger';

export const maxDuration = 60;
export const preferredRegion = 'fra1';

/**
 * Daily pipeline health snapshot.
 * Writes one document per day to `pipeline_health_daily`.
 * Upserts on `date` key so re-runs are idempotent.
 *
 * Scheduled at 06:00 UTC — after sync-page-counts has refreshed book caches.
 */
export async function GET() {
  const log = createCronLogger('daily-pipeline-report');

  try {
    const db = await getDb();
    const books = db.collection('books');
    const jobs = db.collection('jobs');

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const dateStr = yesterday.toISOString().slice(0, 10); // YYYY-MM-DD

    const dayStart = new Date(`${dateStr}T00:00:00Z`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

    const vis = { hidden: { $ne: true } };

    // ── Collection state (from book-level caches) — single pass ──
    const [collectionState] = await books.aggregate([
      { $match: vis },
      { $group: {
        _id: null,
        totalBooks:          { $sum: 1 },
        ocrComplete:         { $sum: { $cond: [{ $and: [{ $gt: ['$pages_ocr', 0] }, { $gte: ['$pages_ocr', '$pages_count'] }] }, 1, 0] } },
        ocrPartial:          { $sum: { $cond: [{ $and: [{ $gt: ['$pages_ocr', 0] }, { $lt:  ['$pages_ocr', '$pages_count'] }] }, 1, 0] } },
        translationComplete: { $sum: { $cond: [{ $and: [{ $gt: ['$pages_translated', 0] }, { $gte: ['$pages_translated', '$pages_count'] }] }, 1, 0] } },
        translationPartial:  { $sum: { $cond: [{ $and: [{ $gt: ['$pages_translated', 0] }, { $lt:  ['$pages_translated', '$pages_count'] }] }, 1, 0] } },
        firstTranslations:   { $sum: { $cond: [{ $eq: ['$is_first_translation', true] }, 1, 0] } },
        totalPages:          { $sum: '$pages_count' },
        ocrPages:            { $sum: '$pages_ocr' },
        translatedPages:     { $sum: '$pages_translated' },
      } },
    ]).toArray();

    const totalBooks          = collectionState?.totalBooks          ?? 0;
    const ocrComplete         = collectionState?.ocrComplete         ?? 0;
    const ocrPartial          = collectionState?.ocrPartial          ?? 0;
    const translationComplete = collectionState?.translationComplete ?? 0;
    const translationPartial  = collectionState?.translationPartial  ?? 0;
    const firstTranslations   = collectionState?.firstTranslations   ?? 0;

    // ── Pipeline status distribution ──
    const pipelineStatuses = await books.aggregate([
      { $match: { 'pipeline_auto.status': { $exists: true }, ...vis } },
      { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray();

    // ── Job throughput for the date ──
    const jobsByTypeStatus = await jobs.aggregate([
      { $match: { $or: [
        { completed_at: { $gte: dayStart, $lte: dayEnd } },
        { created_at: { $gte: dayStart, $lte: dayEnd } },
      ] } },
      { $group: {
        _id: { type: '$type', status: '$status' },
        count: { $sum: 1 },
      } },
      { $sort: { count: -1 } },
    ]).toArray();

    // Pivot into throughput object
    const throughput: Record<string, Record<string, number>> = {};
    for (const j of jobsByTypeStatus) {
      const type = j._id.type || 'unknown';
      if (!throughput[type]) throughput[type] = {};
      throughput[type][j._id.status] = j.count;
    }

    // ── Active jobs (current snapshot) ──
    const [pendingJobs, processingJobs] = await Promise.all([
      jobs.countDocuments({ status: 'pending' }),
      jobs.countDocuments({ status: 'processing' }),
    ]);

    // ── Health snapshot from adaptive limits ──
    const adaptiveLimits = await db.collection('system_config').findOne({ _id: 'adaptive_limits' as any });
    const processingControl = await db.collection('system_config').findOne({ _id: 'processing_control' as any });

    // ── Cron performance for the date ──
    const cronSummary = await db.collection('cron_runs').aggregate([
      { $match: { timestamp: { $gte: dayStart, $lte: dayEnd } } },
      { $group: {
        _id: '$cron',
        runs: { $sum: 1 },
        failures: { $sum: { $cond: ['$failed', 1, 0] } },
        avg_duration_ms: { $avg: '$duration_ms' },
        max_duration_ms: { $max: '$duration_ms' },
      } },
      { $sort: { _id: 1 } },
    ]).toArray();

    // ── Gemini usage/cost for the date ──
    const usageDaily = await db.collection('gemini_usage_daily').findOne({ date: dateStr });

    // ── Books added that day ──
    const booksAdded = await books.countDocuments({ created_at: { $gte: dayStart, $lte: dayEnd }, ...vis });

    // ── Stalled books (stuck in transitional states >4h at snapshot time) ──
    const stallThreshold = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const stalledBooks = await books.aggregate([
      { $match: {
        'pipeline_auto.status': { $in: ['archiving', 'ocr_submitted', 'translate_submitted', 'images_submitted'] },
        'pipeline_auto.updated_at': { $lt: stallThreshold },
        ...vis,
      } },
      { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
    ]).toArray();

    // ── Assemble snapshot ──
    const snapshot = {
      date: dateStr,
      snapshot_at: new Date(),

      books: {
        total: totalBooks,
        ocr_complete: ocrComplete,
        ocr_partial: ocrPartial,
        translation_complete: translationComplete,
        translation_partial: translationPartial,
        first_translations: firstTranslations,
        added_today: booksAdded,
      },

      pages: {
        total: collectionState?.totalPages || 0,
        ocr_done: collectionState?.ocrPages || 0,
        translated: collectionState?.translatedPages || 0,
      },

      pipeline_statuses: Object.fromEntries(pipelineStatuses.map(s => [s._id, s.count])),

      throughput,

      active_jobs: {
        pending: pendingJobs,
        processing: processingJobs,
      },

      health: {
        grade: adaptiveLimits?.health?.grade || 'unknown',
        sqs_combined_depth: adaptiveLimits?.health?.sqs_combined_depth || 0,
        active_jobs_reported: adaptiveLimits?.health?.active_jobs || 0,
        consecutive_healthy: adaptiveLimits?.health?.consecutive_healthy || 0,
        consecutive_degraded: adaptiveLimits?.health?.consecutive_degraded || 0,
        limits_locked: adaptiveLimits?.locked || false,
      },

      system: {
        paused: processingControl?.paused || false,
        paused_phases: processingControl?.paused_phases || [],
        limits: adaptiveLimits?.limits || {},
      },

      stalled_books: Object.fromEntries(stalledBooks.map(s => [s._id, s.count])),

      crons: Object.fromEntries(cronSummary.map(c => [c._id, {
        runs: c.runs,
        failures: c.failures,
        avg_duration_ms: Math.round(c.avg_duration_ms),
        max_duration_ms: c.max_duration_ms,
      }])),

      cost_usd: usageDaily?.totalCost || 0,
    };

    // Upsert — idempotent on date key
    await db.collection('pipeline_health_daily').updateOne(
      { date: dateStr },
      { $set: snapshot },
      { upsert: true },
    );

    log.action('snapshot_written', 1);
    log.action('date', 0); // logged in summary
    await log.flush();

    return NextResponse.json({ ok: true, date: dateStr, snapshot });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(msg);
    log.setFailed();
    await log.flush();
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
