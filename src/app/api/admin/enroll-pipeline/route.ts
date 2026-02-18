import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import type { PipelineAutoStatus } from '@/lib/types/pipeline';
import { withAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;

/**
 * GET /api/admin/enroll-pipeline
 *
 * Pipeline status overview — counts per status.
 */
export const GET = withAuth(async (request, session) => {
  const db = await getDb();

  const statusCounts = await db.collection('books').aggregate([
    { $match: { pipeline_auto: { $exists: true } } },
    { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).toArray();

  const counts = Object.fromEntries(statusCounts.map(s => [s._id, s.count]));
  const total = statusCounts.reduce((sum, s) => sum + s.count, 0);

  // Count books without pipeline_auto
  const unenrolled = await db.collection('books').countDocuments({
    pipeline_auto: { $exists: false },
  });

  // Recent failures with details
  const recentFailed = await db.collection('books')
    .find({ 'pipeline_auto.status': 'failed' })
    .project({ id: 1, title: 1, 'pipeline_auto.error': 1, 'pipeline_auto.retry_count': 1 })
    .limit(20)
    .toArray();

  return NextResponse.json({
    total_enrolled: total,
    unenrolled,
    status_counts: counts,
    recent_failures: recentFailed.map(b => ({
      id: b.id,
      title: b.title,
      error: b.pipeline_auto?.error,
      retries: b.pipeline_auto?.retry_count,
    })),
  });
});

/**
 * POST /api/admin/enroll-pipeline
 *
 * Enroll books into the auto pipeline.
 * Body: { bookIds?: string[], limit?: number, dryRun?: boolean, reEnrollFailed?: boolean }
 */
export const POST = withAuth(async (request, session) => {
  const db = await getDb();
  const body = await request.json().catch(() => ({}));
  const { bookIds, limit = 50, dryRun = false, reEnrollFailed = false, reEnrollCompleted = false } = body as {
    bookIds?: string[];
    limit?: number;
    dryRun?: boolean;
    reEnrollFailed?: boolean;
    reEnrollCompleted?: boolean;
  };

  let query: Record<string, unknown>;
  // reEnrollCompleted targets 'enriched' since old 'complete' books went directly from
  // enriching → complete, skipping chapters + images. Setting them to 'enriched' runs
  // just those new phases without redoing OCR/translation/summary.
  let enrollStatus: PipelineAutoStatus = 'queued';

  if (bookIds?.length) {
    // Enroll specific books
    query = { id: { $in: bookIds } };
  } else if (reEnrollCompleted) {
    // Backfill completed books through new pipeline phases (chapters, images)
    query = { 'pipeline_auto.status': 'complete' };
    enrollStatus = 'enriched';
  } else if (reEnrollFailed) {
    // Re-enroll failed books
    query = { 'pipeline_auto.status': 'failed' };
  } else {
    // Enroll all books without pipeline_auto
    query = { pipeline_auto: { $exists: false } };
  }

  const books = await db.collection('books')
    .find(query)
    .project({ id: 1, title: 1, pages_count: 1, created_at: 1, 'pipeline_auto.status': 1 })
    .limit(limit)
    .toArray();

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      wouldEnroll: books.length,
      books: books.map(b => ({
        id: b.id,
        title: b.title,
        pages: b.pages_count,
        currentStatus: b.pipeline_auto?.status || 'none',
      })),
    });
  }

  const bookIdList = books.map(b => b.id);
  const now = new Date();

  const result = await db.collection('books').updateMany(
    { id: { $in: bookIdList } },
    {
      $set: {
        'pipeline_auto.status': enrollStatus,
        'pipeline_auto.source': 'admin',
        'pipeline_auto.last_updated': now,
        'pipeline_auto.retry_count': 0,
        ...(enrollStatus === 'queued' ? { 'pipeline_auto.queued_at': now } : {}),
        updated_at: now,
      },
    }
  );

  return NextResponse.json({
    success: true,
    enrolled: result.modifiedCount,
    message: `Enrolled ${result.modifiedCount} books. The pipeline cron will start processing within 10 minutes.`,
  });
});
