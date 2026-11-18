/**
 * PRIOR ART: scripts/workers/batch-collector.mjs writeCronRun and scripts/lib/triage-apply.mjs recordRun — each is
 * private to its own worker and shapes its own actions; sync-pages-content.mjs and enrich-worker.mjs inline the
 * insert. This is the same row, shared by the scheduler workers that wrote none (v3#428).
 *
 * One row in `cron_runs` per worker run, in the shape the readers use: /admin/pipeline (src/lib/pipeline-line.ts
 * getLineInputs) groups the last 24 h by `cron` on `timestamp` and counts `status: 'skipped'` and `failed: true`.
 * A row without `timestamp` is invisible there, which is how archive-bulk and archive-ocr read as "no run record"
 * while they wrote rows with only started_at / finished_at.
 *
 * status: 'skipped' only when a gate stopped the run before any work (a pause, the spend dial, a storage ceiling):
 * the page flags a worker that skipped every run in 24 h. A run that looked and found nothing to do is 'success'.
 */

/** Pure: the cron_runs row for one run. `start` is the run's start time (ms or Date); `now` is injectable for tests. */
export function cronRunRow({ cron, start, status, actions = {}, summary = '', errors = [], now = new Date() }) {
  if (!cron) throw new TypeError('cronRunRow: cron');
  if (!['success', 'partial', 'skipped', 'failed'].includes(status)) throw new TypeError(`cronRunRow: status ${status}`);
  const startMs = start instanceof Date ? start.getTime() : Number(start);
  return {
    cron,
    source: 'hetzner',
    timestamp: now,
    started_at: Number.isFinite(startMs) ? new Date(startMs) : null,
    finished_at: now,
    duration_ms: Number.isFinite(startMs) ? now.getTime() - startMs : null,
    status,
    failed: status === 'failed',
    actions,
    errors: errors.slice(0, 20).map((message) => ({ message: String(message), timestamp: now })),
    error_count: errors.length,
    summary: String(summary).slice(0, 300),
  };
}

/** Write one run row. Never throws: a monitoring write must not fail the worker it records. */
export async function writeCronRun(db, fields) {
  try {
    await db.collection('cron_runs').insertOne(cronRunRow(fields));
  } catch (e) {
    console.warn(`[cron-run] could not write the cron_runs row for ${fields?.cron}: ${e.message}`);
  }
}
