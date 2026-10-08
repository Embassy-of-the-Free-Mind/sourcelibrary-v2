/**
 * The ONE way to mark a `batch_jobs` row cancelled / failed / expired (#6276).
 *
 * PRIOR ART: scripts/workers/lib/batch-reconcile.mjs probeBatchJob() — the per-key batches.get
 * probe whose verdict this helper demands as evidence (reused, not copied); its ghost write was
 * the one terminal write that already asked Gemini first (#4889). scripts/lib/batch-job-filters.mjs
 * — the named/nameless definition, reused for the nameless path. Before this file, at least eight
 * code paths wrote those statuses directly, each with its own idea of "dead", and three of them
 * lost paid work: #4889 (false ghosts), #4839 (rollback into a second dispatch), #6238
 * (emergency stop). The collector never selects a terminal row again, so a wrong terminal label
 * is a silent, permanent loss of a job Google has already billed.
 *
 * The rule:
 *   - A row with NO Gemini job name never reached Gemini; ending it costs nothing.
 *     endNamelessBatchJobs() writes only rows that are still nameless at write time.
 *   - A row WITH a name may be ended only on Gemini's own word about that job:
 *       batches.get answered on some key, state FAILED / CANCELLED / EXPIRED   → write
 *       batches.get answered 404 on EVERY key (attempts == keys)               → write
 *       state SUCCEEDED                                                       → route to collection
 *       PENDING / RUNNING / any other state, a key that errored, no probe     → refuse
 *     A row whose output was already collected (results_collected: true) is not paid work at
 *     risk and may be ended without asking.
 *
 * tests/unit/end-batch-job.test.ts drives every branch; tests/unit/batch-job-terminal-writes.test.ts
 * fails on any new direct write of these statuses to batch_jobs outside this file.
 */

import { probeBatchJob } from '../workers/lib/batch-reconcile.mjs';
import { COLLECTABLE_BATCH_STATUSES } from './batch-job-filters.mjs';

export const LOSS_STATUSES = Object.freeze(['cancelled', 'failed', 'expired']);
/** Gemini states after which no output will ever exist to collect. */
export const GEMINI_DEAD_STATES = new Set(['JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED']);
export const GEMINI_SUCCEEDED = 'JOB_STATE_SUCCEEDED';
/** What a SUCCEEDED job is routed to: a status the collector selects (collectableBatchJobsFilter). */
export const ROUTE_TO_COLLECTION_STATUS = 'pending';

/** The REST API says BATCH_STATE_*, the SDK JOB_STATE_*; one vocabulary here. */
export function normalizeGeminiState(state) {
  return String(state || 'UNKNOWN').replace(/^BATCH_STATE_/, 'JOB_STATE_');
}

export function jobNameOf(job) {
  return job?.job_name || job?.gemini_job_name || null;
}

const NAMELESS = [
  { $or: [{ job_name: { $exists: false } }, { job_name: { $in: [null, ''] } }] },
  { $or: [{ gemini_job_name: { $exists: false } }, { gemini_job_name: { $in: [null, ''] } }] },
];

/**
 * Pure decision. `gemini` is a probeBatchJob() result ({ verdict, sdkJob, attempts }) or
 * { verdict: 'exists', state } from a caller that already holds Gemini's answer; `keyCount` is
 * how many keys there are (a 404 verdict must cover all of them).
 *   → { action: 'write' | 'route_to_collection' | 'refuse', why, state }
 */
export function decideEnd(job, { status, gemini = null, keyCount = 0 }) {
  if (!LOSS_STATUSES.includes(status)) throw new Error(`endBatchJob: '${status}' is not a terminal-loss status (${LOSS_STATUSES.join('/')})`);
  if (!jobNameOf(job)) return { action: 'write', why: 'nameless: never submitted to Gemini', state: null };
  if (job.results_collected === true) return { action: 'write', why: 'output already collected', state: null };
  if (!gemini) return { action: 'refuse', why: 'Gemini was not asked about this job', state: null };
  if (gemini.verdict === 'not_found') {
    const attempts = gemini.attempts || [];
    const all404 = attempts.length > 0 && attempts.every((a) => a.result === 'not_found');
    if (!keyCount) return { action: 'refuse', why: '404 verdict without a key count — cannot tell every key was asked', state: null };
    if (!all404 || attempts.length < keyCount) {
      return { action: 'refuse', why: `404 on ${attempts.filter((a) => a.result === 'not_found').length}/${keyCount} keys — not every key said not-found`, state: null };
    }
    return { action: 'write', why: `batches.get 404 on all ${keyCount} keys`, state: 'NOT_FOUND' };
  }
  if (gemini.verdict !== 'exists') return { action: 'refuse', why: `Gemini verdict '${gemini.verdict}' — a key could not answer`, state: null };
  const state = normalizeGeminiState(gemini.state ?? gemini.sdkJob?.state);
  if (state === GEMINI_SUCCEEDED) return { action: 'route_to_collection', why: 'Gemini says SUCCEEDED — paid output waiting', state };
  if (GEMINI_DEAD_STATES.has(state)) return { action: 'write', why: `Gemini state ${state}`, state };
  return { action: 'refuse', why: `Gemini state ${state} — the job is alive or unknown`, state };
}

/** Output still attached to a job at Gemini (a dead job can carry a partial result file). */
function outputPresent(gemini) {
  const d = gemini?.sdkJob?.dest;
  return Boolean(d?.fileName || d?.inlinedResponses?.length);
}

/**
 * End one batch_jobs row, or refuse to. `opts`:
 *   status     'cancelled' | 'failed' | 'expired'                       (required)
 *   reason     why the caller wants it ended — written as `end_reason`  (required)
 *   by         the caller's name, written as `ended_by`                 (required)
 *   gemini     Gemini's answer if the caller already asked (see decideEnd)
 *   clients / keys   when no `gemini` is passed, the helper asks itself (probeBatchJob on every key)
 *   keyCount   number of keys behind `gemini` (defaults to clients.length)
 *   set        extra fields for the write (error, cancel_reason, gemini_state, …) — never `status`
 *   filter     extra conditions ANDed onto { _id } (e.g. still-active guard)
 *   dryRun, now
 * Returns { action: 'written' | 'routed_to_collection' | 'refused', why, state, modified }.
 */
/**
 * @typedef {{ status: 'cancelled'|'failed'|'expired', reason: string, by: string, gemini?: any, clients?: any[],
 *   keys?: string[], keyCount?: number, set?: Record<string, any>, filter?: Record<string, any>, dryRun?: boolean, now?: Date }} EndOpts
 * @param {any} db
 * @param {any} job
 * @param {EndOpts} opts
 */
export async function endBatchJob(db, job, opts) {
  const { status, reason, by, set = {}, filter = {}, dryRun = false, now = new Date() } = opts || /** @type {EndOpts} */ ({});
  if (!reason || !by) throw new Error('endBatchJob: reason and by are required');
  if ('status' in set) throw new Error('endBatchJob: pass the status as opts.status, not inside set');
  let { gemini = null, keyCount } = opts;
  const name = jobNameOf(job);
  if (name && !gemini && !job.results_collected && opts.clients?.length) {
    gemini = await probeBatchJob(name, opts.clients, opts.keys || []);
    keyCount = opts.clients.length;
  }
  if (keyCount == null) keyCount = opts.clients?.length || 0;
  const d = decideEnd(job, { status, gemini, keyCount });
  const verdict = {
    at: now, by, wanted: status, reason, decision: d.action, why: d.why, state: d.state,
    keys_tried: gemini?.attempts?.length ?? null, output_present: outputPresent(gemini),
  };
  const coll = db.collection('batch_jobs');
  if (d.action === 'refuse') {
    if (!dryRun && name) await coll.updateOne({ _id: job._id }, { $set: { last_end_refused: verdict } });
    return { action: 'refused', why: d.why, state: d.state, modified: 0 };
  }
  if (d.action === 'route_to_collection') {
    let modified = 0;
    if (!dryRun) {
      const res = await coll.updateOne({ _id: job._id }, { $set: {
        ...(COLLECTABLE_BATCH_STATUSES.includes(job.status) ? {} : { status: ROUTE_TO_COLLECTION_STATUS }),
        gemini_state: d.state, routed_to_collection: verdict, updated_at: now,
      } });
      modified = res?.modifiedCount ?? 0;
    }
    return { action: 'routed_to_collection', why: d.why, state: d.state, modified };
  }
  let modified = 0;
  if (!dryRun) {
    const where = { ...filter, _id: job._id };
    // A nameless row is written only if it is STILL nameless — a submitter may have named it since.
    if (!name) where.$and = [...(filter.$and || []), ...NAMELESS];
    const res = await coll.updateOne(where, { $set: {
      ...set, status, end_reason: reason, ended_by: by, ended_at: now, end_verdict: verdict, updated_at: now,
      ...(d.state && d.state !== 'NOT_FOUND' ? { gemini_state: d.state } : {}),
    } });
    modified = res?.modifiedCount ?? 0;
  }
  return { action: 'written', why: d.why, state: d.state, modified };
}

/**
 * Bulk-end rows that never reached Gemini. The nameless clauses are ANDed onto the caller's
 * filter, so this cannot touch a named row whatever the filter says.
 */
/**
 * @param {any} db
 * @param {Record<string, any>} filter
 * @param {{ status: 'cancelled'|'failed'|'expired', reason: string, by: string, set?: Record<string, any>, dryRun?: boolean, now?: Date }} opts
 */
export async function endNamelessBatchJobs(db, filter, { status, reason, by, set = {}, dryRun = false, now = new Date() }) {
  if (!LOSS_STATUSES.includes(status)) throw new Error(`endNamelessBatchJobs: '${status}' is not a terminal-loss status`);
  if (!reason || !by) throw new Error('endNamelessBatchJobs: reason and by are required');
  if ('status' in set) throw new Error('endNamelessBatchJobs: pass the status as opts.status, not inside set');
  const where = { ...filter, $and: [...(filter.$and || []), ...NAMELESS] };
  if (dryRun) return { modifiedCount: 0, filter: where };
  const res = await db.collection('batch_jobs').updateMany(where, { $set: {
    ...set, status, end_reason: reason, ended_by: by, ended_at: now, updated_at: now,
    end_verdict: { at: now, by, wanted: status, reason, decision: 'write', why: 'nameless: never submitted to Gemini' },
  } });
  return { modifiedCount: res?.modifiedCount ?? 0, filter: where };
}
