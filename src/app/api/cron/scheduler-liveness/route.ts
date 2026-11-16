import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyCronAuth } from '@/lib/cron-auth';
import {
  WITNESSES,
  judgeSchedulerLiveness,
  alertAction,
  type AlertState,
  type LivenessResult,
} from '@/lib/scheduler-liveness';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

/**
 * Off-box watchdog for the main box's cron.service (v2#4528).
 *
 * Runs as a VERCEL cron, deliberately: every other check on the pipeline is a crontab line on the
 * box it watches, so when cron.service died on 2026-08-31 they all died with it and the outage ran
 * 25 hours unnoticed. A Vercel outage does not stop the box's cron, and the box dying does not stop
 * this route, so the two cannot fail silently together.
 *
 * Pages ntfy (the same `sourcelibrary-uptime` topic the box alarms use) and emails ALERT_EMAIL.
 * "Could not measure" pages too: an unreachable database must never read as a quiet pipeline.
 * Judge and cooldown rules: src/lib/scheduler-liveness.ts.
 */

const NTFY_TOPIC = 'https://ntfy.sh/sourcelibrary-uptime';
const ALERT_EMAIL = process.env.ALERT_EMAIL || 'derek@sourcelibrary.org';
const STATE_ID = 'scheduler_liveness_alert_state';

type PageTag = 'rotating_light' | 'warning' | 'white_check_mark' | 'test_tube';

async function page(title: string, body: string, priority: 'high' | 'default', tag: PageTag) {
  const sent: string[] = [];
  try {
    const res = await fetch(NTFY_TOPIC, {
      method: 'POST',
      headers: { Title: title, Priority: priority, Tags: tag },
      body: `${body}\nsrc: /api/cron/scheduler-liveness@vercel`,
    });
    if (res.ok) sent.push('ntfy');
  } catch (e) {
    console.error('[scheduler-liveness] ntfy failed:', e);
  }
  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = await import('resend');
      await new Resend(process.env.RESEND_API_KEY).emails.send({
        from: 'Source Library <noreply@sourcelibrary.org>',
        to: ALERT_EMAIL,
        subject: title,
        text: body,
      });
      sent.push('email');
    } catch (e) {
      console.error('[scheduler-liveness] email failed:', e);
    }
  }
  return sent;
}

function describe(result: LivenessResult) {
  const lines = result.witnesses.map(
    (w) =>
      `  ${w.stale ? 'STALE' : 'ok   '} ${w.cron}: ${w.lastRun ? `${w.lastRun.toISOString()} (${w.ageMin}min ago)` : 'no row in cron_runs'}`,
  );
  return [result.summary, '', ...lines].join('\n');
}

export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;
  const now = new Date();

  // Positive control: `?test=1` sends one labelled page through the same channels and judges nothing.
  // Run it once after a release, so "no page" can be read as "cron is alive" and not "delivery is broken".
  if (request.nextUrl.searchParams.get('test') === '1') {
    const sent = await page(
      '[TEST] scheduler-liveness can page',
      'Test page from the off-box cron watchdog. Nothing is wrong; this proves delivery works (v2#4528).',
      'default',
      'test_tube',
    );
    return NextResponse.json({ test: true, sent }, { status: sent.length > 0 ? 200 : 502 });
  }

  let db;
  const lastRuns: Record<string, Date | null> = {};
  try {
    db = await getDb();
    for (const w of WITNESSES) {
      const row = await db
        .collection('cron_runs')
        .find({ cron: w.cron }, { projection: { timestamp: 1 } })
        .sort({ timestamp: -1 })
        .limit(1)
        .maxTimeMS(10000)
        .next();
      lastRuns[w.cron] = row?.timestamp ? new Date(row.timestamp) : null;
    }
  } catch (e) {
    // Could not measure. Nowhere to keep a cooldown, so page every run (hourly) until it reads again.
    const msg = e instanceof Error ? e.message : String(e);
    const sent = await page(
      '[scheduler-liveness] could not read cron_runs',
      `The off-box watchdog for the main box's cron could not read cron_runs: ${msg}\nThe pipeline's liveness is UNKNOWN, not healthy.`,
      'high',
      'rotating_light',
    );
    return NextResponse.json({ verdict: 'unknown', error: msg, sent }, { status: 503 });
  }

  const result = judgeSchedulerLiveness(lastRuns, now);

  let prev: AlertState | null = null;
  try {
    prev = (await db.collection('system_config').findOne({ _id: STATE_ID as never }, { maxTimeMS: 5000 })) as AlertState | null;
  } catch {
    // Cannot read the cooldown: treat as no prior state, which pages on a bad verdict. Double-paging beats silence.
  }

  const action = alertAction(result.verdict, prev, now);
  let sent: string[] = [];
  if (action === 'page') {
    sent = await page(
      result.verdict === 'dead'
        ? '[CRITICAL] Main box cron is not running'
        : '[WARNING] A cron on the main box has gone quiet',
      `${describe(result)}\n\nCheck: systemctl status cron; journalctl -u cron --since -3h; dmesg | grep -i oom (v2#4528)`,
      result.verdict === 'dead' ? 'high' : 'default',
      result.verdict === 'dead' ? 'rotating_light' : 'warning',
    );
  } else if (action === 'recovered') {
    sent = await page('[RECOVERED] Main box cron is reporting again', describe(result), 'default', 'white_check_mark');
  }

  // A page that reached nobody is not a page: leave the stored verdict and cooldown untouched, so the
  // next run sees the same change and tries again instead of sitting silent for the whole cooldown.
  const delivered = action === 'none' || sent.length > 0;
  if (!delivered) console.error('[scheduler-liveness] page not delivered on any channel; will retry next run');

  try {
    if (delivered && (action !== 'none' || prev?.last_verdict !== result.verdict)) {
      await db.collection('system_config').updateOne(
        { _id: STATE_ID as never },
        {
          $set: {
            last_verdict: result.verdict,
            ...(action !== 'none' ? { last_sent_at: now, last_sent_via: sent } : {}),
            last_summary: result.summary,
            updated_at: now,
          },
        },
        { upsert: true },
      );
    }
    await db.collection('cron_runs').insertOne({
      cron: 'scheduler-liveness',
      timestamp: now,
      duration_ms: Date.now() - now.getTime(),
      status: result.verdict === 'alive' ? 'success' : 'failed',
      failed: result.verdict !== 'alive',
      actions: { stale: result.witnesses.filter((w) => w.stale).length, paged: action === 'page' ? 1 : 0 },
      errors: [],
      error_count: 0,
      summary: result.summary,
    });
  } catch (e) {
    console.error('[scheduler-liveness] could not record state:', e);
  }

  return NextResponse.json({ verdict: result.verdict, action, sent, witnesses: result.witnesses, summary: result.summary });
}
