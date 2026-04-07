import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export const preferredRegion = 'fra1';

const ALERT_EMAIL = process.env.ALERT_EMAIL || 'derek@sourcelibrary.org';
const DEGRADED_MULTIPLIER = 2; // flag if current > 2x the 6h average
const CONSECUTIVE_CHECKS_FOR_ALERT = 2;

/**
 * GET /api/cron/latency-trend
 *
 * Aggregates latency data from cron_runs (health-check entries) over 24h.
 * Computes averages, trend direction, and sends alerts if latency is degrading.
 * Stores results in system_config.latency_trend.
 */
export async function GET() {
  const db = await getDb();

  // Fetch health-check cron runs from the last 24 hours
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const runs = await db.collection('cron_runs')
    .find(
      { cron: 'health-check', timestamp: { $gte: twentyFourHoursAgo } },
      { maxTimeMS: 10000 }
    )
    .sort({ timestamp: 1 })
    .toArray();

  if (runs.length === 0) {
    return NextResponse.json({ status: 'no_data', message: 'No health-check runs in last 24h' });
  }

  // Extract latency from the health check runs
  // The health-check cron stores duration_ms, and we can also look at the
  // db ping and browse query latency from the stored data
  const dataPoints = runs.map(run => ({
    timestamp: run.timestamp,
    duration_ms: run.duration_ms || 0,
    // health-check doesn't store individual latencies in cron_runs directly,
    // so we use duration_ms as the main metric
  }));

  // Also run a quick latency check now to get current values
  const currentLatency: Record<string, number> = {};
  try {
    const t = Date.now();
    await db.command({ ping: 1 });
    currentLatency.db_ping = Date.now() - t;
  } catch {
    currentLatency.db_ping = -1;
  }

  try {
    const t = Date.now();
    await db.collection('books')
      .find({ visible: true, pages_count: { $gt: 0 } })
      .sort({ created_at: -1 })
      .limit(10)
      .maxTimeMS(10000)
      .project({ id: 1, title: 1 })
      .toArray();
    currentLatency.browse_query = Date.now() - t;
  } catch {
    currentLatency.browse_query = -1;
  }

  // Compute averages over different windows
  function avgDuration(entries: typeof dataPoints): number {
    if (entries.length === 0) return 0;
    const sum = entries.reduce((s, e) => s + e.duration_ms, 0);
    return Math.round(sum / entries.length);
  }

  const all24h = dataPoints;
  const last6h = dataPoints.filter(d => d.timestamp >= sixHoursAgo);
  const last1h = dataPoints.filter(d => d.timestamp >= oneHourAgo);

  const avg24h = avgDuration(all24h);
  const avg6h = avgDuration(last6h);
  const avg1h = avgDuration(last1h);
  const currentDuration = dataPoints.length > 0
    ? dataPoints[dataPoints.length - 1].duration_ms
    : 0;

  // Determine trend
  let trend: 'improving' | 'stable' | 'degrading' | 'critical' = 'stable';
  if (avg6h > 0) {
    const ratio = avg1h / avg6h;
    if (ratio > DEGRADED_MULTIPLIER) {
      trend = 'critical';
    } else if (ratio > 1.5) {
      trend = 'degrading';
    } else if (ratio < 0.7) {
      trend = 'improving';
    }
  }

  // Check for alert condition: is current check degraded?
  let alert: { message: string; since: string } | null = null;

  // Load previous trend to check consecutive degradation
  const prevTrend = await db.collection('system_config').findOne(
    { _id: 'latency_trend' as any },
    { maxTimeMS: 5000 }
  );

  const prevWasDegraded = prevTrend?.data?.trend === 'degrading' || prevTrend?.data?.trend === 'critical';

  if ((trend === 'degrading' || trend === 'critical') && prevWasDegraded) {
    const since = prevTrend?.data?.alert?.since || new Date().toISOString();
    alert = {
      message: `Health check latency ${Math.round(avg1h / avg6h * 10) / 10}x above 6h average (${avg1h}ms vs ${avg6h}ms)`,
      since,
    };

    // Send alert email
    await sendLatencyAlert(db, alert.message);
  }

  // Build history (last 50 data points for the chart)
  const history = dataPoints.slice(-50).map(d => ({
    timestamp: d.timestamp.toISOString(),
    duration_ms: d.duration_ms,
  }));

  const data = {
    current: currentLatency,
    current_check_duration: currentDuration,
    avg_1h: { duration_ms: avg1h, samples: last1h.length },
    avg_6h: { duration_ms: avg6h, samples: last6h.length },
    avg_24h: { duration_ms: avg24h, samples: all24h.length },
    trend,
    alert,
    history,
    computed_at: new Date().toISOString(),
  };

  // Store in system_config
  await db.collection('system_config').updateOne(
    { _id: 'latency_trend' as any },
    { $set: { data, updated_at: new Date() } },
    { upsert: true }
  );

  // Also log to cron_runs
  await db.collection('cron_runs').insertOne({
    cron: 'latency-trend',
    timestamp: new Date(),
    status: trend === 'critical' ? 'failed' : 'success',
    summary: `Trend: ${trend}, 1h avg: ${avg1h}ms, 6h avg: ${avg6h}ms`,
    actions: { trend, avg_1h: avg1h, avg_6h: avg6h, avg_24h: avg24h },
  });

  return NextResponse.json(data);
}

async function sendLatencyAlert(db: any, message: string) {
  // Check cooldown (reuse health_alert_state cooldown — 1h)
  try {
    const state = await db.collection('system_config').findOne(
      { _id: 'latency_alert_state' },
      { maxTimeMS: 5000 }
    );
    if (state?.last_sent_at) {
      const elapsed = Date.now() - new Date(state.last_sent_at).getTime();
      if (elapsed < 60 * 60 * 1000) return; // 1h cooldown
    }
  } catch {
    // Send anyway if can't check
  }

  if (!process.env.RESEND_API_KEY) return;

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Source Library <noreply@sourcelibrary.org>',
      to: ALERT_EMAIL,
      subject: '[WARNING] Source Library latency trending up',
      html: [
        '<h2>Latency Trend Alert</h2>',
        `<p>${message}</p>`,
        `<p><strong>Time:</strong> ${new Date().toISOString()}</p>`,
        '<p>This means the 1-hour average health check latency is significantly above the 6-hour baseline.</p>',
        '<p><a href="https://sourcelibrary.org/status">Status Page</a> | <a href="https://sourcelibrary.org/analytics">Dashboard</a></p>',
      ].join('\n'),
    });

    await db.collection('system_config').updateOne(
      { _id: 'latency_alert_state' },
      { $set: { last_sent_at: new Date(), message } },
      { upsert: true }
    ).catch(() => {});
  } catch (e) {
    console.error('[latency-trend] Failed to send alert:', e);
  }
}
