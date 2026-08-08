import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/line — the semantic monitoring surface (#3756 §B).
 *
 * Returns the latest `stage_coverage_snapshots` doc (written nightly by
 * scripts/workers/stage-coverage-snapshot.mjs), plus the previous snapshot
 * and the newest snapshot at least ~7 days old so callers can compute
 * night-over-night and 7-day deltas. Never runs the measurements itself —
 * same read-a-precomputed-doc pattern as /platform/admin/metrics.
 *
 * CRON_SECRET bearer auth, same as /api/admin/key-fingerprints.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = await getDb();
  const snapshots = db.collection('stage_coverage_snapshots');

  const [latest, previous] = await snapshots
    .find({})
    .sort({ timestamp: -1 })
    .limit(2)
    .toArray();

  if (!latest) {
    return NextResponse.json({ latest: null, previous: null, week_ago: null });
  }

  // Newest snapshot at least ~7 days older than the latest (6.5d tolerance so
  // a slightly-early nightly run still qualifies).
  const cutoff = new Date(new Date(latest.timestamp).getTime() - 6.5 * 24 * 3600 * 1000);
  const weekAgo = await snapshots
    .find({ timestamp: { $lte: cutoff } })
    .sort({ timestamp: -1 })
    .limit(1)
    .next();

  return NextResponse.json({ latest, previous: previous ?? null, week_ago: weekAgo ?? null });
}
