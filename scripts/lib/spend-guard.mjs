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
 * Spend is measured from BOTH `gemini_usage` stores and SUMMED (#3826).
 * `supabase-usage-logger.mjs` writes to Supabase first and falls back to
 * Mongo only when the key is missing or the write errors — the two stores
 * are mutually exclusive per row (infrastructure-costs doc). The original
 * guard read Mongo alone and saw $9.00 on a day Supabase held ~$830: the
 * dial never closed and the day billed ~$2.3K. Never measure one store.
 *
 * Deliberate choices:
 *   - Mongo rows are selected by **ObjectId time range**, not the `timestamp`
 *     field — old rows store timestamp as a string, and Date-range queries
 *     silently return nothing (known trap, pipeline-architecture "Known traps").
 *   - Supabase `timestamp` is ISO text (its writer always sets it), queried
 *     via PostgREST with pagination — aggregates are disabled on this project
 *     (PGRST123), so we sum client-side, cost_usd column only.
 *   - FAIL CLOSED: if the Supabase read errors or overflows the pagination
 *     cap, the guard reports the failure and budgetAllowsDispatch refuses.
 *     An unreadable meter must stop the line, not green-light it — an
 *     unreadable primary store is exactly how the incident began.
 *   - `cost_usd` is a computed estimate, not billed truth (billed runs ~3×
 *     computed on runaway-heavy days), and some writers omit it. Treat the
 *     ceiling as a strong brake, not an accounting system. The costless row
 *     count is returned so the log shows how blind the measurement is.
 */

import { ObjectId } from 'mongodb';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// 40 pages × 1000 rows. A day with >40K usage rows is far past any sane dial —
// treat overflow as over-budget rather than scanning forever.
const SUPABASE_MAX_PAGES = 40;

/** Start of the current UTC day. */
export function utcDayStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Today's spend in the Mongo fallback store: { usd, rows, costlessRows }. */
async function getMongoSpend(db, dayStart) {
  const minId = ObjectId.createFromTime(Math.floor(dayStart.getTime() / 1000));
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

/**
 * Today's spend in the Supabase primary store. Client-side paginated sum
 * (PostgREST aggregates are disabled). Returns { usd, rows, costlessRows,
 * error } — error non-null means the meter is UNREADABLE, not zero.
 */
async function getSupabaseSpend(dayStart) {
  if (!SUPABASE_SERVICE_KEY) {
    return { usd: 0, rows: 0, costlessRows: 0, error: 'SUPABASE_SERVICE_ROLE_KEY missing' };
  }
  let usd = 0, rows = 0, costlessRows = 0;
  try {
    for (let pageNo = 0; ; pageNo++) {
      if (pageNo >= SUPABASE_MAX_PAGES) {
        return { usd, rows, costlessRows, error: `>${SUPABASE_MAX_PAGES * 1000} rows today — sum truncated` };
      }
      const from = pageNo * 1000;
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/gemini_usage?select=cost_usd&timestamp=gte.${dayStart.toISOString()}&order=id.asc`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            Range: `${from}-${from + 999}`,
          },
        },
      );
      if (!resp.ok && resp.status !== 206) {
        return { usd, rows, costlessRows, error: `Supabase read failed (${resp.status})` };
      }
      const batch = await resp.json();
      for (const r of batch) {
        rows++;
        if (r.cost_usd == null) costlessRows++;
        else usd += r.cost_usd;
      }
      if (batch.length < 1000) break;
    }
    return { usd, rows, costlessRows, error: null };
  } catch (err) {
    return { usd, rows, costlessRows, error: `Supabase read error: ${err.message}` };
  }
}

// Test seam: unit tests replace the Supabase reader (no network in tests).
let supabaseSpendReader = getSupabaseSpend;
export function _setSupabaseSpendReaderForTests(fn) {
  supabaseSpendReader = fn || getSupabaseSpend;
}

/**
 * Today's measured Gemini spend across BOTH stores (they are mutually
 * exclusive per row — sum, don't pick): { usd, rows, costlessRows,
 * meterError }. meterError non-null means the primary store could not be
 * fully read; callers must fail closed on it.
 */
export async function getTodaySpendUsd(db, now = new Date()) {
  const dayStart = utcDayStart(now);
  const [mongo, supa] = await Promise.all([getMongoSpend(db, dayStart), supabaseSpendReader(dayStart)]);
  return {
    usd: mongo.usd + supa.usd,
    rows: mongo.rows + supa.rows,
    costlessRows: mongo.costlessRows + supa.costlessRows,
    meterError: supa.error,
  };
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
  if (spend.meterError) {
    console.log(`  [spend-guard] ${label}: METER UNREADABLE (${spend.meterError}) — refusing dispatch. Partial sum was $${spend.usd.toFixed(2)}.`);
    return false;
  }
  const allowed = spend.usd < budget;
  const blind = spend.costlessRows > 0 ? ` (${spend.costlessRows} rows without cost_usd — spend is undercounted)` : '';
  console.log(`  [spend-guard] ${label}: spend $${spend.usd.toFixed(2)} / $${budget.toFixed(2)} today (UTC, both stores), ${spend.rows} calls${blind} → ${allowed ? 'DISPATCH' : 'CEILING REACHED — no new dispatch'}`);
  return allowed;
}

// ─── Scope envelopes (#4540) ────────────────────────────────────────────────
//
// A scope in processing_control.allow_scopes may carry its own budget:
//   allow_scopes.<tag> = { book_ids, collections, budget_usd, created_at, created_by }
// A book in such a scope may dispatch while the SCOPE's envelope has room,
// even when the global daily dial is closed. This is a second, separately
// accounted ceiling — never an absence of one (#3826 is why the dial is
// default-closed; an unbounded "allowlisted books ignore the ceiling" flag
// would recreate that exposure).
//
// Envelope spend is MEASURED from the same two usage stores as the daily
// dial, attributed by book_id membership since the scope's created_at.
// Nothing trusts a stored spent_usd counter — the guard measures, every
// time, and fails closed when it cannot read. Rows without a book_id can
// never be attributed to an envelope (they still count against the global
// dial), so an envelope's measured spend is a floor; the envelope is a
// brake, not an accounting system, same as the dial.

/** Scopes that carry a positive budget envelope. */
export function readScopeEnvelopes(control) {
  const scopes = control?.allow_scopes;
  if (!scopes || typeof scopes !== 'object') return [];
  const out = [];
  for (const tag of Object.keys(scopes)) {
    const s = scopes[tag];
    const b = s?.budget_usd;
    if (typeof b === 'number' && Number.isFinite(b) && b > 0) {
      out.push({
        tag,
        budget_usd: b,
        book_ids: Array.isArray(s.book_ids) ? s.book_ids.filter(Boolean).map(String) : [],
        collections: Array.isArray(s.collections) ? s.collections.filter(Boolean).map(String) : [],
        created_at: s.created_at ? new Date(s.created_at) : null,
      });
    }
  }
  return out;
}

/** Resolve one envelope's full book-id set (book_ids ∪ collection members). */
async function resolveEnvelopeIds(db, env) {
  const ids = new Set(env.book_ids);
  if (env.collections.length) {
    const rows = await db.collection('books')
      .find({ collections: { $in: env.collections } }, { projection: { id: 1 } })
      .toArray();
    for (const b of rows) ids.add(String(b.id));
  }
  return ids;
}

/** Spend attributed to a set of book ids in the Supabase primary store. */
async function getSupabaseScopeSpend(ids, since) {
  if (!SUPABASE_SERVICE_KEY) {
    return { usd: 0, rows: 0, error: 'SUPABASE_SERVICE_ROLE_KEY missing' };
  }
  let usd = 0, rows = 0;
  const sinceClause = since ? `&timestamp=gte.${since.toISOString()}` : '';
  try {
    for (let i = 0; i < ids.length; i += 80) { // chunk the in-list: keep URLs sane
      const inList = ids.slice(i, i + 80).map(encodeURIComponent).join(',');
      for (let pageNo = 0; ; pageNo++) {
        if (pageNo >= SUPABASE_MAX_PAGES) {
          return { usd, rows, error: `>${SUPABASE_MAX_PAGES * 1000} rows for one chunk — sum truncated` };
        }
        const from = pageNo * 1000;
        const resp = await fetch(
          `${SUPABASE_URL}/rest/v1/gemini_usage?select=cost_usd&book_id=in.(${inList})${sinceClause}&order=id.asc`,
          {
            headers: {
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              Range: `${from}-${from + 999}`,
            },
          },
        );
        if (!resp.ok && resp.status !== 206) {
          return { usd, rows, error: `Supabase read failed (${resp.status})` };
        }
        const batch = await resp.json();
        for (const r of batch) {
          rows++;
          if (r.cost_usd != null) usd += r.cost_usd;
        }
        if (batch.length < 1000) break;
      }
    }
    return { usd, rows, error: null };
  } catch (err) {
    return { usd, rows, error: `Supabase read error: ${err.message}` };
  }
}

// Test seam, same shape as the daily reader's.
let supabaseScopeSpendReader = getSupabaseScopeSpend;
export function _setSupabaseScopeSpendReaderForTests(fn) {
  supabaseScopeSpendReader = fn || getSupabaseScopeSpend;
}

/**
 * Measured spend attributed to a book-id set across BOTH stores, since a
 * given time (or all-time when since is null — tighter, never looser).
 * meterError non-null means the envelope is UNREADABLE; callers fail closed.
 */
export async function getScopeSpendUsd(db, { ids, since = null }) {
  const mongoMatch = { book_id: { $in: ids } };
  if (since) mongoMatch._id = { $gte: ObjectId.createFromTime(Math.floor(since.getTime() / 1000)) };
  const [agg] = await db.collection('gemini_usage').aggregate([
    { $match: mongoMatch },
    { $group: { _id: null, usd: { $sum: { $ifNull: ['$cost_usd', 0] } }, rows: { $sum: 1 } } },
  ]).toArray();
  const supa = await supabaseScopeSpendReader(ids, since);
  return {
    usd: (agg?.usd || 0) + supa.usd,
    rows: (agg?.rows || 0) + supa.rows,
    meterError: supa.error,
  };
}

/**
 * The scope-aware gate (#4540). Same contract as budgetAllowsDispatch, plus a
 * second lane: when the global dial is closed (or unset), a scope whose
 * envelope has room opens dispatch FOR ITS BOOKS ONLY.
 *
 * Returns { allowed, envelopeIds }:
 *   allowed=true,  envelopeIds=null  → global dial open, dispatch normally
 *   allowed=true,  envelopeIds=Set   → SCOPED dispatch: the caller MUST
 *                                      confine candidates to these book ids.
 *                                      A caller that cannot confine must use
 *                                      budgetAllowsDispatch (boolean) instead.
 *   allowed=false                    → every ceiling is closed
 */
export async function budgetAllowsDispatchScoped(db, label, { bypass = false, control: preloadedControl } = {}) {
  if (bypass) {
    console.log(`  [spend-guard] ${label}: BYPASS (explicit --book operator run)`);
    return { allowed: true, envelopeIds: null };
  }
  const control = preloadedControl
    ?? await db.collection('system_config').findOne({ _id: 'processing_control' });
  const budget = readDailyBudgetUsd(control);

  if (budget !== null) {
    const spend = await getTodaySpendUsd(db);
    if (spend.meterError) {
      // An unreadable meter closes EVERY lane — envelopes read the same stores.
      console.log(`  [spend-guard] ${label}: METER UNREADABLE (${spend.meterError}) — refusing dispatch (all lanes). Partial sum was $${spend.usd.toFixed(2)}.`);
      return { allowed: false, envelopeIds: null };
    }
    if (spend.usd < budget) {
      const blind = spend.costlessRows > 0 ? ` (${spend.costlessRows} rows without cost_usd — spend is undercounted)` : '';
      console.log(`  [spend-guard] ${label}: spend $${spend.usd.toFixed(2)} / $${budget.toFixed(2)} today (UTC, both stores), ${spend.rows} calls${blind} → DISPATCH`);
      return { allowed: true, envelopeIds: null };
    }
  }

  // Global dial closed (spent, or unset = default-closed). Envelope lane.
  const envelopes = readScopeEnvelopes(control);
  if (envelopes.length === 0) {
    console.log(`  [spend-guard] ${label}: ${budget === null ? 'no daily_budget_usd set (default-closed)' : 'daily ceiling reached'} and no scope envelopes — no new dispatch.`);
    return { allowed: false, envelopeIds: null };
  }
  const open = new Set();
  const parts = [];
  for (const env of envelopes) {
    const ids = await resolveEnvelopeIds(db, env);
    if (ids.size === 0) { parts.push(`${env.tag}: empty scope`); continue; }
    const s = await getScopeSpendUsd(db, { ids: [...ids], since: env.created_at });
    if (s.meterError) { parts.push(`${env.tag}: METER UNREADABLE (${s.meterError}) — closed`); continue; } // fail closed per envelope
    if (s.usd < env.budget_usd) {
      for (const id of ids) open.add(id);
      parts.push(`${env.tag}: $${s.usd.toFixed(2)}/$${env.budget_usd.toFixed(2)} OPEN (${ids.size} books)`);
    } else {
      parts.push(`${env.tag}: $${s.usd.toFixed(2)}/$${env.budget_usd.toFixed(2)} ENVELOPE SPENT`);
    }
  }
  const globalNote = budget === null ? 'global dial unset' : 'global daily ceiling reached';
  if (open.size > 0) {
    console.log(`  [spend-guard] ${label}: ${globalNote} → SCOPED DISPATCH, confined to ${open.size} book(s). Envelopes: ${parts.join('; ')}`);
    return { allowed: true, envelopeIds: open };
  }
  console.log(`  [spend-guard] ${label}: ${globalNote}; every envelope closed (${parts.join('; ')}) — no new dispatch.`);
  return { allowed: false, envelopeIds: null };
}
