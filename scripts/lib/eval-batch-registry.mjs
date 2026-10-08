/**
 * The two writes an eval script makes to `batch_jobs` for a Gemini Batch it submits by hand:
 * one at submit, one at collection.
 *
 * Why both. A hand-submitted Batch the DB does not know is cancelled as an orphan by
 * batch-collector's reconcile (#5771, #5845), so eval scripts register a row with status
 * `external_eval`. Nothing ever ended that status. The daily paid-vs-got audit counts any
 * non-terminal named row as open at Gemini, so every eval batch crossed 40 h and was reported
 * as a paid job about to expire: 1 on 2026-10-05, 14 on 10-06, 28 on 10-08 (#5897), all of
 * them finished and downloaded. `closeEvalBatch` is the missing end. An eval batch that is
 * registered and never collected still shows in that audit, which is what it is for.
 *
 * `tests/unit/eval-batch-registry.test.ts` fails on a new `status: 'external_eval'` write
 * outside this file.
 *
 * PRIOR ART: scripts/eval/tibetan-mt-ab/batch-arms.mjs, scripts/eval/ocr-tags-5830.mjs and
 * scripts/maintenance/tengyur-heading-judge-5497.mjs each carried their own copy of the
 * register write and none closed the row; they now call this. Nothing in scripts/lib wrote
 * `batch_jobs` for eval jobs.
 */

/** Registered at submit; spared by the orphan sweep; OPEN to scripts/audit/paid-vs-got.mjs. */
export const EVAL_OPEN = 'external_eval';
/** Results downloaded by the eval script. In paid-vs-got's BATCH_TERMINAL; no worker selects on it. */
export const EVAL_CLOSED = 'collected';

/**
 * Record a just-submitted eval Batch. Idempotent on the Gemini job name.
 * @param {import('mongodb').Db} db
 * @param {{ jobName: string, id: string, submittedBy: string, type?: string, model?: string,
 *   pageCount?: number, submittedAt?: Date|string, issue?: number|null, note?: string }} job
 */
export async function registerEvalBatch(db, { jobName, id, submittedBy, type = 'eval', model = null, pageCount = 0, submittedAt = new Date(), issue = null, note = null }) {
  if (!jobName) throw new Error('registerEvalBatch: jobName (the Gemini batches/… name) is required');
  if (!submittedBy) throw new Error('registerEvalBatch: submittedBy (the script path) is required');
  return db.collection('batch_jobs').updateOne({ gemini_job_name: jobName }, { $setOnInsert: {
    id, job_name: jobName, gemini_job_name: jobName, status: EVAL_OPEN, type, model,
    page_count: pageCount, created_at: new Date(submittedAt), updated_at: new Date(),
    issue: issue == null ? null : Number(issue), submitted_by: submittedBy,
    note: note || `hand-submitted eval Batch (${submittedBy}); results go to files only, never to pages`,
  } }, { upsert: true });
}

/**
 * Mark an eval Batch collected, once its responses are on disk. Touches only a row still in
 * `external_eval`, so a second call, an unregistered job, or a production row is a no-op.
 * @param {import('mongodb').Db} db
 * @param {string} jobName
 * @param {{ evidence: string, usage?: { input_tokens?: number, output_tokens?: number, cost_usd?: number } }} how
 *   `evidence` says what proves the download (a results path, a usage row).
 * @returns {Promise<number>} rows changed (0 or 1)
 */
export async function closeEvalBatch(db, jobName, { evidence, usage = {} } = {}) {
  if (!jobName) throw new Error('closeEvalBatch: jobName is required');
  if (!evidence) throw new Error('closeEvalBatch: evidence (what proves the results were downloaded) is required');
  const now = new Date();
  const r = await db.collection('batch_jobs').updateOne(
    { gemini_job_name: jobName, status: EVAL_OPEN },
    { $set: { status: EVAL_CLOSED, results_collected: true, completed_at: now, updated_at: now, collected_evidence: evidence, ...usage } },
  );
  return r.modifiedCount;
}
