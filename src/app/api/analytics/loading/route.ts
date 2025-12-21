import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

interface LoadingMetric {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

interface AnalyticsPayload {
  metrics: LoadingMetric[];
}

export async function POST(request: NextRequest) {
  try {
    const payload: AnalyticsPayload = await request.json();

    if (!payload.metrics || !Array.isArray(payload.metrics)) {
      return NextResponse.json(
        { error: 'Invalid payload: metrics array required' },
        { status: 400 }
      );
    }

    // Add server-side metadata
    const enrichedMetrics = payload.metrics.map((metric) => ({
      ...metric,
      received_at: Date.now(),
      user_agent: request.headers.get('user-agent') || 'unknown',
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    }));

    // Store in MongoDB
    const db = await getDb();
    await db.collection('loading_metrics').insertMany(enrichedMetrics);

    return NextResponse.json({ success: true, count: enrichedMetrics.length });
  } catch (error) {
    console.error('Error storing analytics:', error);
    return NextResponse.json(
      { error: 'Failed to store analytics' },
      { status: 500 }
    );
  }
}

// GET endpoint for viewing analytics summary
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const metricName = searchParams.get('name');
    const hours = parseInt(searchParams.get('hours') || '24', 10);

    const db = await getDb();
    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    const query: Record<string, unknown> = { timestamp: { $gte: cutoff } };
    if (metricName) {
      query.name = metricName;
    }

    // Aggregate stats
    const pipeline = [
      { $match: query },
      {
        $group: {
          _id: '$name',
          count: { $sum: 1 },
          avg_duration: { $avg: '$duration' },
          min_duration: { $min: '$duration' },
          max_duration: { $max: '$duration' },
          p50: { $percentile: { input: '$duration', p: [0.5], method: 'approximate' } },
          p95: { $percentile: { input: '$duration', p: [0.95], method: 'approximate' } },
        },
      },
      { $sort: { count: -1 as const } },
    ];

    const stats = await db.collection('loading_metrics').aggregate(pipeline).toArray();

    // Get recent samples
    const recentSamples = await db
      .collection('loading_metrics')
      .find(query)
      .sort({ timestamp: -1 })
      .limit(20)
      .toArray();

    return NextResponse.json({
      stats: stats.map((s) => ({
        name: s._id,
        count: s.count,
        avg: Math.round(s.avg_duration * 100) / 100,
        min: Math.round(s.min_duration * 100) / 100,
        max: Math.round(s.max_duration * 100) / 100,
        p50: s.p50?.[0] ? Math.round(s.p50[0] * 100) / 100 : null,
        p95: s.p95?.[0] ? Math.round(s.p95[0] * 100) / 100 : null,
      })),
      recentSamples: recentSamples.map((s) => ({
        name: s.name,
        duration: Math.round(s.duration * 100) / 100,
        timestamp: s.timestamp,
        metadata: s.metadata,
      })),
      query: { hours, metricName },
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    );
  }
}
