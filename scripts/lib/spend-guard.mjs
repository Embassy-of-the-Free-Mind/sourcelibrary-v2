/**
 * spend-guard — the budget dial (issue #3737).
 *
 * Makes pipeline spend a NUMBER someone sets rather than a switch someone
 * fears. The orchestrator's paid dispatch phases (2: OCR submit, 4:
 * translation dispatch) call budgetAllowsDispatch() before creating work;
 * once today's measured Gemini spend reaches the ceiling, dispatch stops.
 * In-flight work always finishes — nothing is killed mid-book.
 *
 * The dial: `system_config.processing_control.daily_budget_usd`.
 *   - unset / null / 0  → NO paid dispatch (default-closed: flipping the old
 *     `paused` flag off must not reopen unbounded spending by accident)
 *   - positive number   → dispatch until today's spend reaches it (UTC day)
 *
 * Spend is measured from `gemini_usage`. Two deliberate choices:
 *   - Rows are selected by **ObjectId time range**, not the `timestamp` field —
 *     old rows store timestamp as a string, and Date-range queries silently
 *     return nothing (known trap, pipeline-architecture "Known traps").
 *   - `cost_usd` is a computed estimate, not billed truth, and some writers
 *     omit it. Missing costs count as 0, so the guard can UNDERCOUNT — treat
 *     the ceiling as a strong brake, not an accounting system. The costless
 *     row count is returned so the log shows how blind the measurement is.
 */

import { ObjectId } from 'mongodb';

/** Start of the current UTC day. */
export function utcDayStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Today's measured Gemini spend: { usd, rows, costlessRows }. */
export async function getTodaySpendUsd(db, now = new Date()) {
  const minId = ObjectId.createFromTime(Math.floor(utcDayStart(now).getTime() / 1000));
  const [agg] = await db.collection('gemini_usage').aggregate([
    { $match: { _id: { $gte: minId } } },
    {
      $group: {
        _id: null,
        usd: { $sum: { $ifNull: ['$cost_usd', 0] } },
        rows: { $sum: 1 },
        costlessRows: { $sum: { $cond: [{ $ifNull: ['$cost_usd', false] }, 0, 1] } },
      },
    },
  ]).toArray();
  return { usd: agg?.usd || 0, rows: agg?.rows || 0, costlessRows: agg?.costlessRows || 0 };
}

/** The dial's current value, or null when unset/invalid. */
export function readDailyBudgetUsd(control) {
  const v = control?.daily_budget_usd;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * The gate. Returns true iff paid dispatch may proceed right now, and logs
 * one line either way so the dial is always visible in the phase logs.
 *
 * opts.bypass mirrors the pause-flag semantics for explicit single-book
 * operator runs (--phase N --book=ID): a human at the wheel outranks the dial
 * for one book, exactly as they outrank the pause.
 */
export async function budgetAllowsDispatch(db, label, { bypass = false, control: preloadedControl } = {}) {
  if (bypass) {
    console.log(`  [spend-guard] ${label}: BYPASS (explicit --book operator run)`);
    return true;
  }
  const control = preloadedControl
    ?? await db.collection('system_config').findOne({ _id: 'processing_control' });
  const budget = readDailyBudgetUsd(control);
  if (budget === null) {
    console.log(`  [spend-guard] ${label}: no daily_budget_usd set — paid dispatch stays OFF (the dial is default-closed).`);
    return false;
  }
  const spend = await getTodaySpendUsd(db);
  const allowed = spend.usd < budget;
  const blind = spend.costlessRows > 0 ? ` (${spend.costlessRows} rows without cost_usd — spend is undercounted)` : '';
  console.log(`  [spend-guard] ${label}: spend $${spend.usd.toFixed(2)} / $${budget.toFixed(2)} today (UTC), ${spend.rows} calls${blind} → ${allowed ? 'DISPATCH' : 'CEILING REACHED — no new dispatch'}`);
  return allowed;
}
