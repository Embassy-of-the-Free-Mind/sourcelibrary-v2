import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/**
 * GET /api/admin/latency-trend
 *
 * Returns the latest latency trend data computed by the latency-trend cron.
 */
export const GET = withAdminAuth(async () => {
  const db = await getDb();
  const stored = await db.collection('system_config').findOne(
    { _id: 'latency_trend' as any },
    { maxTimeMS: 5000 }
  );

  if (!stored) {
    return NextResponse.json(
      { error: 'No latency trend data yet. Run /api/cron/latency-trend first.' },
      { status: 404 }
    );
  }

  return NextResponse.json(stored.data);
});
