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
  'gemini-3.1-flash-lite-preview': { input: 0.25, output: 1.50 },
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-3-pro-preview': { input: 2.50, output: 10.00 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.5-pro': { input: 1.25, output: 5.00 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
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
