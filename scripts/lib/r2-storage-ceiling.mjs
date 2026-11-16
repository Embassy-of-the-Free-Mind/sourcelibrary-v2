/**
 * r2-storage-ceiling — the storage budget every R2 image writer asks before it writes.
 *
 * PRIOR ART: scripts/lib/pause.mjs — the per-step brake (`archive`), a switch a human
 * flips; this is the standing budget that flips itself. scripts/maintenance/
 * rearchive-fullres-waves.sh `over_cap` — a per-sweep cap on KB added per PAGE, which
 * bounds one sweep's rate, never the bucket's total. archive-lanes.json `box_page_budget`
 * — pages in flight, a MEMORY budget, not money. None of the three caps the bucket.
 *
 * WHY. R2 storage is billed forever at $0.015/GB-month and is the only cost line that
 * grows on its own. Every approval was given in $/month (+$250 #4404, +$40 #5457), but no
 * writer knew the number: the bucket went 27.8 TB → 40.9 TB between 2026-10-01 and
 * 2026-11-12 (~630 GB/day in November) with nothing to stop it at the approved total.
 *
 * WHAT IT READS. `system_config.storage_stats.r2[]` (bucket `sourcelibrary`), written
 * nightly by /api/cron/storage-stats from Cloudflare's own analytics. The measurement
 * lags by up to a day, so the bucket can overshoot by one day's writes (~0.6 TB ≈ $9/mo
 * at the November rate). That is the price of not listing 100M objects per check.
 *
 * FAILS CLOSED. No reading, or a reading older than MAX_AGE_HOURS, refuses: a budget that
 * passes when its meter is broken is not a budget (spend-controls.md). The refusal says
 * which, so a stale meter reads as a stale meter and not as "over budget".
 *
 * TO RAISE IT, add an approval to r2-storage-ceiling.json in a PR. The ceiling is the
 * sum of that file, so the number carries its provenance.
 */
import { readFileSync } from 'fs';

export const BUCKET = 'sourcelibrary';
export const MAX_AGE_HOURS = 36;
const CONFIG_URL = new URL('./r2-storage-ceiling.json', import.meta.url);

/** The ceiling in bytes: the measured baseline plus every approval, at $/GB-month. */
export function ceilingBytes(config = JSON.parse(readFileSync(CONFIG_URL, 'utf8'))) {
  const perGB = config.usd_per_gb_month;
  const added = config.approvals.reduce((s, a) => s + (a.usd_per_month / perGB) * 1e9, 0);
  return Math.round(config.baseline.bytes + added);
}

/**
 * Pure verdict, for tests and for callers that already hold the snapshot.
 * @returns {{ ok: boolean, reason: string, bytes: number|null, ceiling: number }}
 */
export function ceilingVerdict(stats, { ceiling = ceilingBytes(), now = Date.now() } = {}) {
  const tb = (n) => `${(n / 1e12).toFixed(2)} TB`;
  const row = Array.isArray(stats?.r2) ? stats.r2.find((r) => r.bucket === BUCKET) : null;
  const at = Date.parse(stats?.updatedAt ?? '');
  if (!row || !Number.isFinite(row.bytes)) {
    return { ok: false, bytes: null, ceiling, reason: `R2 ceiling: no reading for bucket ${BUCKET} in system_config.storage_stats — refusing (meter broken, not over budget)` };
  }
  if (!Number.isFinite(at) || now - at > MAX_AGE_HOURS * 3600e3) {
    const age = Number.isFinite(at) ? `${((now - at) / 3600e3).toFixed(0)} h old` : 'undated';
    return { ok: false, bytes: row.bytes, ceiling, reason: `R2 ceiling: storage reading is ${age} (limit ${MAX_AGE_HOURS} h) — refusing until /api/cron/storage-stats runs again (meter stale, not over budget)` };
  }
  if (row.bytes >= ceiling) {
    return { ok: false, bytes: row.bytes, ceiling, reason: `R2 ceiling REACHED: bucket ${BUCKET} is ${tb(row.bytes)}, ceiling ${tb(ceiling)} (scripts/lib/r2-storage-ceiling.json). Raise it with a new approval there, or free space.` };
  }
  return { ok: true, bytes: row.bytes, ceiling, reason: `R2 ceiling: ${tb(row.bytes)} of ${tb(ceiling)} (${tb(ceiling - row.bytes)} left)` };
}

/** Read the snapshot from Mongo and judge it. `db` is the `bookstore` Db. */
export async function checkR2Ceiling(db, opts = {}) {
  const stats = await db.collection('system_config').findOne({ _id: 'storage_stats' }, { projection: { r2: 1, updatedAt: 1 } });
  return ceilingVerdict(stats, opts);
}

/** Exit code a writer uses when the ceiling (or its meter) refuses. Lanes sleep on it. */
export const CEILING_EXIT = 4;
