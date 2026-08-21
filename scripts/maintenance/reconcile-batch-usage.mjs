#!/usr/bin/env node

/**
 * Reconcile batch gemini_usage placeholder rows against batch_jobs (#3452).
 *
 * A batch job writes a gemini_usage row at SUBMIT time with input_tokens: 0,
 * output_tokens: 0, cost_usd: 0 and status 'submitted' (or 'pending' from the
 * TS logger) — the job hasn't run, so there is nothing to record yet. Nothing
 * ever closed those rows out. The collector inserted a SECOND row with the real
 * numbers, so the meter simultaneously:
 *
 *   - reads $0.00 across ~376K pages of batch OCR that genuinely cost money
 *     (the placeholders), and
 *   - double-counts calls and pages for every batch that DID complete.
 *
 * batch-collector now closes the placeholder instead of inserting beside it.
 * This script fixes the accumulated history and doubles as a standing
 * reconciler: several code paths terminate a batch job (Gemini failure, ghost
 * sweep, nameless reaper, generation guard), and rather than teach each one to
 * touch the meter, this derives the terminal state from batch_jobs — which
 * every one of them writes.
 *
 * Resolution per placeholder, by the state of its batch_jobs record:
 *   collected + a real usage row already exists  -> status 'duplicate' (zeros
 *                                                   stay; the other row holds
 *                                                   the spend)
 *   collected + no other row                     -> fill tokens/cost from
 *                                                   batch_jobs, status success
 *                                                   or failed
 *   terminal failure / cancelled / superseded    -> status matched, zeros kept
 *   still pending or processing                  -> left alone (in flight)
 *   batch job missing entirely                   -> status 'failed', noted
 *
 * Writes only to gemini_usage status/token/cost fields. Never deletes a row.
 * Idempotent — a reconciled row no longer matches the placeholder filter.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/reconcile-batch-usage.mjs --dry-run
 *   node scripts/maintenance/reconcile-batch-usage.mjs
 *   node scripts/maintenance/reconcile-batch-usage.mjs --limit 500   # a slice
 *   node scripts/maintenance/reconcile-batch-usage.mjs --store mongo # Mongo only
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
// Some env files carry a literal trailing "\n" in the value; unsanitized it
// makes every REST call 404 with an empty body, which reads like a missing
// table rather than a bad host.
const clean = (v) => (v || '').replace(/\\n/g, '').trim();
const SUPABASE_URL = clean(process.env.SUPABASE_URL) || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_SERVICE_KEY = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);

const DRY_RUN = process.argv.includes('--dry-run');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;
const storeArg = process.argv.indexOf('--store');
const STORE = storeArg > -1 ? process.argv[storeArg + 1] : 'both'; // both | supabase | mongo

const PLACEHOLDER_STATUSES = ['submitted', 'pending'];
const PAGE_SIZE = 1000;

const MODEL_PRICING = {
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.50 },
  'gemini-3.1-flash-lite-preview': { input: 0.25, output: 1.50 },
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-3-pro-preview': { input: 2.50, output: 10.00 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.5-pro': { input: 1.25, output: 5.00 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
};

function calculateCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['gemini-3-flash-preview'];
  const inputCost = (inputTokens / 1_000_000) * pricing.input * 0.5; // batch discount
  const outputCost = (outputTokens / 1_000_000) * pricing.output * 0.5;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

/** Terminal batch_jobs statuses that produced no usable result. */
const FAILED_JOB_STATUSES = new Set(['failed', 'archived_failed', 'cancelled', 'expired']);
const COLLECTED_JOB_STATUSES = new Set(['saved', 'completed', 'completed_with_errors']);
const IN_FLIGHT_JOB_STATUSES = new Set(['pending', 'processing', 'submitted']);

/**
 * Decide what a placeholder row should become.
 *
 * @param {object} row  the gemini_usage placeholder
 * @param {object|null} job  its batch_jobs record
 * @param {boolean} hasSiblingRow  a non-placeholder usage row exists for this batch
 */
export function resolvePlaceholder(row, job, hasSiblingRow) {
  if (!job) {
    // 'unknown', not 'failed': with no job record we cannot tell whether this
    // batch ran and was billed. Asserting $0.00 here would be the same lie in
    // a new place — mark it unmeasurable and keep it out of every sum.
    return {
      action: 'orphan',
      patch: {
        status: 'unknown',
        error_message: 'Reconcile #3452: no batch_jobs record for this batch_job_id — spend unmeasurable',
      },
    };
  }

  if (IN_FLIGHT_JOB_STATUSES.has(job.status)) return { action: 'in_flight', patch: null };

  if (hasSiblingRow) {
    // The old collector already logged this batch's real spend on its own row.
    // Marking the placeholder rather than deleting it keeps the submit
    // timestamp (useful for batch latency) while taking it out of every sum.
    return {
      action: 'duplicate',
      patch: {
        status: 'duplicate',
        error_message: 'Reconcile #3452: spend recorded on the collector-written row for this batch',
      },
    };
  }

  if (COLLECTED_JOB_STATUSES.has(job.status)) {
    const input = job.input_tokens || 0;
    const output = job.output_tokens || 0;
    const cost = job.cost_usd ?? calculateCost(job.model || row.model, input, output);
    const allFailed = (job.completed_pages || 0) === 0;
    return {
      action: input > 0 ? 'filled' : 'zero_spend',
      patch: {
        status: allFailed ? 'failed' : 'success',
        input_tokens: input,
        output_tokens: output,
        cost_usd: cost,
        ...(job.page_count ? { page_count: job.page_count } : {}),
        ...(allFailed ? { error_message: job.error || 'All pages failed' } : {}),
      },
    };
  }

  if (job.status === 'superseded') {
    return {
      action: 'superseded',
      patch: {
        status: 'superseded',
        error_message: job.error || 'Superseded — results discarded, tokens not read',
      },
    };
  }

  if (FAILED_JOB_STATUSES.has(job.status)) {
    return {
      action: 'failed',
      patch: {
        status: 'failed',
        input_tokens: 0, output_tokens: 0, cost_usd: 0,
        error_message: job.error || job.cancel_reason || `Batch job ${job.status}`,
      },
    };
  }

  return { action: 'unknown_state', patch: null };
}

// ── Supabase helpers ──

async function sbFetch(path, init = {}) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      ...(init.headers || {}),
    },
  });
  if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  return resp;
}

/**
 * Resolve usage rows to their batch jobs.
 *
 * `batch_job_id` holds two different identifiers depending on who wrote the
 * row: the Hetzner orchestrator stores `batch_jobs.id`, while the older
 * /api/books/[id]/batch-ocr-async route stored the Gemini job NAME
 * ("batches/v7zl…"). Joining on `id` alone reports the latter as orphans —
 * 562 of the first 1,000 placeholders — so match all three keys.
 */
export function indexJobsByEveryKey(jobs) {
  const map = new Map();
  for (const j of jobs) {
    for (const key of [j.id, j.job_name, j.gemini_job_name]) {
      if (key) map.set(key, j);
    }
  }
  return map;
}

async function loadJobs(db, batchJobIds) {
  const jobs = await db.collection('batch_jobs').find(
    { $or: [
      { id: { $in: batchJobIds } },
      { job_name: { $in: batchJobIds } },
      { gemini_job_name: { $in: batchJobIds } },
    ] },
    { projection: { id: 1, job_name: 1, gemini_job_name: 1, status: 1, model: 1, input_tokens: 1, output_tokens: 1, cost_usd: 1, page_count: 1, completed_pages: 1, failed_pages: 1, error: 1, cancel_reason: 1 } },
  ).toArray();
  return indexJobsByEveryKey(jobs);
}

function tally(counts, action) { counts[action] = (counts[action] || 0) + 1; }

async function reconcileSupabase(db, counts) {
  if (!SUPABASE_SERVICE_KEY) {
    console.log('SUPABASE_SERVICE_ROLE_KEY not set — skipping Supabase store');
    return;
  }
  const statusFilter = `(${PLACEHOLDER_STATUSES.join(',')})`;
  let processed = 0;

  // Always read the OLDEST placeholders: reconciled rows leave the filter, so
  // paging by offset would skip rows as the set shrinks under us.
  for (;;) {
    if (processed >= LIMIT) break;
    const pageSize = Math.min(PAGE_SIZE, LIMIT - processed);
    const resp = await sbFetch(
      `gemini_usage?select=id,batch_job_id,model,status,page_count&mode=eq.batch&status=in.${statusFilter}&batch_job_id=not.is.null&order=timestamp.asc&limit=${pageSize}`,
    );
    const rows = await resp.json();
    if (!rows.length) break;

    const jobMap = await loadJobs(db, [...new Set(rows.map(r => r.batch_job_id))]);

    // Which of these batches already have a real (non-placeholder) usage row?
    const siblings = new Set();
    const ids = [...new Set(rows.map(r => r.batch_job_id))];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100).map(id => `"${id}"`).join(',');
      const sibResp = await sbFetch(
        `gemini_usage?select=batch_job_id&batch_job_id=in.(${chunk})&status=not.in.${statusFilter}`,
      );
      for (const s of await sibResp.json()) siblings.add(s.batch_job_id);
    }

    let advanced = 0;
    for (const row of rows) {
      const { action, patch } = resolvePlaceholder(row, jobMap.get(row.batch_job_id) || null, siblings.has(row.batch_job_id));
      tally(counts, action);
      if (!patch) continue; // still in flight — leave it, and don't count it as progress
      advanced++;
      if (DRY_RUN) continue;
      await sbFetch(`gemini_usage?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ ...patch, completed_at: new Date().toISOString() }),
      });
    }
    processed += rows.length;
    console.log(`  supabase: ${processed} placeholders examined`);

    // Dry runs never shrink the set, and a page of purely in-flight rows would
    // otherwise loop forever on the same oldest rows.
    if (DRY_RUN || advanced === 0) break;
  }
}

async function reconcileMongo(db, counts) {
  const coll = db.collection('gemini_usage');
  const cursor = coll.find(
    { mode: 'batch', status: { $in: PLACEHOLDER_STATUSES }, batch_job_id: { $ne: null } },
    { projection: { _id: 1, batch_job_id: 1, model: 1, status: 1, page_count: 1 } },
  ).batchSize(500);

  let buffer = [];
  let processed = 0;
  const flush = async () => {
    if (!buffer.length) return;
    const ids = [...new Set(buffer.map(r => r.batch_job_id))];
    const jobMap = await loadJobs(db, ids);
    const sibRows = await coll.find(
      { batch_job_id: { $in: ids }, status: { $nin: PLACEHOLDER_STATUSES } },
      { projection: { batch_job_id: 1 } },
    ).toArray();
    const siblings = new Set(sibRows.map(s => s.batch_job_id));

    const ops = [];
    for (const row of buffer) {
      const { action, patch } = resolvePlaceholder(row, jobMap.get(row.batch_job_id) || null, siblings.has(row.batch_job_id));
      tally(counts, action);
      if (!patch) continue;
      ops.push({ updateOne: { filter: { _id: row._id }, update: { $set: { ...patch, completed_at: new Date() } } } });
    }
    if (ops.length && !DRY_RUN) await coll.bulkWrite(ops, { ordered: false });
    processed += buffer.length;
    console.log(`  mongo: ${processed} placeholders examined`);
    buffer = [];
  };

  for await (const row of cursor) {
    buffer.push(row);
    if (buffer.length >= PAGE_SIZE) await flush();
    if (processed + buffer.length >= LIMIT) break;
  }
  await flush();
}

async function main() {
  if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log(`Reconciling batch usage placeholders${DRY_RUN ? ' (dry run — no writes)' : ''}`);
  const counts = {};
  const start = Date.now();

  try {
    if (STORE === 'both' || STORE === 'supabase') await reconcileSupabase(db, counts);
    if (STORE === 'both' || STORE === 'mongo') await reconcileMongo(db, counts);
  } finally {
    await client.close();
  }

  console.log(`\nDone in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  for (const [action, n] of Object.entries(counts).sort(([, a], [, b]) => b - a)) {
    console.log(`  ${action.padEnd(14)} ${n}`);
  }
  if (DRY_RUN) console.log('\n(dry run — re-run without --dry-run to apply)');
}

// Importable for tests; only runs when invoked directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
