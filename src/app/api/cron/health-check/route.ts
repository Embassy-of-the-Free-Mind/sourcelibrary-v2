import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 30;
export const preferredRegion = 'fra1';

const ALERT_EMAIL = process.env.ALERT_EMAIL || 'derek@sourcelibrary.org';
const THRESHOLDS = {
  ping: 500,        // ms — DB ping should be <100ms, 500ms is alarm-worthy
  findOne: 1000,    // ms
  zombieJobs: 5,    // more than this many zombie jobs = problem
  zombieAge: 2 * 60 * 60 * 1000, // 2h — matches pipeline cron threshold
};

// Cooldown: don't send more than 1 alert per hour
const COOLDOWN_MS = 60 * 60 * 1000;

interface HealthIssue {
  check: string;
  detail: string;
  severity: 'warning' | 'critical';
}

export async function GET() {
  const issues: HealthIssue[] = [];
  const t0 = Date.now();

  // 1. DB connectivity + latency
  let db;
  try {
    db = await getDb();
    const t1 = Date.now();
    await db.command({ ping: 1 });
    const pingMs = Date.now() - t1;
    if (pingMs > THRESHOLDS.ping) {
      issues.push({ check: 'ping', detail: `${pingMs}ms (threshold: ${THRESHOLDS.ping}ms)`, severity: 'critical' });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    issues.push({ check: 'db_connect', detail: msg, severity: 'critical' });
    // Can't do any more checks without DB
    await sendAlertIfNeeded(null, issues);
    return NextResponse.json({ status: 'down', issues, duration_ms: Date.now() - t0 }, { status: 503 });
  }

  // 2. Collection read latency
  try {
    const t2 = Date.now();
    await db.collection('books').findOne({}, { projection: { id: 1 }, maxTimeMS: 5000 } as any);
    const findMs = Date.now() - t2;
    if (findMs > THRESHOLDS.findOne) {
      issues.push({ check: 'books_findOne', detail: `${findMs}ms (threshold: ${THRESHOLDS.findOne}ms)`, severity: 'warning' });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    issues.push({ check: 'books_findOne', detail: `Failed: ${msg}`, severity: 'critical' });
  }

  // 3. Zombie jobs (processing > 2h)
  try {
    const zombieThreshold = new Date(Date.now() - THRESHOLDS.zombieAge);
    const zombies = await db.collection('jobs')
      .find(
        { status: 'processing', updated_at: { $lt: zombieThreshold } },
        { projection: { type: 1, book_id: 1, progress: 1 } }
      )
      .maxTimeMS(10000)
      .toArray();

    if (zombies.length > THRESHOLDS.zombieJobs) {
      const byType: Record<string, number> = {};
      for (const z of zombies) byType[z.type] = (byType[z.type] || 0) + 1;
      const summary = Object.entries(byType).map(([t, c]) => `${t}:${c}`).join(', ');
      issues.push({ check: 'zombie_jobs', detail: `${zombies.length} zombie jobs (${summary})`, severity: 'warning' });
    }
  } catch {
    // Non-critical — skip if query times out
  }

  // 4. Atlas Search index status
  try {
    const indexes = await db.collection('books').listSearchIndexes().toArray();
    const notReady = indexes.filter((idx: any) => idx.status !== 'READY');
    if (notReady.length > 0) {
      const detail = notReady.map((idx: any) => `${idx.name}:${idx.status}`).join(', ');
      issues.push({ check: 'search_indexes', detail: `Not ready: ${detail}`, severity: 'warning' });
    }
  } catch {
    // Non-critical
  }

  // 5. Cron health — any cron not running in last 30 min?
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const recentCrons = await db.collection('cron_runs')
      .aggregate([
        { $match: { timestamp: { $gte: twoHoursAgo } } },
        { $group: { _id: '$cron', lastRun: { $max: '$timestamp' }, failures: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } } } },
      ], { maxTimeMS: 10000 })
      .toArray();

    // Check if pipeline cron is missing (runs hourly, should appear in 2h window)
    const pipelineCron = recentCrons.find(c => c._id === 'post-import-pipeline');
    if (!pipelineCron) {
      issues.push({ check: 'cron_missing', detail: 'post-import-pipeline has not run in 2 hours', severity: 'warning' });
    }

    // Check for high failure rate
    for (const cron of recentCrons) {
      if (cron.failures >= 3) {
        issues.push({ check: 'cron_failures', detail: `${cron._id}: ${cron.failures} failures in last 30 min`, severity: 'warning' });
      }
    }
  } catch {
    // Non-critical
  }

  const duration = Date.now() - t0;
  const status = issues.some(i => i.severity === 'critical') ? 'down' : issues.length > 0 ? 'degraded' : 'healthy';

  // Log to cron_runs for dashboard visibility
  try {
    await db.collection('cron_runs').insertOne({
      cron: 'health-check',
      timestamp: new Date(),
      duration_ms: duration,
      status: status === 'healthy' ? 'success' : status === 'degraded' ? 'partial' : 'failed',
      failed: status === 'down',
      actions: { issues_found: issues.length },
      errors: issues.map(i => `[${i.severity}] ${i.check}: ${i.detail}`),
      error_count: issues.length,
      summary: status === 'healthy' ? `Healthy (${duration}ms)` : `${status}: ${issues.map(i => i.check).join(', ')}`,
    });
  } catch {
    // Can't log — DB might be the problem
  }

  // Send alert email if degraded/down
  if (issues.length > 0) {
    await sendAlertIfNeeded(db, issues);
  }

  const httpStatus = status === 'down' ? 503 : status === 'degraded' ? 200 : 200;
  return NextResponse.json({ status, issues, duration_ms: duration }, { status: httpStatus });
}

async function sendAlertIfNeeded(db: any, issues: HealthIssue[]) {
  // Check cooldown — don't spam
  if (db) {
    try {
      const lastAlert = await db.collection('system_config').findOne(
        { _id: 'health_alert_state' },
        { maxTimeMS: 5000 }
      );
      if (lastAlert?.last_sent_at) {
        const elapsed = Date.now() - new Date(lastAlert.last_sent_at).getTime();
        if (elapsed < COOLDOWN_MS) return;
      }
    } catch {
      // If we can't check cooldown, send anyway — better to double-alert than miss one
    }
  }

  if (!process.env.RESEND_API_KEY) return;

  const hasCritical = issues.some(i => i.severity === 'critical');
  const subject = hasCritical
    ? `[CRITICAL] Source Library DB is down`
    : `[WARNING] Source Library health issues detected`;

  const body = [
    `<h2>Health Check Alert</h2>`,
    `<p><strong>Time:</strong> ${new Date().toISOString()}</p>`,
    `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">`,
    `<tr><th>Check</th><th>Severity</th><th>Detail</th></tr>`,
    ...issues.map(i => `<tr><td>${i.check}</td><td style="color:${i.severity === 'critical' ? 'red' : 'orange'}">${i.severity}</td><td>${i.detail}</td></tr>`),
    `</table>`,
    `<p style="margin-top:16px"><a href="https://sourcelibrary.org/analytics">Dashboard</a></p>`,
  ].join('\n');

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Source Library <noreply@sourcelibrary.org>',
      to: ALERT_EMAIL,
      subject,
      html: body,
    });

    // Record cooldown
    if (db) {
      await db.collection('system_config').updateOne(
        { _id: 'health_alert_state' },
        { $set: { last_sent_at: new Date(), last_issues: issues } },
        { upsert: true }
      ).catch(() => {});
    }
  } catch (e) {
    console.error('[health-check] Failed to send alert:', e);
  }
}
