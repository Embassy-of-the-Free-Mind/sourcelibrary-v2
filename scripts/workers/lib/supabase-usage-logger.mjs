/**
 * Lightweight Supabase usage logger for Hetzner workers.
 *
 * Replaces direct `db.collection('gemini_usage').insertOne()` calls.
 * Uses Supabase REST API via fetch — no @supabase/supabase-js needed
 * (though workers that already have it can use createClient instead).
 *
 * Issue #567 Phase 3: Atlas write migration.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Model pricing per 1M tokens
const MODEL_PRICING = {
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.50 },
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-3-pro-preview': { input: 2.50, output: 10.00 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.5-pro': { input: 1.25, output: 5.00 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  // Embedding models: input only — they return a vector, not tokens (#4162).
  'gemini-embedding-2-preview': { input: 0.20, output: 0 },
  'gemini-embedding-001': { input: 0.15, output: 0 },
};

function calculateCost(model, inputTokens, outputTokens, isBatch = false) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['gemini-3-flash-preview'];
  const discount = isBatch ? 0.5 : 1;
  const inputCost = (inputTokens / 1_000_000) * pricing.input * discount;
  const outputCost = (outputTokens / 1_000_000) * pricing.output * discount;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

function generateId() {
  return `gu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Placeholder statuses: a row written at batch-submit time, before any tokens
 * exist. These carry input_tokens/output_tokens/cost_usd of 0 by construction
 * and MUST NOT be summed as spend or as pages processed — completeBatchUsage()
 * fills them in when the results come back. Two spellings exist for historical
 * reasons ('submitted' from the Hetzner orchestrator, 'pending' from
 * src/lib/gemini-logger.ts); both mean the same thing.
 */
export const PLACEHOLDER_STATUSES = ['submitted', 'pending'];

export function calculateUsageCost(model, inputTokens, outputTokens, isBatch) {
  return calculateCost(model, inputTokens, outputTokens, isBatch);
}

/**
 * Total the tokens a batch actually consumed, from the raw Gemini responses.
 *
 * Per RESPONSE, deliberately (#3452). Summing per SAVED PAGE undercounts every
 * response we discard — RECITATION blocks, empty candidates, over-length
 * hallucinations, pages dropped by the generation guard — all of which Gemini
 * still bills the prompt for; a job where every page was blocked recorded
 * $0.00. And in multi-page mode one response covers N pages but carries ONE
 * usageMetadata, so per-page attribution multiplied the same tokens by N.
 */
/**
 * Output tokens as GOOGLE BILLS THEM: visible text plus reasoning.
 *
 * Gemini 3.x charges `thoughtsTokenCount` at the output rate, and on models
 * that think by default (measured 2026-09-04: `gemini-3-flash-preview` emits
 * ~1.5 thought tokens per visible output token with no `thinkingConfig`) a
 * meter reading `candidatesTokenCount` alone under-reports the bill without
 * ever erroring. That is how August metered $499.74 against $8,389.32 billed
 * (#4581). `src/lib/ai.ts` was fixed in #4591; the Hetzner `.mjs` stack — which
 * runs nearly all current work — was not, until now.
 *
 * Use this at every site that records what a call cost. Fix the definition,
 * not the call site.
 */
/**
 * What a batch job is expected to cost, written on its placeholder AT SUBMIT (#4567).
 *
 * A placeholder used to carry `cost_usd: 0` until the collector patched it, on
 * average 12 minutes later. Every ceiling that reads measured spend — the daily
 * dial, the #4540 scope envelopes — under-read by everything in flight, which is
 * failure mode 4 of the spend ceiling ("committed but unpriced"): the 2026-08-31
 * relight cut off at $5.08 visible and settled at $6.32 once 13 in-flight batches
 * were priced. Writing an estimate makes the ceiling fail CLOSED on committed work.
 *
 * The estimate is overwritten, never added to: `completeBatchUsage()` replaces it
 * with actuals at collection, `closeUsagePlaceholder()` zeroes it when a job never
 * ran, and `reconcile-batch-usage.mjs` zeroes it on every other terminal state.
 *
 * RATES ARE MEASURED, per batch job not per row (the duplicate rows of #4822 would
 * double them), over completed jobs 2026-08-31..09-13. They are BLENDED with failed
 * jobs deliberately: flash-lite's loop-to-cap failures cost $8.87/1K pages against
 * $1.46/1K for successes (#4674), and a ceiling that assumes every job succeeds
 * under-reserves on exactly the days that go wrong.
 *
 *   ocr   gemini-3.1-flash-lite   38,644 ok pages $1.46/1K + 4,620 failed $8.87/1K  -> $2.25/1K
 *   ocr   gemini-3-flash-preview  34,902 ok pages $1.83/1K                           -> $1.83/1K
 *   translation gemini-3-flash-preview   70 pages $1.78/1K (thin sample)             -> $1.78/1K
 *
 * Anything unmeasured is priced from the batch rate card at a conservative
 * 4,000 input / 1,500 output tokens per page — high on purpose, for the same
 * reason. Re-measure before trusting a rate older than a month.
 */
const MEASURED_BATCH_USD_PER_PAGE = {
  'ocr|gemini-3.1-flash-lite': 0.00225,
  'ocr|gemini-3-flash-preview': 0.00183,
  'translation|gemini-3-flash-preview': 0.00178,
};
const UNMEASURED_TOKENS_PER_PAGE = { input: 4000, output: 1500 };

export function estimateBatchCostUsd({ type, model, pageCount }) {
  const pages = Math.max(0, Number(pageCount) || 0);
  if (!pages) return 0;
  const rate = MEASURED_BATCH_USD_PER_PAGE[`${type}|${model}`];
  if (rate != null) return +(rate * pages).toFixed(6);
  return +calculateCost(
    model || 'gemini-3-flash-preview',
    UNMEASURED_TOKENS_PER_PAGE.input * pages,
    UNMEASURED_TOKENS_PER_PAGE.output * pages,
    true,
  ).toFixed(6);
}

export function outputTokensFrom(usageMetadata) {
  return (usageMetadata?.candidatesTokenCount || 0) + (usageMetadata?.thoughtsTokenCount || 0);
}

export function sumBatchResponseUsage(responses) {
  let input = 0;
  let output = 0;
  for (const r of responses || []) {
    const usage = r?.response?.usageMetadata;
    input += usage?.promptTokenCount || 0;
    output += outputTokensFrom(usage);
  }
  return { inputTokens: input, outputTokens: output };
}

async function supabaseFetch(path, init) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      ...(init?.headers || {}),
    },
  });
}

/**
 * Close out the placeholder row a batch submission wrote, filling in the token
 * counts and cost that only exist once the job has run (#3452).
 *
 * Without this the submit-time row stays at $0.00 forever and the collector's
 * own insert becomes a SECOND row for the same batch — so the meter reads zero
 * for real spend while double-counting the pages. Falls back to inserting a
 * fresh row when no placeholder is found (re-collected batches, or jobs
 * submitted before the placeholder existed), so nothing goes unlogged.
 *
 * @returns {Promise<'updated'|'inserted'|'error'>}
 */
export async function completeBatchUsage(params, db = null) {
  const batchJobId = params.batch_job_id;
  if (!batchJobId) throw new Error('completeBatchUsage requires batch_job_id');

  const inputTokens = params.input_tokens || 0;
  const outputTokens = params.output_tokens || 0;
  const cost = params.cost_usd ?? calculateCost(
    params.model || 'gemini-3-flash-preview',
    inputTokens,
    outputTokens,
    true,
  );

  const patch = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: cost,
    status: params.status || 'success',
    completed_at: new Date().toISOString(),
    ...(params.page_count !== undefined && { page_count: params.page_count }),
    ...(params.error_message !== undefined && { error_message: params.error_message }),
  };

  if (SUPABASE_SERVICE_KEY) {
    try {
      const statusFilter = `(${PLACEHOLDER_STATUSES.join(',')})`;
      const resp = await supabaseFetch(
        `gemini_usage?batch_job_id=eq.${encodeURIComponent(batchJobId)}&status=in.${statusFilter}`,
        { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) },
      );
      if (resp.ok) {
        const updated = await resp.json().catch(() => []);
        if (Array.isArray(updated) && updated.length > 0) return 'updated';
      } else {
        const text = await resp.text().catch(() => '');
        console.warn(`[supabase-usage] Batch completion patch failed (${resp.status}): ${text}`);
      }
    } catch (err) {
      console.warn('[supabase-usage] Batch completion error:', err.message);
    }
  } else if (db) {
    const res = await db.collection('gemini_usage').updateOne(
      { batch_job_id: batchJobId, status: { $in: PLACEHOLDER_STATUSES } },
      { $set: { ...patch, completed_at: new Date() } },
    ).catch(() => null);
    if (res?.matchedCount > 0) return 'updated';
  }

  // No placeholder to close — log the result as its own row so the spend is
  // still recorded (fail open on the meter, never silently drop a cost).
  // Callers closing out a zero-spend job pass insertIfMissing: false; a new
  // $0.00 row would add noise without adding information.
  if (params.insertIfMissing === false) return 'skipped';
  const { insertIfMissing: _ignored, ...rest } = params;
  await logUsage({ ...rest, input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: cost }, db);
  return 'inserted';
}

/**
 * Log a Gemini API call to Supabase.
 * Falls back to MongoDB if Supabase key is missing.
 *
 * @param {object} params - Same shape as the old MongoDB insertOne payload
 * @param {import('mongodb').Db} [db] - Optional MongoDB db for fallback
 */
export async function logUsage(params, db = null) {
  const id = params.id || generateId();
  const cost = params.cost_usd ?? calculateCost(
    params.model || 'gemini-3-flash-preview',
    params.input_tokens || 0,
    params.output_tokens || 0,
    params.mode === 'batch',
  );

  const row = {
    id,
    timestamp: params.timestamp || new Date().toISOString(),
    type: params.type || 'other',
    mode: params.mode || 'realtime',
    model: params.model || null,
    book_id: params.book_id || null,
    book_title: params.book_title || null,
    page_count: params.page_count || params.page_ids?.length || 0,
    input_tokens: params.input_tokens || 0,
    output_tokens: params.output_tokens || 0,
    cost_usd: cost,
    status: params.status || 'success',
    error_message: params.error_message || null,
    error_category: params.error_category || null,
    duration_ms: params.duration_ms || null,
    prompt_version: params.prompt_version || null,
    job_id: params.job_id || null,
    batch_job_id: params.batch_job_id || null,
    endpoint: params.endpoint || null,
    // Provenance: cron | manual | auto_recovery | worker | unknown.
    // Workers default to 'worker'; cron jobs override via TRIGGER_SOURCE=cron.
    triggered_by: params.triggered_by || process.env.TRIGGER_SOURCE || 'worker',
    completed_at: null,
  };

  if (SUPABASE_SERVICE_KEY) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/gemini_usage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(row),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        console.warn(`[supabase-usage] Write failed (${resp.status}): ${text}`);
      }
    } catch (err) {
      console.warn('[supabase-usage] Write error:', err.message);
      // Fall back to MongoDB
      if (db) await db.collection('gemini_usage').insertOne({ ...row, timestamp: new Date(row.timestamp) }).catch(() => {});
    }
  } else if (db) {
    // No Supabase key — fall back to MongoDB
    await db.collection('gemini_usage').insertOne({ ...row, timestamp: new Date(row.timestamp) });
  } else {
    console.warn('[supabase-usage] No Supabase key and no MongoDB fallback — usage not logged');
  }
}

/**
 * Fire-and-forget version — doesn't await, swallows errors.
 */
export function logUsageAsync(params, db = null) {
  logUsage(params, db).catch(() => {});
}
