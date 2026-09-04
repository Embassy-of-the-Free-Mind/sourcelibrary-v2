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
 * RESOLVED 2026-09-03 (#4581). The dispute above is settled, and the answer is
 * the opposite of what this file previously chose.
 *
 * The old note said 0.075/0.30 was the "closest fit to recorded costs" and kept
 * 0.25/1.50 as DISPUTED_LEGACY. That test was CIRCULAR: recorded `cost_usd` was
 * itself computed from 0.075/0.30, so of course it fit. Fitting constants to
 * numbers those constants produced proves nothing.
 *
 * Google's own SKU catalogue is now the source of truth — an API, no console
 * needed, 634 Gemini SKUs:
 *   cloudbilling.googleapis.com/v1/services/AEFD-7695-64FA/skus
 * It gives `gemini 3.1 flash lite preview text` at **$0.25 in / $1.50 out**.
 * The "disputed legacy" pair was the correct one all along.
 *
 * VERIFY, DO NOT EDIT BY HAND:
 *   node --env-file=.env.production.local scripts/audit/spend-reconcile.mjs
 * It diffs this table AND src/lib/ai.ts against the live catalogue and exits 2
 * on drift. It caught two wrong rows in this file on the day it was written.
 *
 * CONSEQUENCE, unchanged and still worth stating: `gemini_usage.cost_usd` is
 * COMPUTED from these constants, never billed, so correcting a number here
 * changes what every cost report says. That is the intent — the reports were
 * understating — but it means historical rows and new rows are priced
 * differently. Do not compare a pre-2026-09-03 `cost_usd` to a later one.
 *
 * Reference: https://ai.google.dev/gemini-api/docs/pricing (summary only —
 * prefer the catalogue; the page omits some models entirely).
 */

/** Verified against the Cloud Billing SKU catalogue, standard tier, text. */
export const MODEL_PRICING = {
  'gemini-3-flash-preview':  { input: 0.50, output: 3.00 },
  'gemini-3.1-flash-lite':   { input: 0.25, output: 1.50 },  // was 0.075/0.30 — see RESOLVED above
  'gemini-3.5-flash-lite':   { input: 0.30, output: 2.50 },
  'gemini-3.5-flash':        { input: 1.50, output: 9.00 },
  'gemini-3.6-flash':        { input: 0.75, output: 3.75 },  // was 1.50/7.50
  'gemini-3.7-flash':        { input: 0.75, output: 3.75 },
  'gemini-3.1-pro-preview':  { input: 2.50, output: 15.00 }, // not verifiable — no unambiguous SKU
  'gemini-3-pro-preview':    { input: 2.50, output: 10.00 }, // not verifiable — no unambiguous SKU
  'gemini-2.5-flash':        { input: 0.15, output: 0.60 },  // catalogue splits by long/short input
  'gemini-2.5-pro':          { input: 1.25, output: 5.00 },
};

/**
 * Batch is exactly HALF of every standard rate above, across every model in the
 * catalogue. Callers pricing batch work must halve, or they overstate ~2x.
 */
export const BATCH_MULTIPLIER = 0.5;

/**
 * Deliberately EXPENSIVE. An unpriced model should overstate so it gets
 * noticed, rather than hide under a cheap default. Previously 0.50/3.00.
 */
export const DEFAULT_PRICING = { input: 1.50, output: 9.00 };

/**
 * What `gemini_usage.cost_usd` rows written BEFORE 2026-09-03 were computed
 * with. Kept — not deleted — because those rows are still in the database and
 * anyone reconstructing historical spend needs the rate that produced them.
 *
 * This replaces the old `DISPUTED_LEGACY_PRICING`, which held the opposite
 * pair. The dispute is resolved (see the header): the rate below is the WRONG
 * one, and it is recorded here precisely so old numbers can be re-derived and
 * corrected, rather than silently compared against new ones.
 */
export const SUPERSEDED_PRICING_BEFORE_2026_09_03 = {
  'gemini-3.1-flash-lite': { input: 0.075, output: 0.30 },
  'gemini-3.6-flash': { input: 1.50, output: 7.50 },
};

/**
 * PER-PAGE rates — what a page of work actually COSTS US, as opposed to the
 * per-token vendor prices above.
 *
 * These are OBSERVATIONS, not prices. They are the ratio of `gemini_usage`
 * cost to pages over a recent window, so they move whenever prompt length,
 * model routing, or page density moves. They exist because four separate
 * scripts had each hardcoded their own copy of a 2026-07-16 measurement
 * ($0.00079/page) and were still printing it in September, understating every
 * estimate by ~2.8x. A stale constant is invisible; that is the whole failure.
 *
 * Two rules, both learned the hard way:
 *   1. NEVER print a rate without its measurement date. Use `describePageRate`.
 *      The old constant survived 7 weeks because the output said "$3.18" and
 *      never said "at a rate measured in July".
 *   2. RE-MEASURE before quoting these anywhere that matters. One query:
 *
 *        select type, mode, model, sum(cost_usd), sum(page_count)
 *        from gemini_usage where timestamp >= <recent> group by 1,2,3
 *
 * Measured 2026-09-04 over rows since 2026-09-03 (i.e. priced with the
 * corrected constants from #4601 — do not mix with older rows):
 *   translation realtime lite  $0.00241/pg  (9,971 pages, n=2,737)
 *   ocr batch lite             $0.00222/pg  (8,656 pages, n=352)
 *   extract_images flash       $0.00285/pg  (1,622 pages, n=30)
 *   index/summary/chapters     ~$0.0001/pg combined — negligible
 *
 * DELIBERATELY ABSENT: batch OCR on flash-preview. It measures $0.00106/pg,
 * which is below the lite rate and cannot be right — the flash batch rows are
 * contaminated by uncollected $0 placeholders (#4567). An obviously-wrong
 * number is safer missing than published.
 */
export const PAGE_RATES_MEASURED_ON = '2026-09-04';

export const PAGE_RATE_USD = {
  ocrBatch: 0.00222,
  translationRealtime: 0.00241,
  imageExtraction: 0.00285,
  enrichmentTail: 0.0001,
};

/** A rate never travels without its vintage. */
export function describePageRate(rate) {
  return `$${rate}/page (measured ${PAGE_RATES_MEASURED_ON})`;
}

/** Estimate for a mixed OCR + translation remainder, the common case. */
export function estimatePagesCost({ ocrPages = 0, translationPages = 0 }) {
  return ocrPages * PAGE_RATE_USD.ocrBatch + translationPages * PAGE_RATE_USD.translationRealtime;
}

export function priceFor(model) {
  return MODEL_PRICING[model] || DEFAULT_PRICING;
}

/** Cost in USD for one call. */
export function costOf(model, inputTokens = 0, outputTokens = 0) {
  const p = priceFor(model);
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
}
