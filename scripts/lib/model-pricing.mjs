/**
 * ONE table of model prices, per 1M tokens, in USD.
 *
 * WHY THIS EXISTS. The same constants were copied into ten files and drifted:
 * `gemini-3.1-flash-lite` was priced at 0.075/0.30 in the eval + enrich lane and
 * at 0.25/1.50 in the batch + usage-logging lane — 3.3x on input, 5x on output,
 * for the same model. Nothing surfaced the disagreement, because a cost figure
 * always looks plausible. Same shape as the `B-current.txt` prompt pin: a local
 * copy asserting it mirrors an external truth, drifting silently.
 *
 * THE VALUES BELOW ARE NOT VERIFIED AGAINST GOOGLE'S PRICE LIST. Solving the
 * stored `gemini_usage` rows for their implied rate (n=400 realtime
 * flash-lite rows) gives a mean relative error of 0.39 against 0.075/0.30 and
 * 1.83 against 0.25/1.50 — so recorded costs were computed with something near
 * the first pair, but neither pair fits cleanly. Cached-token pricing or a
 * third historical rate is the likely remainder. See #3576 (split out of the merged PR #3379).
 *
 * CONSEQUENCE, and the reason not to "just fix" it: `gemini_usage.cost_usd` is
 * COMPUTED from these constants, never billed. Changing a number here silently
 * rewrites what the cost dashboard reports. Do that deliberately, with #3576,
 * not as a drive-by.
 *
 * Reference: https://ai.google.dev/gemini-api/docs/pricing
 */

/** Prices used by the eval + enrich lane. Closest fit to recorded costs. */
export const MODEL_PRICING = {
  'gemini-3-flash-preview':  { input: 0.50, output: 3.00 },
  'gemini-3.1-flash-lite':   { input: 0.075, output: 0.30 },
  'gemini-3.5-flash-lite':   { input: 0.30, output: 2.50 },
  'gemini-3.6-flash':        { input: 1.50, output: 7.50 },
  'gemini-3.1-pro-preview':  { input: 2.50, output: 15.00 },
  'gemini-3-pro-preview':    { input: 2.50, output: 10.00 },
  'gemini-2.5-flash':        { input: 0.15, output: 0.60 },
  'gemini-2.5-pro':          { input: 1.25, output: 5.00 },
};

export const DEFAULT_PRICING = { input: 0.50, output: 3.00 };

/**
 * Rates that the batch/usage-logging lane used for the same models. Kept
 * EXPLICIT rather than deleted so the disagreement stays visible and any
 * reconciliation of historical `cost_usd` can reproduce what was written.
 */
export const DISPUTED_LEGACY_PRICING = {
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.50 },
};

export function priceFor(model) {
  return MODEL_PRICING[model] || DEFAULT_PRICING;
}

/** Cost in USD for one call. */
export function costOf(model, inputTokens = 0, outputTokens = 0) {
  const p = priceFor(model);
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
}
