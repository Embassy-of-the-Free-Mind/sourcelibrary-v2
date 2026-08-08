#!/usr/bin/env node
/**
 * stage-coverage-snapshot — the nightly semantic monitoring job (#3756 §B).
 *
 * Runs every stage measurement in scripts/lib/stage-coverage.mjs (coverage
 * computed from DATA — rows and fields — never job counters), compares
 * against the previous snapshot, and writes one timeseries doc to
 * `stage_coverage_snapshots`:
 *
 *   {
 *     timestamp,
 *     stages: [{ stage, status, covered, total, queue_depth, delta, detail? }],
 *     stalled: [stage...],        // queue_depth > 0 and delta === 0 (I54 detector)
 *     dial: { paused, daily_budget_usd },
 *     spend_today_usd, spend_rows, spend_costless_rows,
 *     collector_last_run: { cron, timestamp, status } | null,
 *   }
 *
 * The /platform/admin/line page and /api/admin/line read this collection.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *     node scripts/workers/stage-coverage-snapshot.mjs
 *   node scripts/workers/stage-coverage-snapshot.mjs --dry-run   # print, don't write
 */

import { withMongo } from '../lib/mongo.mjs';
import { measureAllStages, computeStageDeltas, findStalled } from '../lib/stage-coverage.mjs';
import { getTodaySpendUsd, readDailyBudgetUsd } from '../lib/spend-guard.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const NO_PUSH = process.argv.includes('--no-push');

// Same ntfy topic as traffic-anomaly / uptime — the channel Derek actually
// reads. Deliberately NOT email: the gemini_key_drift alarm emailed itself
// daily for weeks unread. An alert nobody sees is a dead instrument (the
// archaeology's core finding: zero expensive incidents were caught by
// monitoring).
const NTFY_TOPIC = 'https://ntfy.sh/sourcelibrary-uptime';
async function pushNtfy(title, message, priority = 'high') {
  if (NO_PUSH || DRY_RUN) return;
  try {
    await fetch(NTFY_TOPIC, {
      method: 'POST',
      headers: { Title: title, Priority: priority, Tags: 'factory' },
      body: message,
    });
    console.log('[stage-coverage] ntfy push sent: ' + title);
  } catch (err) {
    console.error('[stage-coverage] ntfy push failed: ' + err.message);
  }
}

/** Latest cron_runs row for the batch collector, whichever writer named it. */
async function getCollectorLastRun(db) {
  const row = await db
    .collection('cron_runs')
    .find(
      { cron: { $in: ['batch-collector-worker', 'collect-batch', 'collect-batch-results'] } },
      { projection: { cron: 1, timestamp: 1, finished_at: 1, status: 1, summary: 1 } },
    )
    .sort({ timestamp: -1 })
    .limit(1)
    .maxTimeMS(30_000)
    .next();
  if (!row) return null;
  return {
    cron: row.cron,
    // batch-collector-worker writes `timestamp`; older archive-style writers
    // use `finished_at` — take whichever exists.
    timestamp: row.timestamp || row.finished_at || null,
    status: row.status || null,
  };
}

await withMongo(async (db) => {
  const started = Date.now();

  const [rawStages, control, spend, collectorLastRun, previous] = await Promise.all([
    measureAllStages(db),
    db.collection('system_config').findOne({ _id: 'processing_control' }),
    getTodaySpendUsd(db),
    getCollectorLastRun(db),
    db.collection('stage_coverage_snapshots').find({}).sort({ timestamp: -1 }).limit(1).next(),
  ]);

  const stages = computeStageDeltas(rawStages, previous?.stages);
  const stalled = findStalled(stages);

  // The two failure classes with the worst history (submit/collect asymmetry;
  // see incident record class 3): a dead collector, and paid batches aging
  // toward Gemini's ~2-day output discard while uncollected.
  const staleBatchCutoff = new Date(Date.now() - 24 * 3600 * 1000);
  const agingUncollected = await db.collection('batch_jobs').countDocuments({
    child_job_ids: { $exists: false },
    collection_abandoned: { $ne: true },
    results_collected: { $ne: true },
    status: { $in: ['pending', 'processing', 'completed', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING', 'JOB_STATE_SUCCEEDED'] },
    created_at: { $lt: staleBatchCutoff },
  }, { maxTimeMS: 60_000 }).catch(() => null);

  const doc = {
    timestamp: new Date(),
    aging_uncollected_batches: agingUncollected,
    stages,
    stalled,
    dial: {
      paused: !!control?.paused,
      daily_budget_usd: readDailyBudgetUsd(control),
    },
    spend_today_usd: spend.usd,
    spend_rows: spend.rows,
    spend_costless_rows: spend.costlessRows,
    collector_last_run: collectorLastRun,
    duration_ms: Date.now() - started,
  };

  if (DRY_RUN) {
    console.log(JSON.stringify(doc, null, 2));
  } else {
    await db.collection('stage_coverage_snapshots').insertOne(doc);
  }

  // ── Alerts: push only what someone would act on ──
  const alerts = [];
  const broken = stages.filter((s) => s.status === 'probe_broken').map((s) => s.stage);
  if (stalled.length) alerts.push(`STALLED (queue>0, no progress since last snapshot): ${stalled.join(', ')}`);
  if (broken.length) alerts.push(`PROBE BROKEN (do not trust these rows): ${broken.join(', ')}`);
  const collectorAgeMs = collectorLastRun?.timestamp ? Date.now() - new Date(collectorLastRun.timestamp).getTime() : Infinity;
  if (collectorAgeMs > 2 * 3600 * 1000) alerts.push(`Batch collector last ran ${collectorLastRun?.timestamp ? Math.round(collectorAgeMs / 3600000) + 'h ago' : 'NEVER'} (cron is every 30min)`);
  if (typeof agingUncollected === 'number' && agingUncollected > 0) alerts.push(`${agingUncollected} paid batch job(s) uncollected >24h — Gemini discards output at ~2 days`);
  if (alerts.length) {
    await pushNtfy('Pipeline line: ' + (stalled.length + broken.length + (agingUncollected || 0)) + ' issue(s)',
      alerts.join('\n') + '\n\nsourcelibrary.org/platform/admin/line', 'high');
  }

  // One-line human summary — this is what the cron log shows.
  const pct = (s) =>
    s.status !== 'ok' ? 'BROKEN' : s.total ? `${((100 * s.covered) / s.total).toFixed(1)}%` : '—';
  const parts = stages.map((s) => `${s.stage} ${pct(s)}`);
  
  console.log(
    `[stage-coverage] ${parts.join(' | ')} | stalled: ${stalled.length ? stalled.join(',') : 'none'}` +
      `${broken.length ? ` | PROBE BROKEN: ${broken.join(',')}` : ''}` +
      ` | dial: ${doc.dial.paused ? 'PAUSED' : 'running'} budget=$${doc.dial.daily_budget_usd ?? 'unset'}` +
      ` spend=$${doc.spend_today_usd.toFixed(2)} | ${doc.duration_ms}ms${DRY_RUN ? ' (dry-run)' : ''}`,
  );
}, { timeoutMs: 30 * 60_000, socketTimeoutMs: 15 * 60_000 });
