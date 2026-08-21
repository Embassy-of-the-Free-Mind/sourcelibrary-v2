/**
 * Gemini API Usage Logger
 *
 * Logs all Gemini API calls (realtime and batch) for auditing.
 * Primary store: Supabase `gemini_usage` table (since 2026-04-10, issue #567 Phase 3).
 * Falls back to MongoDB if Supabase service key unavailable.
 *
 * This is the SINGLE source of truth for AI cost/usage tracking.
 * The `cost_tracking` collection is deprecated.
 *
 * Usage:
 *   import { logGeminiCall, logBatchSubmission, logBatchResult } from '@/lib/gemini-logger';
 *
 *   // For realtime calls (HTTP endpoints)
 *   await logGeminiCall({
 *     type: 'ocr',
 *     model: 'gemini-2.5-flash',
 *     book_id: '123',
 *     book_title: 'Some Book',
 *     page_ids: ['page1', 'page2'],
 *     input_tokens: 1000,
 *     output_tokens: 500,
 *     status: 'success',
 *   });
 *
 *   // For Lambda workers (includes job tracking + timing)
 *   await logGeminiCall({
 *     type: 'ocr',
 *     mode: 'realtime',
 *     model: 'gemini-2.5-flash',
 *     book_id: '123',
 *     page_ids: ['page1'],
 *     input_tokens: 1000,
 *     output_tokens: 500,
 *     status: 'success',
 *     job_id: 'job_abc',          // Links to jobs collection
 *     duration_ms: 3200,          // Wall-clock time for AI call
 *     endpoint: 'worker/ocr',
 *   });
 *
 *   // For failed calls (workers log these too)
 *   await logGeminiCall({
 *     ...commonFields,
 *     status: 'failed',
 *     error_message: 'Rate limit exceeded',
 *     error_category: 'rate_limit',  // From classifyError()
 *   });
 *
 *   // For batch submissions
 *   await logBatchSubmission({
 *     batch_job_id: 'job123',
 *     gemini_job_name: 'batches/xyz',
 *     ...
 *   });
 */

import { getDb } from './mongodb';
import { supabaseAdmin } from './supabase';

// Pricing per 1M tokens (as of Jan 2025)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.50 },
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-3-pro-preview': { input: 2.50, output: 10.00 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.5-pro': { input: 1.25, output: 5.00 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
};

// Batch API gets 50% discount
const BATCH_DISCOUNT = 0.5;

export type GeminiCallType = 'ocr' | 'translation' | 'transliterate' | 'summary' | 'extract_images' | 'extract_chapters' | 'index' | 'ft_verification' | 'other';
export type GeminiMode = 'realtime' | 'batch';
export type GeminiStatus = 'success' | 'failed' | 'pending' | 'submitted' | 'superseded' | 'duplicate' | 'unknown';

/**
 * Statuses on a row that carries no spend figure yet (#3452).
 *
 * A batch job logs a row at SUBMIT time, before tokens exist — 'submitted' from
 * the Hetzner orchestrator, 'pending' from logBatchSubmission() below. Both mean
 * the same thing and both must be reconciled once results land, or the meter
 * reads $0.00 for real spend. 'duplicate' marks a historical placeholder whose
 * spend was recorded on a separate row by the pre-#3452 collector.
 *
 * NEVER sum cost, tokens, or page_count over these rows — see the
 * `dashboard_usage` view, which filters them out.
 */
export const PLACEHOLDER_STATUSES: GeminiStatus[] = ['submitted', 'pending'];
export const NON_SPEND_STATUSES: GeminiStatus[] = [...PLACEHOLDER_STATUSES, 'duplicate', 'unknown'];
/** Provenance: who/what kicked off the call. `cron` = scheduled job, `manual` = HTTP-triggered admin action, `auto_recovery` = Lambda re-runner, `worker` = unattended worker loop. */
export type GeminiTrigger = 'cron' | 'manual' | 'auto_recovery' | 'worker' | 'unknown';

export interface GeminiUsageLog {
  id?: string;
  timestamp: Date;
  type: GeminiCallType;
  mode: GeminiMode;
  model: string;

  // Context - at least one should be set
  book_id?: string;
  book_title?: string;
  page_ids?: string[];
  page_count?: number;

  // Batch job reference
  batch_job_id?: string;
  gemini_job_name?: string;

  // Usage
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;

  // Result
  status: GeminiStatus;
  error_message?: string;

  // Job tracking
  job_id?: string;          // Links to jobs collection
  duration_ms?: number;     // Wall-clock time for the AI call
  error_category?: string;  // Structured classification (rate_limit, timeout, etc.)

  // Metadata
  prompt_version?: string;
  endpoint?: string;  // Which API route triggered this
  triggered_by?: GeminiTrigger;  // Provenance source attribution (defaults to 'unknown' if unset)

  // Multi-page OCR params
  pages_per_request?: number;  // >1 means multi-page mode (N images per Gemini request)
}

function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  isBatch: boolean
): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['gemini-3-flash-preview'];
  const discount = isBatch ? BATCH_DISCOUNT : 1;

  const inputCost = (inputTokens / 1_000_000) * pricing.input * discount;
  const outputCost = (outputTokens / 1_000_000) * pricing.output * discount;

  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000; // Round to 6 decimal places
}

function generateId(): string {
  return `gu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Log a Gemini API call (realtime or batch result)
 */
export async function logGeminiCall(params: {
  type: GeminiCallType;
  mode: GeminiMode;
  model: string;
  book_id?: string;
  book_title?: string;
  page_ids?: string[];
  page_count?: number;
  batch_job_id?: string;
  gemini_job_name?: string;
  input_tokens: number;
  output_tokens: number;
  status: GeminiStatus;
  error_message?: string;
  job_id?: string;
  duration_ms?: number;
  error_category?: string;
  prompt_version?: string;
  endpoint?: string;
  triggered_by?: GeminiTrigger;
  pages_per_request?: number;
}): Promise<void> {
  try {
    const db = await getDb();

    // Look up book title if missing but book_id is provided
    // Note: book_id is the string `id` field, not the ObjectId `_id`
    let bookTitle = params.book_title;
    if (!bookTitle && params.book_id) {
      try {
        const book = await db.collection('books').findOne(
          { id: params.book_id },
          { projection: { title: 1, display_title: 1 } }
        );
        if (book) {
          bookTitle = book.display_title || book.title;
        }
      } catch {
        // Non-critical — proceed without title
      }
    }

    const log: GeminiUsageLog = {
      id: generateId(),
      timestamp: new Date(),
      type: params.type,
      mode: params.mode,
      model: params.model,
      book_id: params.book_id,
      book_title: bookTitle,
      page_ids: params.page_ids,
      page_count: params.page_count || params.page_ids?.length || 0,
      batch_job_id: params.batch_job_id,
      gemini_job_name: params.gemini_job_name,
      input_tokens: params.input_tokens,
      output_tokens: params.output_tokens,
      cost_usd: calculateCost(params.model, params.input_tokens, params.output_tokens, params.mode === 'batch'),
      status: params.status,
      error_message: params.error_message,
      job_id: params.job_id,
      duration_ms: params.duration_ms,
      error_category: params.error_category,
      prompt_version: params.prompt_version,
      endpoint: params.endpoint,
      triggered_by: params.triggered_by || (process.env.TRIGGER_SOURCE as GeminiTrigger | undefined) || 'unknown',
      ...(params.pages_per_request && params.pages_per_request > 1 && { pages_per_request: params.pages_per_request }),
    };

    // Write to Supabase (primary store since 2026-04-10, issue #567 Phase 3)
    if (supabaseAdmin) {
      const { error } = await supabaseAdmin.from('gemini_usage').insert({
        id: log.id,
        timestamp: log.timestamp,
        type: log.type,
        mode: log.mode || null,
        model: log.model || null,
        book_id: log.book_id || null,
        book_title: log.book_title || null,
        page_count: log.page_count || 0,
        input_tokens: log.input_tokens || 0,
        output_tokens: log.output_tokens || 0,
        cost_usd: log.cost_usd || 0,
        status: log.status || null,
        error_message: log.error_message || null,
        error_category: log.error_category || null,
        duration_ms: log.duration_ms || null,
        prompt_version: log.prompt_version || null,
        job_id: log.job_id || null,
        batch_job_id: log.batch_job_id || null,
        endpoint: log.endpoint || null,
        triggered_by: log.triggered_by || null,
        completed_at: null,
      });
      if (error) console.warn('[gemini-logger] Supabase write failed:', error.message);
    } else {
      // Fallback: write to MongoDB if Supabase service key unavailable (e.g., build time)
      await db.collection('gemini_usage').insertOne(log);
    }
  } catch (error) {
    // Don't let logging failures break the main flow
    console.error('[gemini-logger] Failed to log:', error);
  }
}

/**
 * Log a batch job submission (before results are known)
 */
export async function logBatchSubmission(params: {
  type: GeminiCallType;
  model: string;
  book_id: string;
  book_title: string;
  page_ids: string[];
  batch_job_id: string;
  gemini_job_name: string;
  prompt_version?: string;
  endpoint?: string;
}): Promise<void> {
  await logGeminiCall({
    ...params,
    mode: 'batch',
    input_tokens: 0,  // Unknown at submission time
    output_tokens: 0,
    // 'submitted' matches what the Hetzner orchestrator writes. This used to
    // say 'pending' while logBatchResult() below looked for... 'pending', and
    // the orchestrator's rows were never matched by either (#3452).
    status: 'submitted',
  });
}

/**
 * Update a batch job log when results are received
 */
export async function logBatchResult(params: {
  batch_job_id: string;
  input_tokens: number;
  output_tokens: number;
  status: GeminiStatus;
  error_message?: string;
}): Promise<void> {
  try {
    if (supabaseAdmin) {
      // Find the pending entry on Supabase
      const { data: existing } = await supabaseAdmin
        .from('gemini_usage')
        .select('id, model')
        .eq('batch_job_id', params.batch_job_id)
        .in('status', PLACEHOLDER_STATUSES)
        .limit(1)
        .single();

      if (existing) {
        const cost = calculateCost(
          existing.model || 'gemini-3-flash-preview',
          params.input_tokens,
          params.output_tokens,
          true
        );

        await supabaseAdmin
          .from('gemini_usage')
          .update({
            input_tokens: params.input_tokens,
            output_tokens: params.output_tokens,
            cost_usd: cost,
            status: params.status,
            error_message: params.error_message,
            completed_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      } else {
        // Create new entry if pending not found
        await logGeminiCall({
          type: 'ocr',
          mode: 'batch',
          model: 'gemini-3-flash-preview',
          batch_job_id: params.batch_job_id,
          input_tokens: params.input_tokens,
          output_tokens: params.output_tokens,
          status: params.status,
          error_message: params.error_message,
        });
      }
    } else {
      // Fallback to MongoDB if Supabase unavailable
      const db = await getDb();
      const existing = await db.collection('gemini_usage').findOne({
        batch_job_id: params.batch_job_id,
        status: { $in: PLACEHOLDER_STATUSES },
      });

      if (existing) {
        const cost = calculateCost(existing.model, params.input_tokens, params.output_tokens, true);
        await db.collection('gemini_usage').updateOne(
          { _id: existing._id },
          { $set: { input_tokens: params.input_tokens, output_tokens: params.output_tokens, cost_usd: cost, status: params.status, error_message: params.error_message, completed_at: new Date() } },
        );
      } else {
        await logGeminiCall({ type: 'ocr', mode: 'batch', model: 'gemini-3-flash-preview', batch_job_id: params.batch_job_id, input_tokens: params.input_tokens, output_tokens: params.output_tokens, status: params.status, error_message: params.error_message });
      }
    }
  } catch (error) {
    console.error('[gemini-logger] Failed to log batch result:', error);
  }
}

/**
 * Get usage summary for a time period
 */
export async function getUsageSummary(params: {
  startDate?: Date;
  endDate?: Date;
  book_id?: string;
}): Promise<{
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  by_type: Record<string, { calls: number; cost: number }>;
  by_model: Record<string, { calls: number; cost: number }>;
}> {
  // gemini_usage is RLS-locked to service_role (see #1981); no anon fallback.
  if (!supabaseAdmin) {
    throw new Error('supabaseAdmin not configured — SUPABASE_SERVICE_ROLE_KEY missing');
  }
  const client = supabaseAdmin;

  // Note: PostgREST defaults to 1000 rows. For book-scoped queries this is fine.
  // For time-range queries across all books, use dashboard_usage view instead.
  // Placeholder rows carry zeros and (pre-#3452) a duplicate of the collected
  // row's page_count — including them inflates call counts and can only ever
  // drag the average cost toward zero.
  let query = client.from('gemini_usage')
    .select('type, model, input_tokens, output_tokens, cost_usd')
    .not('status', 'in', `(${NON_SPEND_STATUSES.join(',')})`)
    .limit(50000);
  if (params.startDate) query = query.gte('timestamp', params.startDate.toISOString());
  if (params.endDate) query = query.lte('timestamp', params.endDate.toISOString());
  if (params.book_id) query = query.eq('book_id', params.book_id);

  const { data: rows } = await query;

  const byType: Record<string, { calls: number; cost: number }> = {};
  const byModel: Record<string, { calls: number; cost: number }> = {};
  let total_calls = 0, total_input_tokens = 0, total_output_tokens = 0, total_cost_usd = 0;

  for (const r of rows || []) {
    total_calls++;
    total_input_tokens += r.input_tokens || 0;
    total_output_tokens += r.output_tokens || 0;
    total_cost_usd += r.cost_usd || 0;

    const t = r.type || 'unknown';
    if (!byType[t]) byType[t] = { calls: 0, cost: 0 };
    byType[t].calls++;
    byType[t].cost += r.cost_usd || 0;

    const m = r.model || 'unknown';
    if (!byModel[m]) byModel[m] = { calls: 0, cost: 0 };
    byModel[m].calls++;
    byModel[m].cost += r.cost_usd || 0;
  }

  return { total_calls, total_input_tokens, total_output_tokens, total_cost_usd, by_type: byType, by_model: byModel };
}
