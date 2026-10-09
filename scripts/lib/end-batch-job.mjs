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
 * A FINISHED job whose output is refused on purpose is a fourth ending, with its own guard:
 * discardBatchJob() below (#6333).
 *
 * tests/unit/end-batch-job.test.ts drives every branch; tests/unit/batch-job-terminal-writes.test.ts
 * fails on any new direct write of these statuses to batch_jobs outside this file.
 */

import { probeBatchJob } from '../workers/lib/batch-reconcile.mjs';
import { COLLECTABLE_BATCH_STATUSES } from './batch-job-filters.mjs';
import { sumBatchResponseUsage, PLACEHOLDER_STATUSES } from '../workers/lib/supabase-usage-logger.mjs';

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
 * Close a row whose output was recovered by hand after the row was wrongly ended (#6276 stage 3):
 * sets `results_collected: true` and a `recovery` record, and NEVER touches `status` — the row
 * keeps the (wrong) label it was given, with the evidence of what Gemini actually did beside it.
 * Refused unless Gemini, asked about THIS job, says SUCCEEDED, and the caller holds the result it
 * downloaded (`recovery.result_sha256` + `recovery.result_bytes`). A row already collected is
 * left alone. The written document is filtered on `results_collected != true`, so two recoveries
 * cannot both claim it.
 * @param {any} db
 * @param {any} job
 * @param {{ gemini: any, by: string, recovery: Record<string, any>, dryRun?: boolean, now?: Date }} opts
 * Returns { action: 'marked' | 'refused', why, modified }.
 */
export async function markRecovered(db, job, { gemini, by, recovery, dryRun = false, now = new Date() } = /** @type {any} */ ({})) {
  if (!by) throw new Error('markRecovered: by is required');
  if (!jobNameOf(job)) return { action: 'refused', why: 'nameless row — nothing was submitted, nothing to recover', modified: 0 };
  if (job.results_collected === true) return { action: 'refused', why: 'already collected', modified: 0 };
  if (gemini?.verdict !== 'exists') return { action: 'refused', why: `Gemini verdict '${gemini?.verdict ?? 'not asked'}'`, modified: 0 };
  const state = normalizeGeminiState(gemini.state ?? gemini.sdkJob?.state);
  if (state !== GEMINI_SUCCEEDED) return { action: 'refused', why: `Gemini state ${state} — only a SUCCEEDED job has output to recover`, modified: 0 };
  if (!/^[0-9a-f]{64}$/.test(recovery?.result_sha256 || '') || !(recovery?.result_bytes > 0)) {
    return { action: 'refused', why: 'no downloaded result (result_sha256 + result_bytes) — recovery must hold the output', modified: 0 };
  }
  if ('status' in recovery) throw new Error('markRecovered: never writes a status');
  if (dryRun) return { action: 'marked', why: 'dry run', modified: 0 };
  const res = await db.collection('batch_jobs').updateOne(
    { _id: job._id, results_collected: { $ne: true } },
    { $set: { results_collected: true, gemini_state: state, recovery: { ...recovery, by, at: now }, updated_at: now } },
  );
  return { action: 'marked', why: `Gemini state ${state}; result held`, modified: res?.modifiedCount ?? 0 };
}

/**
 * batch_jobs status of a job whose finished output was refused on purpose. The status the
 * generation guard (batch-collector) and reset-book-ocr already write for the same thing, so
 * every reader that knows a deliberate discard knows this one; the `discard` record beside it
 * says who, why, and where the saved result is. Terminal; no worker selects it.
 */
export const DISCARDED_STATUS = 'superseded';
/** Row statuses that already say the output was read: never discarded. */
const READ_STATUSES = new Set(['saved', 'completed', 'completed_with_errors', 'collected']);

/**
 * Pure decision for discardBatchJob(). `gemini` is { verdict, state, requests, ok } — Gemini's
 * answer about THIS job, with its own request tally (readBatchStats in gemini-batch-ledger.mjs).
 *   → { action: 'discard' | 'refuse', why, state }
 */
export function decideDiscard(row, { reason, gemini = null, result = null }) {
  if (!String(reason || '').trim()) return { action: 'refuse', why: 'no reason given', state: null };
  if (row && (row.results_collected === true || READ_STATUSES.has(row.status))) return { action: 'refuse', why: `already collected (${row.status})`, state: null };
  if (row && COLLECTABLE_BATCH_STATUSES.includes(row.status)) return { action: 'refuse', why: `row is '${row.status}' — the collector still owns it`, state: null };
  if (!gemini) return { action: 'refuse', why: 'Gemini was not asked about this job', state: null };
  if (gemini.verdict === 'not_found') return { action: 'discard', why: 'Gemini no longer holds the job — nothing left to collect', state: 'NOT_FOUND' };
  if (gemini.verdict !== 'exists') return { action: 'refuse', why: `Gemini verdict '${gemini.verdict}' — a key could not answer`, state: null };
  const state = normalizeGeminiState(gemini.state);
  if (GEMINI_DEAD_STATES.has(state)) return { action: 'discard', why: `Gemini state ${state}`, state };
  if (state !== GEMINI_SUCCEEDED) return { action: 'refuse', why: `Gemini state ${state} — the job is alive or unknown`, state };
  if (gemini.requests > 0 && gemini.ok === 0) return { action: 'discard', why: `every request failed (0/${gemini.requests} succeeded) — nothing was billed`, state };
  if (!/^[0-9a-f]{64}$/.test(result?.sha256 || '') || !(result?.bytes > 0) || !result?.path) {
    return { action: 'refuse', why: 'paid output not held: a discard needs the downloaded result (path + sha256 + bytes)', state };
  }
  return { action: 'discard', why: `Gemini state ${state}; result held at ${result.path}`, state };
}

/**
 * The ONE way to say "Gemini finished this job, we looked at its output, and we are not writing
 * it" (#6333). Until this existed there was no such record: a stopped experiment or a superseded
 * re-submission stayed a "paid output never collected" finding until it aged out of the audit.
 *
 * Refused unless: a reason is given; no store row says the output was read or is still to be read
 * by the collector; and Gemini, asked about this job, says it is over. For a job with paid
 * responses the caller must also hold the downloaded result — a discard records where the bytes
 * are, it never stands in for them.
 *
 * Writes `status: 'superseded'` (DISCARDED_STATUS) and a `discard` record on the job's batch_jobs row, or inserts
 * such a row when no batch_jobs row names the job (lanes that keep their jobs elsewhere, scripts
 * that never registered). scripts/lib/gemini-batch-ledger.mjs counts that row as "discarded on
 * purpose"; scripts/audit/paid-vs-got.mjs treats the status as terminal.
 * @param {any} db
 * @param {{ name: string, displayName?: string, reason: string, by: string, gemini: any, result?: { path: string, sha256: string, bytes: number } | null,
 *   issue?: number | null, model?: string | null, pages?: number, createdAt?: Date | string | null, dryRun?: boolean, now?: Date }} opts
 * Returns { action: 'discarded' | 'refused', why, state, modified, inserted }.
 */
export async function discardBatchJob(db, opts) {
  const { name, displayName = null, reason, by, gemini = null, result = null, issue = null, model = null, pages = 0, createdAt = null, dryRun = false, now = new Date() } = opts || /** @type {any} */ ({});
  if (!name) throw new Error('discardBatchJob: name (the Gemini batches/… name) is required');
  if (!by) throw new Error('discardBatchJob: by is required');
  const coll = db.collection('batch_jobs');
  const rows = await coll.find({ $or: [{ job_name: name }, { gemini_job_name: name }] }).toArray();
  if (rows.length > 1) return { action: 'refused', why: `${rows.length} batch_jobs rows name this job`, state: null, modified: 0, inserted: 0 };
  const [row] = rows;
  const d = decideDiscard(row, { reason, gemini, result });
  if (d.action === 'refuse') return { action: 'refused', why: d.why, state: d.state, modified: 0, inserted: 0 };
  const discard = {
    reason: String(reason).trim(), by, at: now, why: d.why, gemini_state: d.state, issue: issue == null ? null : Number(issue),
    requests: gemini?.requests ?? null, requests_ok: gemini?.ok ?? null,
    result_path: result?.path || null, result_sha256: result?.sha256 || null, result_bytes: result?.bytes || null,
  };
  if (dryRun) return { action: 'discarded', why: `dry run: ${d.why}`, state: d.state, modified: 0, inserted: 0 };
  if (row) {
    // Filtered on the status it was decided on, so a collector that got there first wins.
    const res = await coll.updateOne({ _id: row._id, status: row.status, results_collected: { $ne: true } },
      { $set: { status: DISCARDED_STATUS, status_before_discard: row.status, discard, updated_at: now } });
    return { action: 'discarded', why: d.why, state: d.state, modified: res?.modifiedCount ?? 0, inserted: 0 };
  }
  const res = await coll.updateOne({ gemini_job_name: name }, { $setOnInsert: {
    id: `discard-${name.replace(/^batches\//, '')}`, job_name: name, gemini_job_name: name, display_name: displayName,
    status: DISCARDED_STATUS, type: 'discard_record', model, page_count: pages || 0,
    created_at: createdAt ? new Date(createdAt) : now, updated_at: now, discard,
    note: 'no batch_jobs row named this job; this row records that its finished output was refused on purpose',
  } }, { upsert: true });
  return { action: 'discarded', why: d.why, state: d.state, modified: 0, inserted: res?.upsertedCount ?? 0 };
}

/**
 * Close out a recovered job's usage row from the responses Gemini returned (#6276, #4599) — the
 * same close-out batch-collector.mjs does when it collects: tokens summed per RESPONSE
 * (sumBatchResponseUsage), written through completeBatchUsage() (passed in as `complete`).
 *
 * A per-request error line carries no usageMetadata and adds 0 tokens: Gemini bills tokens, and an
 * errored request produced none. It is counted in `errored` and named in the row's error_message.
 *
 * Idempotent against the rows the job already has (`existing`, both stores, read by the caller):
 *   - a closed (non-placeholder) row with these exact tokens, $0 close-outs included → 'skipped'
 *   - a closed row with OTHER non-zero tokens → 'refused' (someone else's reading; never overwrite)
 *   - more than one row → 'refused' (the double-count shape completeBatchUsage exists to stop)
 *   - no row and no tokens → 'skipped' (nothing was billed; a $0 row adds nothing)
 *   - otherwise the placeholder, a zero close-out, or no row at all is closed via `complete`.
 * Inserted rows carry the job's own created_at, so September spend never lands on today's dial.
 * @param {any} job batch_jobs row
 * @param {any[]} responses result lines
 * @param {{ existing?: any[], complete: (p: any) => Promise<string>, dryRun?: boolean, placeholderStatuses?: string[] }} opts
 * Returns { action: 'closed'|'skipped'|'refused', why, result?, params, errored, responded }.
 */
export async function meterRecovered(job, responses, { existing = [], complete, dryRun = false, placeholderStatuses = PLACEHOLDER_STATUSES } = /** @type {any} */ ({})) {
  const batchJobId = job?.id || (job?._id && String(job._id));
  if (!batchJobId) throw new Error('meterRecovered: the row has neither id nor _id');
  if (typeof complete !== 'function') throw new Error('meterRecovered: complete (completeBatchUsage) is required');
  const { inputTokens: input, outputTokens: output } = sumBatchResponseUsage(responses);
  const errored = (responses || []).filter((r) => r?.error).length;
  const responded = (responses || []).length;
  const metered = input + output > 0;
  const params = {
    type: job.type || 'ocr',
    mode: 'batch',
    model: job.model,
    book_id: job.book_id,
    page_count: job.page_count || job.page_ids?.length || 0,
    input_tokens: input,
    output_tokens: output,
    status: metered ? 'success' : 'failed',
    error_message: errored ? `${errored}/${responded} responses were per-request errors (no usageMetadata, 0 tokens); recovered #6276` : null,
    batch_job_id: batchJobId,
    endpoint: 'hetzner/pipeline-orchestrator',
    triggered_by: 'manual',
    timestamp: new Date(job.created_at || Date.now()).toISOString(),
    insertIfMissing: metered,
  };
  const out = (action, why, result) => ({ action, why, result, params, errored, responded });
  const tok = (r) => (r.input_tokens || 0) + (r.output_tokens || 0);
  if (existing.length > 1) return out('refused', `${existing.length} usage rows for one batch job`);
  const [row] = existing;
  if (row && !placeholderStatuses.includes(row.status)) {
    if ((row.input_tokens || 0) === input && (row.output_tokens || 0) === output) return out('skipped', 'already metered with these tokens');
    if (tok(row) > 0) return out('refused', `closed row holds other tokens (${row.input_tokens}/${row.output_tokens})`);
  }
  if (!row && !metered) return out('skipped', 'no usage row and no tokens billed');
  if (dryRun) return out('closed', `dry run (${row ? `would close ${row.status} row` : 'would insert'})`);
  return out('closed', row ? `closed ${row.status} row` : 'inserted', await complete(params));
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
