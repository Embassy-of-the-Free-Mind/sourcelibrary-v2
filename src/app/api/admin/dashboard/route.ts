import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import {
  DASHBOARD_SNAPSHOT_ID,
  DASHBOARD_SNAPSHOT_STALE_AFTER_MS,
  refreshDashboardSnapshot,
} from '@/lib/dashboard-snapshot';

export const maxDuration = 60;

// GET: read-only — just returns the snapshot. Never computes inline.
// The snapshot is written hourly by /api/cron/dashboard-snapshot, and on
// demand by the POST below (the dashboard's Refresh button).
export const GET = withAdminAuth(async () => {
  const db = await getDb();
  const snapshot = await db.collection('system_config').findOne(
    { _id: DASHBOARD_SNAPSHOT_ID as unknown as import('mongodb').ObjectId },
  );

  if (!snapshot?.data) {
    return NextResponse.json(
      { _computing: true, message: 'No snapshot yet. Hit Refresh, or wait for the hourly cron.' },
      { status: 202 },
    );
  }

  const updatedAt = new Date(snapshot.updated_at);
  const ageMs = Date.now() - updatedAt.getTime();
  return NextResponse.json({
    ...snapshot.data,
    _snapshot: {
      updated_at: snapshot.updated_at,
      age_ms: ageMs,
      stale: ageMs > DASHBOARD_SNAPSHOT_STALE_AFTER_MS,
    },
  });
});

// POST: recompute now. Called by the dashboard's Refresh button, and available
// to workers via `Authorization: Bearer $CRON_SECRET`.
export const POST = withAdminAuth(async () => {
  const db = await getDb();
  const data = await refreshDashboardSnapshot(db);
  return NextResponse.json({ ok: true, data });
});
