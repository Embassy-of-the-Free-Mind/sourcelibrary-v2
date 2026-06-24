import { getDb } from '@/lib/mongodb';
import { MODEL_PRICING } from '@/lib/ai';

/**
 * Per-call usage + cost logging for user-facing AI features (explain, ai-search
 * expansion, voice, …). There was no visibility into AI spend on the request
 * path even though the pipeline is paused over Gemini cost — this fills that gap.
 * Writes one row per call to the `ai_usage` collection; fire-and-forget so it
 * never adds latency or fails a request.
 */

export function estimateCostUsd(model: string, inputTokens = 0, outputTokens = 0): number {
  const p = MODEL_PRICING[model] || MODEL_PRICING['default'];
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

interface AiUsage {
  feature: string;            // 'explain' | 'ai_search_expand' | 'voice' | ...
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;           // if omitted, estimated from model + tokens
  ms?: number;                // latency
  ok?: boolean;
  anon?: boolean;             // unauthenticated caller
  country?: string | null;
}

export function logAiUsage(u: AiUsage): void {
  try {
    const costUsd = u.costUsd ?? (u.model ? estimateCostUsd(u.model, u.inputTokens, u.outputTokens) : 0);
    const doc = {
      ...u,
      inputTokens: u.inputTokens ?? 0,
      outputTokens: u.outputTokens ?? 0,
      costUsd,
      timestamp: new Date(),
      created_at: new Date(),
    };
    // Don't await — never hold the request on the log write.
    Promise.race([
      (async () => {
        const db = await getDb();
        await db.collection('ai_usage').insertOne(doc);
      })(),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]).catch(() => {});
  } catch {
    /* never throw */
  }
}
