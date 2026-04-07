import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const maxDuration = 10;

/**
 * GET /api/admin/uptime — returns uptime check results.
 *
 * Query params:
 *   hours=24       — how many hours of history (default 24, max 168)
 *   endpoint=home  — filter by endpoint name (optional)
 *   summary=true   — return aggregated stats instead of raw checks
 */
export const GET = withAdminAuth(async (request: NextRequest) => {
  try {
    const db = await getDb();
    const col = db.collection('uptime_checks');

    const params = request.nextUrl.searchParams;
    const hours = Math.min(parseInt(params.get('hours') || '24'), 168);
    const endpoint = params.get('endpoint');
    const summary = params.get('summary') === 'true';

    const since = new Date(Date.now() - hours * 3600_000);
    const filter: Record<string, unknown> = { checked_at: { $gte: since } };
    if (endpoint) filter.endpoint = endpoint;

    if (summary) {
      // Aggregated per-endpoint stats
      const stats = await col.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$endpoint',
            total_checks: { $sum: 1 },
            failures: { $sum: { $cond: ['$ok', 0, 1] } },
            avg_latency_ms: { $avg: '$latency_ms' },
            max_latency_ms: { $max: '$latency_ms' },
            min_latency_ms: { $min: '$latency_ms' },
            last_check: { $max: '$checked_at' },
            last_error: {
              $last: {
                $cond: [{ $eq: ['$ok', false] }, '$error', '$$REMOVE'],
              },
            },
          },
        },
        {
          $project: {
            endpoint: '$_id',
            _id: 0,
            total_checks: 1,
            failures: 1,
            uptime_pct: {
              $round: [
                { $multiply: [{ $divide: [{ $subtract: ['$total_checks', '$failures'] }, '$total_checks'] }, 100] },
                2,
              ],
            },
            avg_latency_ms: { $round: ['$avg_latency_ms', 0] },
            max_latency_ms: 1,
            min_latency_ms: 1,
            last_check: 1,
            last_error: 1,
          },
        },
        { $sort: { endpoint: 1 } },
      ], { maxTimeMS: 10000 }).toArray();

      return NextResponse.json({
        period_hours: hours,
        since: since.toISOString(),
        endpoints: stats,
      });
    }

    // Raw check results, most recent first
    const checks = await col
      .find(filter, { projection: { _id: 0, alerted: 0, recovery_sent: 0 } })
      .sort({ checked_at: -1 })
      .limit(500)
      .toArray();

    return NextResponse.json({
      period_hours: hours,
      since: since.toISOString(),
      count: checks.length,
      checks,
    });
  } catch (error) {
    console.error('[uptime] API error:', error);
    return NextResponse.json({ error: 'Failed to fetch uptime data' }, { status: 500 });
  }
});
