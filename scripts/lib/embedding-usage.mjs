/**
 * Embedding spend, recorded (#4162).
 *
 * ## Why this exists
 *
 * `budgetAllowsDispatch` (scripts/lib/spend-guard.mjs) is the repo's one brake
 * on Gemini spend: it sums today's `gemini_usage` rows and stops paid dispatch
 * at the daily ceiling. Neither page embedder wrote to that table, so the brake
 * was measuring OCR and translation only — embedding was free as far as every
 * instrument in the building was concerned.
 *
 * That is not a theoretical gap. In Aug 2026 the Spanish backfill (#4095) spent
 * ≈$11.65 that appears in no ledger; it had to be reconstructed afterwards by
 * measuring the corpus and multiplying by the published rate. A full English
 * pass is ≈$180 on the same arithmetic. A dial that cannot see the largest
 * embedding job in the repo does not report that it is blind — it just returns
 * a smaller number, which is exactly the failure `measurement-instruments.md`
 * is about.
 *
 * ## Tokens are ESTIMATED, and the row says so
 *
 * `batchEmbedContents` returns no `usageMetadata`, so there is no billed token
 * count to record. Rather than call `countTokens` on every batch (another round
 * trip per 50 texts, for a number that only feeds an estimate), this converts
 * characters at a ratio measured on the real corpus. `cost_usd` in this table
 * is already documented as a computed estimate rather than billed truth — see
 * the spend-guard header — so an estimated embedding row is consistent with its
 * neighbours, and vastly better than the zero that was there before.
 *
 * ## Aggregate before you log
 *
 * One row per 50-text batch would be ~78,000 rows for a full English pass, and
 * the spend guard treats >40,000 rows in a day as over-budget and fails closed.
 * Logging embedding spend must not be able to halt the pipeline. So callers
 * accumulate into one of these objects and flush periodically — per book for
 * the per-book writers, every FLUSH_EVERY_TEXTS for the streaming one.
 */

import { logUsage } from '../workers/lib/supabase-usage-logger.mjs';

/**
 * Measured on the Spanish corpus 2026-08-21 with `countTokens` over a 40-page
 * spread sample: 138,390 chars → 32,224 tokens. Re-measure if the corpus mix
 * changes a lot; a 10% error here is a 10% error in an estimate, not in a bill.
 */
export const EMBED_CHARS_PER_TOKEN = 4.29;

/** gemini-embedding-2-preview, paid tier, text input. Output tokens: none. */
export const EMBED_USD_PER_1M_TOKENS = 0.20;

/** Flush the streaming accumulator this often, to bound rows per run. */
export const FLUSH_EVERY_TEXTS = 5000;

/** A fresh accumulator. */
export function newEmbedUsage() {
  return { texts: 0, chars: 0 };
}

/** Record one successful batch against an accumulator. */
export function addEmbedUsage(usage, texts) {
  if (!usage || !texts?.length) return;
  usage.texts += texts.length;
  for (const t of texts) usage.chars += t.length;
}

/** Estimated input tokens for a character count. */
export function estimateTokens(chars) {
  return Math.round(chars / EMBED_CHARS_PER_TOKEN);
}

/** Estimated USD for a character count. */
export function estimateUsd(chars) {
  return estimateTokens(chars) / 1e6 * EMBED_USD_PER_1M_TOKENS;
}

/**
 * Write one `gemini_usage` row for everything accumulated so far, and reset.
 *
 * Never throws: a failure to RECORD spend must not stop the work that is
 * already paid for. It does warn, because a logger that fails silently
 * reproduces the very hole this module closes.
 *
 * @param {{texts:number, chars:number}} usage  accumulator, reset on success
 * @param {object} opts
 * @param {string} opts.model      the embedding model id
 * @param {string} [opts.bookId]   attribution, when the caller knows it
 * @param {string} opts.endpoint   e.g. 'worker/embed-page-texts'
 * @param {object} [opts.db]       Mongo handle for the logger's fallback path
 */
export async function logEmbeddingUsage(usage, { model, bookId, endpoint, db } = {}) {
  if (!usage || usage.texts === 0) return;
  const { texts, chars } = usage;
  usage.texts = 0;
  usage.chars = 0;
  try {
    await logUsage({
      type: 'embedding',
      mode: 'realtime',
      model,
      book_id: bookId || null,
      page_count: texts,
      input_tokens: estimateTokens(chars),
      // Embeddings return a vector, not tokens. Zero is the true value here,
      // not a missing one.
      output_tokens: 0,
      // Passed explicitly: the logger's MODEL_PRICING table falls back to
      // gemini-3-flash-preview for anything it does not know, which would
      // overstate embedding input by 2.5x.
      cost_usd: Math.round(estimateUsd(chars) * 1e6) / 1e6,
      status: 'success',
      endpoint,
    }, db || null);
  } catch (e) {
    console.warn(`[embedding-usage] could not record ${texts} texts (~$${estimateUsd(chars).toFixed(4)}): ${e.message}`);
  }
}
