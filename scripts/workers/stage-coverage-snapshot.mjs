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

  const doc = {
    timestamp: new Date(),
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

  // One-line human summary — this is what the cron log shows.
  const pct = (s) =>
    s.status !== 'ok' ? 'BROKEN' : s.total ? `${((100 * s.covered) / s.total).toFixed(1)}%` : '—';
  const parts = stages.map((s) => `${s.stage} ${pct(s)}`);
  const broken = stages.filter((s) => s.status === 'probe_broken').map((s) => s.stage);
  console.log(
    `[stage-coverage] ${parts.join(' | ')} | stalled: ${stalled.length ? stalled.join(',') : 'none'}` +
      `${broken.length ? ` | PROBE BROKEN: ${broken.join(',')}` : ''}` +
      ` | dial: ${doc.dial.paused ? 'PAUSED' : 'running'} budget=$${doc.dial.daily_budget_usd ?? 'unset'}` +
      ` spend=$${doc.spend_today_usd.toFixed(2)} | gate-held=${healthBlocked ?? '?'} warn-pages=${ocrWarnings ?? '?'} | ${doc.duration_ms}ms${DRY_RUN ? ' (dry-run)' : ''}`,
  );
}, { timeoutMs: 30 * 60_000, socketTimeoutMs: 15 * 60_000 });
