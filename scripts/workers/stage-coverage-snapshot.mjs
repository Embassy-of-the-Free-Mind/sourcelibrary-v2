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
import { measureAllStages, computeStageDeltas, findStalled, buildAlertPushes, formatSummaryLine } from '../lib/stage-coverage.mjs';
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
  // A broken probe (the instrument) and a stalled stage (the pipeline) go out
  // as separate pushes and are never counted together (#359).
  const collectorAgeMs = collectorLastRun?.timestamp ? Date.now() - new Date(collectorLastRun.timestamp).getTime() : Infinity;
  for (const push of buildAlertPushes({ stages, stalled, collectorAgeHours: collectorAgeMs / 3600000, agingUncollected })) {
    await pushNtfy(push.title, push.body, push.priority);
  }

  // One-line human summary — this is what the cron log shows.
  // NOTE: #3794 described a `sensors` block (health-gate-held pages, OCR
  // warning-page count) but only the log line landed; it referenced two
  // undeclared names and threw a ReferenceError here every night from
  // 2026-08-08 until #4702. If the sensors are built, add them to `doc` first.
  console.log(formatSummaryLine(doc, { dryRun: DRY_RUN }));
}, { timeoutMs: 30 * 60_000, socketTimeoutMs: 15 * 60_000 });
