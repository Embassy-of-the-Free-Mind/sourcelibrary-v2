import { GoogleGenerativeAI, type GenerativeModel, type ModelParams, type RequestOptions } from '@google/generative-ai';
import { logGeminiCall, outputTokensFrom, type GeminiCallType, type GeminiTrigger } from './gemini-logger';

/**
 * API Key rotation for Gemini to handle rate limits
 *
 * Set multiple API keys in environment variables:
 * - GEMINI_API_KEY (primary)
 * - GEMINI_API_KEY_2, GEMINI_API_KEY_3, etc. (additional keys)
 *
 * AND the metering chokepoint (#4599). Every client handed out here logs a
 * `gemini_usage` row for every `generateContent` / `generateContentStream`
 * call, so a call site cannot spend money silently by forgetting to log — it
 * can only spend money with a worse LABEL. Pass `{ endpoint }` to say who is
 * spending; without it the row still lands, tagged `unlabelled`, and shows up
 * as such in `spend-reconcile`'s attribution table.
 *
 * Measured August 2026: 417,936 successful GenerateContent calls at Google
 * against 305,800 metered rows — 27% of calls wrote no usage row at all, and
 * the request-path routes (chat, ask, explain, identify, ai-expand,
 * detect-split, split-gemini) were the largest identified block of them.
 */

// Parse all available API keys from environment
function getApiKeys(): string[] {
  const keys: string[] = [];

  // Primary key
  if (process.env.GEMINI_API_KEY) {
    keys.push(process.env.GEMINI_API_KEY);
  }

  // Additional numbered keys (2-10)
  for (let i = 2; i <= 10; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (key) {
      keys.push(key);
    }
  }

  return keys;
}

// Track which key to use next (simple round-robin)
let currentKeyIndex = 0;

// Track rate limit errors per key
const keyErrors: Map<string, { count: number; lastError: number }> = new Map();

// Cooldown period after rate limit (60 seconds)
const RATE_LIMIT_COOLDOWN_MS = 60000;

/**
 * Get the next available API key using round-robin rotation
 * Skips keys that recently hit rate limits
 */
export function getNextApiKey(): string {
  const keys = getApiKeys();

  if (keys.length === 0) {
    throw new Error('No GEMINI_API_KEY configured');
  }

  if (keys.length === 1) {
    return keys[0];
  }

  const now = Date.now();
  let attempts = 0;

  // Try to find a key that isn't in cooldown
  while (attempts < keys.length) {
    const key = keys[currentKeyIndex];
    const keyId = key.slice(-8); // Last 8 chars for logging
    const errorInfo = keyErrors.get(keyId);

    // Rotate to next key for next call
    currentKeyIndex = (currentKeyIndex + 1) % keys.length;

    // Check if this key is in cooldown
    if (errorInfo && (now - errorInfo.lastError) < RATE_LIMIT_COOLDOWN_MS) {
      console.log(`[Gemini] Key ...${keyId} in cooldown, trying next`);
      attempts++;
      continue;
    }

    // Clear old error info
    if (errorInfo && (now - errorInfo.lastError) >= RATE_LIMIT_COOLDOWN_MS) {
      keyErrors.delete(keyId);
    }

    return key;
  }

  // All keys in cooldown, use the one with oldest error
  console.warn('[Gemini] All keys in cooldown, using oldest');
  return keys[currentKeyIndex];
}

/**
 * Report a rate limit error for a key
 */
export function reportRateLimitError(apiKey: string): void {
  const keyId = apiKey.slice(-8);
  const existing = keyErrors.get(keyId) || { count: 0, lastError: 0 };
  keyErrors.set(keyId, {
    count: existing.count + 1,
    lastError: Date.now(),
  });
  console.warn(`[Gemini] Rate limit hit for key ...${keyId} (${existing.count + 1} times)`);
}

/**
 * Who is spending. `endpoint` is the label that makes a cost attributable to a
 * workstream — the route path for a request-path call ('/api/explain'), or the
 * module for a background one ('cover-selection'). Keep it stable: it is the
 * grouping key in every spend report.
 */
export interface GeminiMeter {
  endpoint: string;
  type?: GeminiCallType;
  book_id?: string;
  page_ids?: string[];
  triggered_by?: GeminiTrigger;
  prompt_version?: string;
}

/**
 * Opt out of automatic metering, because this lane already writes its own
 * richer row (page ids, job id, pages-per-request, prompt version) and a second
 * automatic row would DOUBLE-COUNT the spend — which would close the daily dial
 * early on money that was never spent.
 *
 * `reason` is required and unused at runtime: the declaration is the artifact.
 */
export interface SelfMeteredGemini {
  selfMetered: true;
  reason: string;
}

const isSelfMetered = (m?: GeminiMeter | SelfMeteredGemini): m is SelfMeteredGemini =>
  !!m && 'selfMetered' in m;

type GenerateArgs = Parameters<GenerativeModel['generateContent']>;
type StreamArgs = Parameters<GenerativeModel['generateContentStream']>;

/**
 * Wrap one model so both generate paths record what they cost.
 *
 * The row is written AFTER the call resolves and is AWAITED, which costs a
 * Supabase round trip (~50ms) on top of a call that took seconds. That is
 * deliberate: an un-awaited log in a serverless function is a log that may be
 * killed with the response, and a meter that drops rows under load drops them
 * exactly when spend is highest. `logGeminiCall` swallows its own errors, so a
 * metering failure can never fail the request.
 *
 * Failures are logged too, with status 'failed'. Google's own call count
 * includes only HTTP 200s, so anything comparing the two must exclude them —
 * `spend-reconcile` does.
 */
function meterModel(model: GenerativeModel, modelId: string, meter: GeminiMeter): GenerativeModel {
  const generate = model.generateContent.bind(model);
  const stream = model.generateContentStream.bind(model);

  const record = async (
    usage: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined,
    startedAt: number,
    error?: unknown,
  ) => {
    await logGeminiCall({
      type: meter.type || 'other',
      mode: 'realtime',
      model: modelId,
      book_id: meter.book_id,
      page_ids: meter.page_ids,
      input_tokens: usage?.promptTokenCount || 0,
      output_tokens: outputTokensFrom(usage),
      status: error ? 'failed' : 'success',
      error_message: error ? String((error as Error)?.message ?? error).slice(0, 500) : undefined,
      duration_ms: Date.now() - startedAt,
      endpoint: meter.endpoint,
      triggered_by: meter.triggered_by,
      prompt_version: meter.prompt_version,
    });
  };

  model.generateContent = async (...args: GenerateArgs) => {
    const startedAt = Date.now();
    try {
      const result = await generate(...args);
      await record(result?.response?.usageMetadata, startedAt);
      return result;
    } catch (err) {
      await record(undefined, startedAt, err);
      throw err;
    }
  };

  model.generateContentStream = async (...args: StreamArgs) => {
    const startedAt = Date.now();
    try {
      const result = await stream(...args);
      // The stream's usage only exists once the aggregated response resolves.
      // Attach to that promise rather than awaiting it here — awaiting would
      // buffer the whole stream and defeat streaming for the caller.
      result.response
        .then((r) => record(r?.usageMetadata, startedAt))
        .catch((err) => record(undefined, startedAt, err));
      return result;
    } catch (err) {
      await record(undefined, startedAt, err);
      throw err;
    }
  };

  return model;
}

/**
 * Get a GoogleGenerativeAI instance with the next available key, metered.
 *
 * Every model it hands out logs its own usage. Pass a `meter` to say which
 * workstream is spending; omit it and the spend is still recorded, but only as
 * `unlabelled` — findable in the attribution table, not attributable to you.
 */
export function getGeminiClient(meter?: GeminiMeter | SelfMeteredGemini): GoogleGenerativeAI {
  const apiKey = getNextApiKey();
  const client = new GoogleGenerativeAI(apiKey);
  if (isSelfMetered(meter)) return client;
  const getModel = client.getGenerativeModel.bind(client);
  const ctx: GeminiMeter = meter ?? { endpoint: 'unlabelled' };
  client.getGenerativeModel = (params: ModelParams, requestOptions?: RequestOptions) =>
    meterModel(getModel(params, requestOptions), params.model, ctx);
  return client;
}

/**
 * The raw, UNMETERED client. Exists for the one case where logging is wrong:
 * validating a key that belongs to someone else, where writing a
 * `gemini_usage` row would attribute a third party's spend to us. Anything
 * that spends OUR money uses `getGeminiClient`.
 */
export function getUnmeteredGeminiClient(apiKey: string): GoogleGenerativeAI {
  return new GoogleGenerativeAI(apiKey);
}

/**
 * Get API key stats for debugging
 */
export function getKeyStats(): { totalKeys: number; inCooldown: number } {
  const keys = getApiKeys();
  const now = Date.now();
  let inCooldown = 0;

  for (const key of keys) {
    const keyId = key.slice(-8);
    const errorInfo = keyErrors.get(keyId);
    if (errorInfo && (now - errorInfo.lastError) < RATE_LIMIT_COOLDOWN_MS) {
      inCooldown++;
    }
  }

  return { totalKeys: keys.length, inCooldown };
}
