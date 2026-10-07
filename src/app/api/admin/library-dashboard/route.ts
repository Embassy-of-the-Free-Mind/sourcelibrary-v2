import { NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { withInnerCircleAuth } from '@/lib/auth-helpers';
import { LIBRARY_DASHBOARD_ID, LIBRARY_DASHBOARD_STALE_AFTER_MS, type PipelineDay } from '@/lib/library-dashboard';

// GET: the daily pipeline day series from system_config.library_dashboard
// (written at 05:55 UTC on Hetzner by scripts/analytics/snapshot-library-dashboard.mjs).
// One projected findOne; never aggregates (#2980). Gated like /analytics itself
// (requireInnerCircle), not admin-only, because the /analytics Pipeline tab reads it.
export const GET = withInnerCircleAuth(async () => {
  const db = await getReadDb();
  const doc = await db.collection('system_config').findOne(
    { _id: LIBRARY_DASHBOARD_ID as unknown as import('mongodb').ObjectId },
    { projection: { generatedAt: 1, 'pipeline.days': 1 } },
  );
  if (!doc?.generatedAt) {
    return NextResponse.json({ error: 'library_dashboard snapshot missing' }, { status: 404 });
  }
  const ageMs = Date.now() - new Date(doc.generatedAt).getTime();
  return NextResponse.json({
    generatedAt: doc.generatedAt,
    stale: ageMs > LIBRARY_DASHBOARD_STALE_AFTER_MS,
    days: (doc.pipeline?.days ?? []) as PipelineDay[],
  });
});
