/**
 * PRIOR ART: scripts/lib/spend-guard.mjs — the DAILY dial for pipeline workers. It sums
 * all `gemini_usage` spend per UTC day and gates dispatch; it has no notion of a
 * per-feature MONTHLY ceiling, and the hand-run FT scripts that fire grounded search never
 * call it. scripts/lib/model-pricing.mjs `searchCostOf` prices a call; it does not
 * accumulate or refuse. scripts/audit/spend-reconcile.mjs reads the bill after the fact.
 * None of them can stop a grounded run before it crosses a monthly line, which is the gap.
 *
 * grounding-budget — a hard monthly ceiling on Google Search grounding spend.
 *
 * WHY (2026-09-26). Grounded search bills per search query the model issues ($0.014 on
 * Gemini 3.x). Two FT verification runs billed $3,229 in Aug–Sep while logging ~$30,
 * because nothing recorded the search fee and every budget counted tokens only. Derek's
 * rule: grounded search stays under $100/month, across every script.
 *
 * HOW
 *   const gb = await openGroundingBudget({ endpoint: 'scripts/eval/ft-ladder.ts' });
 *   // before each grounded call:
 *   if (!gb.allows()) { stop the run }
 *   // after each grounded call (success OR parse failure — the searches were billed):
 *   await gb.record({ model, queries: webSearchQueries.length, book_id });
 *
 * `record` writes a `gemini_usage` row (type `grounded_search`, cost = searchCostOf)
 * through the normal usage logger, so the daily dial and spend reports see search spend
 * too. `openGroundingBudget` sums this month's `grounded_search` rows from Supabase and
 * FAILS CLOSED: an unreadable meter refuses the run rather than green-lighting it
 * (spend-controls.md, failure mode 1).
 *
 * The ceiling is GROUNDING_MONTHLY_CAP_USD (default 100). Raising it is a decision, not
 * a flag: there is deliberately no --force.
 *
 * Standing check: tests/unit/grounding-budget-guard.test.ts fails if a file that enables
 * `googleSearch` does not import this module (or sit on its short, reasoned allow-list).
 */
import { logUsage } from '../workers/lib/supabase-usage-logger.mjs';
import { searchCostOf, GROUNDED_SEARCH_USD_PER_QUERY } from './model-pricing.mjs';

export const GROUNDING_TYPE = 'grounded_search';
export const DEFAULT_MONTHLY_CAP_USD = 100;

export function monthlyCapUsd(env = process.env) {
  const v = parseFloat(env.GROUNDING_MONTHLY_CAP_USD ?? '');
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_MONTHLY_CAP_USD;
}

export function utcMonthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Sum of this month's recorded grounding spend. Throws if the meter cannot be read. */
export async function monthToDateGroundingUsd({ now = new Date(), fetchImpl = fetch, env = process.env } = {}) {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('grounding-budget: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — cannot read the grounding meter, refusing to spend');
  const since = utcMonthStart(now).toISOString();
  let total = 0, offset = 0;
  // Paginate explicitly: PostgREST silently caps a response at 1,000 rows.
  for (;;) {
    const q = `${url}/rest/v1/gemini_usage?select=cost_usd&type=eq.${GROUNDING_TYPE}&timestamp=gte.${encodeURIComponent(since)}&order=id.asc`;
    const res = await fetchImpl(q, { headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${offset}-${offset + 999}` } });
    if (!res.ok) throw new Error(`grounding-budget: meter read failed (${res.status}) — refusing to spend`);
    const rows = await res.json();
    for (const r of rows) total += Number(r.cost_usd) || 0;
    if (rows.length < 1000) break;
    offset += 1000;
  }
  return total;
}

/**
 * Open the month's grounding budget for one run. Throws (fail closed) if the meter is
 * unreadable or the month is already at the cap.
 */
export async function openGroundingBudget({ endpoint, now = new Date(), env = process.env, fetchImpl = fetch, log = console } = {}) {
  if (!endpoint) throw new Error('grounding-budget: endpoint is required — it labels who spent');
  const cap = monthlyCapUsd(env);
  const spentBefore = await monthToDateGroundingUsd({ now, env, fetchImpl });
  let spentThisRun = 0;
  const remaining = () => Math.max(0, cap - spentBefore - spentThisRun);
  log.log?.(`grounding budget: $${spentBefore.toFixed(2)} of $${cap} used this month, $${remaining().toFixed(2)} left `
    + `(search bills $${GROUNDED_SEARCH_USD_PER_QUERY}/query; flash-preview averages ~16 queries per FT book)`);
  if (remaining() <= 0) {
    throw new Error(`grounding-budget: this month's grounded-search spend is $${spentBefore.toFixed(2)}, at or over the $${cap} cap. `
      + 'No grounded calls until next month (or a deliberate GROUNDING_MONTHLY_CAP_USD change).');
  }
  return {
    cap, spentBefore,
    get spentThisRun() { return spentThisRun; },
    remaining,
    /** True while there is budget for at least one more average call. */
    allows(reserveUsd = 0.25) { return remaining() >= reserveUsd; },
    /** Record the searches one grounded call fired. Returns that call's search cost. */
    async record({ model, queries = 0, book_id = null, db = null }) {
      const cost = searchCostOf(model, queries);
      spentThisRun += cost;
      if (cost > 0) {
        await logUsage({
          type: GROUNDING_TYPE, mode: 'realtime', model, book_id, endpoint,
          input_tokens: 0, output_tokens: 0, page_count: 0, cost_usd: cost,
          prompt_version: `search_queries=${queries}`,
        }, db).catch((e) => log.warn?.(`grounding-budget: usage row not written (${e?.message ?? e}) — spend still counted in this run`));
      }
      return cost;
    },
  };
}
