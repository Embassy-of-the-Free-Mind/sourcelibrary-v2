#!/usr/bin/env node
/**
 * Daily pipeline health snapshot — pushed to ntfy.sh/sourcelibrary-uptime.
 *
 * Produces a scannable phone-friendly message covering the past 24h:
 *   📚 Library (point-in-time totals)
 *   🔄 Pipeline activity (books promoted, pages processed)
 *   🚦 Batch outcomes
 *   ⚠️  Errors / needs_attention
 *   🏥 DB health
 *   👥 Users
 *   🌐 Site health (uptime checks)
 *   🖼️  Broken-image proxy
 *
 * Usage:
 *   node scripts/workers/daily-health-snapshot.mjs            # print + push
 *   node scripts/workers/daily-health-snapshot.mjs --dry-run  # print only
 *
 * Crontab (add to Hetzner):
 *   0 8 * * * cd /root/sourcelibrary && bash -c "set -a; source .env.production.local; set +a; node scripts/workers/daily-health-snapshot.mjs" >> /var/log/sourcelibrary/daily-snapshot.log 2>&1
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const NTFY_TOPIC = 'https://ntfy.sh/sourcelibrary-uptime';
const DRY_RUN = process.argv.includes('--dry-run');

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// ---------------------------------------------------------------------------
// ntfy push (matches uptime-monitor.mjs pattern)
// ---------------------------------------------------------------------------

async function pushNtfy(title, message) {
  try {
    await fetch(NTFY_TOPIC, {
      method: 'POST',
      headers: {
        'Title': title,
        'Priority': 'default',
        'Tags': 'chart_with_upwards_trend',
      },
      body: message,
    });
    console.log('[snapshot] ntfy push sent');
  } catch (err) {
    console.error(`[snapshot] ntfy push failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n) {
  if (n == null || n === undefined) return '?';
  return Number(n).toLocaleString('en-US');
}

function pct(a, b) {
  if (!b) return '0%';
  return `${Math.round((a / b) * 100)}%`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  const client = new MongoClient(MONGODB_URI, {
    maxPoolSize: 3,
    serverSelectionTimeoutMS: 15_000,
  });

  try {
    await client.connect();
    const db = client.db('bookstore');

    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const dateLabel = now.toISOString().slice(0, 10);

    // ── 1. Library — point-in-time from analytics_usage (fast, pre-computed) ──
    const analyticsDoc = await db.collection('system_config').findOne({ _id: 'analytics_usage' });
    const analytics = analyticsDoc?.data;

    // Fallbacks: read pipeline_health_daily for today or yesterday
    const todayStr = now.toISOString().slice(0, 10);
    const yestStr = new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dailyDoc = await db.collection('pipeline_health_daily').findOne(
      { date: { $in: [todayStr, yestStr] } },
      { sort: { date: -1 } }
    );

    const totalBooks = analytics?.canon?.total_books ?? dailyDoc?.books?.total ?? '?';
    const visibleBooks = analytics?.canon?.total_books ?? '?';  // analytics_usage tracks all books with pages
    const fullyComplete = analytics?.canon?.readable_books ?? dailyDoc?.books?.translation_complete ?? '?';
    const ocrPages = analytics?.coverage?.ocr_pages ?? dailyDoc?.pages?.ocr_done ?? '?';
    const translatedPages = analytics?.coverage?.translated_pages ?? dailyDoc?.pages?.translated ?? '?';
    const totalPages = analytics?.coverage
      ? Math.round((analytics.coverage.ocr_pages / (analytics.coverage.ocr_percent / 100)) || 0)
      : dailyDoc?.pages?.total ?? '?';

    // ── 2. Pipeline activity — books promoted in last 24h ──
    const [archiveCompleteDelta, translateCompleteDelta, completeDelta] = await Promise.all([
      db.collection('books').countDocuments({
        'pipeline_auto.status': 'archive_complete',
        'pipeline_auto.updated_at': { $gte: oneDayAgo },
      }),
      db.collection('books').countDocuments({
        'pipeline_auto.status': 'translate_complete',
        'pipeline_auto.updated_at': { $gte: oneDayAgo },
      }),
      db.collection('books').countDocuments({
        'pipeline_auto.status': 'complete',
        'pipeline_auto.updated_at': { $gte: oneDayAgo },
      }),
    ]);

    // Pages OCR'd in last 24h — count via ocr.updated_at
    const pagesOcrdDelta = await db.collection('pages').countDocuments({
      'ocr.updated_at': { $gte: oneDayAgo },
    });

    // Pages translated in last 24h
    const pagesTranslatedDelta = await db.collection('pages').countDocuments({
      'translation.updated_at': { $gte: oneDayAgo },
    });

    // ── 3. Batch outcomes ──
    const [batchSaved, batchFailed] = await Promise.all([
      db.collection('batch_jobs').countDocuments({
        status: 'saved',
        completed_at: { $gte: oneDayAgo },
      }),
      db.collection('batch_jobs').countDocuments({
        status: 'failed',
        created_at: { $gte: oneDayAgo },
      }),
    ]);

    // Top error types from failed batch jobs
    let topBatchErrors = [];
    if (batchFailed > 0) {
      const errorAgg = await db.collection('batch_jobs').aggregate([
        { $match: { status: 'failed', created_at: { $gte: oneDayAgo }, error: { $exists: true } } },
        { $group: { _id: { $substr: ['$error', 0, 60] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 2 },
      ]).toArray();
      topBatchErrors = errorAgg.map(e => `  • ${e._id} (${e.count}x)`);
    }

    // ── 4. Errors / needs_attention ──
    const needsAttentionNew = await db.collection('books').countDocuments({
      'pipeline_auto.status': 'needs_attention',
      'pipeline_auto.updated_at': { $gte: oneDayAgo },
    });

    let topAttentionReasons = [];
    if (needsAttentionNew > 0) {
      const reasonAgg = await db.collection('books').aggregate([
        {
          $match: {
            'pipeline_auto.status': 'needs_attention',
            'pipeline_auto.updated_at': { $gte: oneDayAgo },
            'pipeline_auto.attention_reason': { $exists: true },
          },
        },
        { $group: { _id: { $substr: ['$pipeline_auto.attention_reason', 0, 50] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 2 },
      ]).toArray();
      topAttentionReasons = reasonAgg.map(r => `  • ${r._id} (${r.count}x)`);
    }

    // Failed/partial crons in last 24h
    const failedCrons = await db.collection('cron_runs').find(
      {
        timestamp: { $gte: oneDayAgo },
        $or: [{ status: { $in: ['failed', 'partial_failure'] } }, { failed: true }],
      },
      { projection: { cron: 1, status: 1 } }
    ).toArray();

    const failedCronNames = [...new Set(failedCrons.map(c => c.cron))];

    // ── 5. DB health ──
    const adaptiveLimits = await db.collection('system_config').findOne({ _id: 'adaptive_limits' });
    const dbGrade = adaptiveLimits?.health?.grade ?? 'unknown';
    const dbMeasuredAt = adaptiveLimits?.health?.measured_at
      ? new Date(adaptiveLimits.health.measured_at).toISOString().slice(11, 16) + ' UTC'
      : '?';

    // Get fresh probe (lightweight find + count)
    let findMs = '?';
    let countMs = '?';
    try {
      const t1 = Date.now();
      await db.collection('books').findOne({ visible: true }, { projection: { _id: 1 } });
      findMs = Date.now() - t1;

      const t2 = Date.now();
      await db.collection('books').find({ visible: true, pages_count: { $gt: 0 } }).limit(10).project({ _id: 1 }).toArray();
      countMs = Date.now() - t2;
    } catch {
      // leave as '?'
    }

    // ── 6. Users — analytics_usage has session/visitor data if tracked ──
    // sync-worker writes analytics_usage with pipelineFunnel and coverage
    // It does NOT track user sessions — those would come from a web analytics source.
    // Gemini usage gives a proxy for AI activity.
    const geminiToday = await db.collection('gemini_usage_daily').findOne({ date: todayStr });
    const geminiYest = await db.collection('gemini_usage_daily').findOne({ date: yestStr });
    // Prefer yesterday's COMPLETE day over today's partial one (today is still
    // accumulating, so its total would read as a near-zero floor). The printed
    // line includes the date, so the chosen day stays visible.
    const geminiDoc = geminiYest || geminiToday;

    let userLine = 'User sessions: not tracked (no web analytics in DB)';
    if (geminiDoc) {
      const cost = geminiDoc.totalCost?.toFixed(4) ?? '?';
      const calls = geminiDoc.totalRecords ?? '?';
      userLine = `Gemini API: ${fmt(calls)} calls, $${cost} (${geminiDoc.date})`;
    }

    // ── 7. Site health — uptime_checks last 24h ──
    const uptimeChecks = await db.collection('uptime_checks').find(
      { checked_at: { $gte: oneDayAgo } },
      { projection: { endpoint: 1, ok: 1, warm_ms: 1, latency_ms: 1 } }
    ).toArray();

    const uptimeByEndpoint = {};
    for (const c of uptimeChecks) {
      if (!uptimeByEndpoint[c.endpoint]) uptimeByEndpoint[c.endpoint] = { ok: 0, total: 0, warmMs: [] };
      uptimeByEndpoint[c.endpoint].total++;
      if (c.ok) uptimeByEndpoint[c.endpoint].ok++;
      const ms = c.warm_ms ?? c.latency_ms;
      if (ms != null) uptimeByEndpoint[c.endpoint].warmMs.push(ms);
    }

    const endpointOrder = ['health', 'api', 'embed_bph', 'embed_ficino', 'embed_bhutan'];
    const uptimeLines = endpointOrder
      .filter(ep => uptimeByEndpoint[ep])
      .map(ep => {
        const e = uptimeByEndpoint[ep];
        const rate = e.total > 0 ? Math.round((e.ok / e.total) * 100) : 0;
        const avgMs = e.warmMs.length > 0
          ? Math.round(e.warmMs.reduce((a, b) => a + b, 0) / e.warmMs.length)
          : null;
        const msStr = avgMs != null ? ` avg ${avgMs}ms` : '';
        const icon = rate === 100 ? '✓' : rate >= 90 ? '~' : '✗';
        return `  ${icon} ${ep}: ${rate}%${msStr}`;
      });

    if (uptimeLines.length === 0) uptimeLines.push('  No uptime checks found in last 24h');

    // ── 8. Broken-image proxy ──
    const brokenImages = await db.collection('pages').countDocuments({
      $or: [
        { 'archive_metadata.failure_count': { $gt: 0 }, 'archive_metadata.last_failure_at': { $gte: oneDayAgo } },
        { 'archive_metadata.blocked': true, 'archive_metadata.last_failure_at': { $gte: oneDayAgo } },
      ],
    });

    // ── Assemble message ──
    const lines = [];

    // Header summary line (shows in phone notification preview)
    const summaryParts = [];
    if (typeof pagesTranslatedDelta === 'number' && pagesTranslatedDelta > 0) {
      summaryParts.push(`${fmt(pagesTranslatedDelta)} pages translated`);
    }
    if (typeof pagesOcrdDelta === 'number' && pagesOcrdDelta > 0) {
      summaryParts.push(`${fmt(pagesOcrdDelta)} OCR'd`);
    }
    if (completeDelta > 0) summaryParts.push(`${completeDelta} books complete`);
    const summaryStr = summaryParts.length > 0 ? summaryParts.join(' · ') : 'No major pipeline activity';
    lines.push(summaryStr);
    lines.push('');

    // Library
    lines.push('📚 Library');
    lines.push(`  Books: ${fmt(totalBooks)} total, ${fmt(fullyComplete)} fully done`);
    lines.push(`  Pages: ${fmt(ocrPages)} OCR'd, ${fmt(translatedPages)} translated`);
    if (analytics?.coverage) {
      lines.push(`  Coverage: ${analytics.coverage.ocr_percent}% OCR, ${analytics.coverage.translated_percent}% translated`);
    }

    // Pipeline activity
    lines.push('');
    lines.push('🔄 Last 24h pipeline');
    lines.push(`  Archive complete: ${archiveCompleteDelta}`);
    lines.push(`  Translate complete: ${translateCompleteDelta}`);
    lines.push(`  Fully complete: ${completeDelta}`);
    lines.push(`  Pages OCR'd: ${fmt(pagesOcrdDelta)}`);
    lines.push(`  Pages translated: ${fmt(pagesTranslatedDelta)}`);

    // Batch outcomes
    lines.push('');
    lines.push('🚦 Batch jobs (24h)');
    lines.push(`  Saved: ${batchSaved}  Failed: ${batchFailed}`);
    if (topBatchErrors.length > 0) {
      lines.push('  Top errors:');
      lines.push(...topBatchErrors);
    }

    // Errors / needs_attention
    lines.push('');
    lines.push('⚠️ Errors');
    lines.push(`  needs_attention (new): ${needsAttentionNew}`);
    if (topAttentionReasons.length > 0) lines.push(...topAttentionReasons);
    if (failedCronNames.length > 0) {
      lines.push(`  Failed crons: ${failedCronNames.join(', ')}`);
    } else {
      lines.push('  Crons: all OK');
    }

    // DB health
    lines.push('');
    lines.push('🏥 DB health');
    lines.push(`  Grade: ${dbGrade} (last checked ${dbMeasuredAt})`);
    lines.push(`  find: ${findMs}ms  browse: ${countMs}ms`);

    // Users
    lines.push('');
    lines.push('👥 Activity');
    lines.push(`  ${userLine}`);

    // Site health
    lines.push('');
    lines.push('🌐 Site (24h)');
    lines.push(...uptimeLines);

    // Broken images
    lines.push('');
    lines.push('🖼️ Images');
    lines.push(`  Archive failures (24h): ${brokenImages}`);

    const message = lines.join('\n');
    // Title must be ASCII (HTTP header constraint) — emoji and em-dash belong in body / Tags.
    const title = `Daily snapshot - ${dateLabel}`;

    console.log(`\n${title}\n${'─'.repeat(40)}`);
    console.log(message);
    console.log('─'.repeat(40));

    if (DRY_RUN) {
      console.log('[snapshot] --dry-run: not pushing to ntfy');
    } else {
      await pushNtfy(title, message);
    }

    await client.close();
  } catch (err) {
    console.error('[snapshot] Fatal:', err);
    await client.close().catch(() => {});
    process.exit(1);
  }
}

run();
