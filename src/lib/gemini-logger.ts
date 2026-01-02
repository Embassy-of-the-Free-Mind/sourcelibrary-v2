/**
 * Gemini API Usage Logger
 *
 * Logs all Gemini API calls (realtime and batch) for auditing.
 * Stores in MongoDB `gemini_usage` collection.
 *
 * Usage:
 *   import { logGeminiCall, logBatchSubmission, logBatchResult } from '@/lib/gemini-logger';
 *
 *   // For realtime calls
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
 *   // For batch submissions
 *   await logBatchSubmission({
 *     batch_job_id: 'job123',
 *     gemini_job_name: 'batches/xyz',
 *     ...
 *   });
 */

import { getDb } from './mongodb';

// Pricing per 1M tokens (as of Jan 2025)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-3-pro-preview': { input: 2.50, output: 10.00 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.5-pro': { input: 1.25, output: 5.00 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
};

// Batch API gets 50% discount
const BATCH_DISCOUNT = 0.5;

export type GeminiCallType = 'ocr' | 'translate' | 'summarize' | 'extract_images' | 'index' | 'other';
export type GeminiMode = 'realtime' | 'batch';
export type GeminiStatus = 'success' | 'failed' | 'pending' | 'submitted';

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

  // Metadata
  prompt_version?: string;
  endpoint?: string;  // Which API route triggered this
}

function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  isBatch: boolean
): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['gemini-2.5-flash'];
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
  prompt_version?: string;
  endpoint?: string;
}): Promise<void> {
  try {
    const db = await getDb();

    const log: GeminiUsageLog = {
      id: generateId(),
      timestamp: new Date(),
      type: params.type,
      mode: params.mode,
      model: params.model,
      book_id: params.book_id,
      book_title: params.book_title,
      page_ids: params.page_ids,
      page_count: params.page_count || params.page_ids?.length || 0,
      batch_job_id: params.batch_job_id,
      gemini_job_name: params.gemini_job_name,
      input_tokens: params.input_tokens,
      output_tokens: params.output_tokens,
      cost_usd: calculateCost(params.model, params.input_tokens, params.output_tokens, params.mode === 'batch'),
      status: params.status,
      error_message: params.error_message,
      prompt_version: params.prompt_version,
      endpoint: params.endpoint,
    };

    await db.collection('gemini_usage').insertOne(log);
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
    status: 'pending',
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
    const db = await getDb();

    // Find the pending log entry
    const existing = await db.collection('gemini_usage').findOne({
      batch_job_id: params.batch_job_id,
      status: 'pending',
    });

    if (existing) {
      // Update existing entry
      const cost = calculateCost(
        existing.model,
        params.input_tokens,
        params.output_tokens,
        true
      );

      await db.collection('gemini_usage').updateOne(
        { _id: existing._id },
        {
          $set: {
            input_tokens: params.input_tokens,
            output_tokens: params.output_tokens,
            cost_usd: cost,
            status: params.status,
            error_message: params.error_message,
            completed_at: new Date(),
          },
        }
      );
    } else {
      // Create new entry if pending not found (e.g., from script without submission log)
      await logGeminiCall({
        type: 'ocr', // Default, could be improved
        mode: 'batch',
        model: 'gemini-2.5-flash', // Default
        batch_job_id: params.batch_job_id,
        input_tokens: params.input_tokens,
        output_tokens: params.output_tokens,
        status: params.status,
        error_message: params.error_message,
      });
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
  const db = await getDb();

  const match: Record<string, unknown> = {};
  if (params.startDate || params.endDate) {
    match.timestamp = {};
    if (params.startDate) (match.timestamp as Record<string, Date>).$gte = params.startDate;
    if (params.endDate) (match.timestamp as Record<string, Date>).$lte = params.endDate;
  }
  if (params.book_id) {
    match.book_id = params.book_id;
  }

  const results = await db.collection('gemini_usage').aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total_calls: { $sum: 1 },
        total_input_tokens: { $sum: '$input_tokens' },
        total_output_tokens: { $sum: '$output_tokens' },
        total_cost_usd: { $sum: '$cost_usd' },
      },
    },
  ]).toArray();

  const byType = await db.collection('gemini_usage').aggregate([
    { $match: match },
    {
      $group: {
        _id: '$type',
        calls: { $sum: 1 },
        cost: { $sum: '$cost_usd' },
      },
    },
  ]).toArray();

  const byModel = await db.collection('gemini_usage').aggregate([
    { $match: match },
    {
      $group: {
        _id: '$model',
        calls: { $sum: 1 },
        cost: { $sum: '$cost_usd' },
      },
    },
  ]).toArray();

  const summary = results[0] || {
    total_calls: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cost_usd: 0,
  };

  return {
    total_calls: summary.total_calls,
    total_input_tokens: summary.total_input_tokens,
    total_output_tokens: summary.total_output_tokens,
    total_cost_usd: summary.total_cost_usd,
    by_type: Object.fromEntries(byType.map(r => [r._id, { calls: r.calls, cost: r.cost }])),
    by_model: Object.fromEntries(byModel.map(r => [r._id, { calls: r.calls, cost: r.cost }])),
  };
}
