/**
 * Pure comparators for the page-count audit (#5331, design: .claude/docs/page-counts.md
 * § The audit). The CLI that feeds them is scripts/audit/page-count-audit.mjs; they
 * live here so the unit test can import them without opening a database.
 *
 * PRIOR ART: scripts/lib/stage-coverage.mjs — `compareCounters()` recounts 100 random
 *   books as a guard on the coverage sums, but at 5% tolerance, over five counters
 *   (no `pages_translatable`), reading a missing counter as 0 and with no direction,
 *   so it cannot see a stored-HIGH counter or the missing-field failure.
 *   scripts/lib/translation-state-audit.mjs — the sibling audit (#5290); its verdict
 *   function (FAIL > probe_broken > PASS) is reused here, not re-typed.
 *   scripts/lib/page-counts.mjs owns the counting rule (`diffPageCounters`,
 *   `PAGE_COUNTERS`); nothing here re-types it.
 */
import { PAGE_COUNTERS, diffPageCounters } from './page-counts.mjs';

export { auditVerdict } from './translation-state-audit.mjs';

/** Sample recount: FAIL when more than this share of books disagree on any ONE counter. */
export const MAX_COUNTER_DISAGREEMENT = 0.01;

/** Missing `pages_translatable` on live books: FAIL above this (and on week-over-week growth). */
export const MAX_MISSING_TRANSLATABLE = 100;

/** A book recounted, or with a page written, inside this window is in flight. */
export const IN_FLIGHT_MS = 2 * 3_600_000;

/**
 * One book: stored counters against a recount of its visible pages.
 *
 * `stats` is the buildVisiblePageCountPipeline() row (null for no visible pages).
 * `recentPages` is the number of the book's pages written in the last IN_FLIGHT_MS:
 * a counter may sit HIGH by up to that many while the reconciler has not had its
 * turn (a page hidden or its OCR cleared a minute ago), and no more.
 *
 * Per counter, `direction` is the stored value relative to the recount:
 *   higher  — overclaims (the direction the design says must never persist)
 *   lower   — lags
 *   missing — no numeric stored value; a mismatch, not a zero (diffPageCounters)
 */
export function compareBookCounters({ id, book, stats, recentPages = 0 }) {
  const { before, after } = diffPageCounters(book, stats);
  const counters = {};
  for (const c of PAGE_COUNTERS) {
    const stored = before[c];
    const recount = after[c];
    if (typeof stored !== 'number' || !Number.isFinite(stored)) {
      counters[c] = { stored, recount, agree: false, direction: 'missing' };
    } else if (stored === recount) {
      counters[c] = { stored, recount, agree: true, direction: 'same' };
    } else {
      const over = stored - recount;
      counters[c] = {
        stored, recount, agree: false,
        direction: over > 0 ? 'higher' : 'lower',
        // HIGH beyond what the last 2 h of page writes can explain.
        ...(over > 0 ? { excess: over, unexplained: over > recentPages } : {}),
      };
    }
  }
  return { id, recent_pages: recentPages, counters, agree: Object.values(counters).every(c => c.agree) };
}

/**
 * Fold per-book comparisons into the sample verdict.
 *   - per counter, FAIL when more than `max` of the books disagree;
 *   - FAIL on ANY counter stored HIGHER than its recount by more than the book's
 *     recent page writes (`unexplained`).
 * Books with page writes in the window are judged by the HIGH rule only (with
 * their slack); the share is taken over the settled books.
 */
export function summarizeCounters(comparisons, { max = MAX_COUNTER_DISAGREEMENT } = {}) {
  const settled = comparisons.filter(c => !c.recent_pages);
  const byCounter = {};
  for (const c of PAGE_COUNTERS) {
    const off = settled.filter(b => !b.counters[c].agree);
    const dir = (d) => off.filter(b => b.counters[c].direction === d).length;
    const highUnexplained = comparisons.filter(b => b.counters[c].unexplained);
    byCounter[c] = {
      off: off.length,
      share: settled.length ? off.length / settled.length : 0,
      higher: dir('higher'), lower: dir('lower'), missing: dir('missing'),
      higher_unexplained: highUnexplained.length,
      pages_high: highUnexplained.reduce((s, b) => s + b.counters[c].excess, 0),
    };
  }
  const fails = [];
  for (const c of PAGE_COUNTERS) {
    const s = byCounter[c];
    if (s.higher_unexplained) fails.push(`${c}: ${s.higher_unexplained} of ${comparisons.length} sampled books store it HIGHER than their pages recount to (${s.pages_high} pages)`);
    if (s.share > max) fails.push(`${c}: ${s.off} of ${settled.length} settled books disagree (${(100 * s.share).toFixed(1)}%) > ${100 * max}% (${s.higher} high, ${s.lower} low, ${s.missing} missing)`);
  }
  return {
    n: comparisons.length,
    settled: settled.length,
    in_flight: comparisons.length - settled.length,
    disagree: comparisons.filter(c => !c.agree).length,
    by_counter: byCounter,
    disagreements: comparisons.filter(c => !c.agree),
    fails,
  };
}

/**
 * Positive control. Take one settled sampled book whose six counters all agree,
 * raise each stored counter by one in memory in turn, and require the SAME
 * comparator and the SAME summary to flag it HIGH and fail. `ok: false` means the
 * probe is broken and the run must not report PASS.
 */
export function counterPositiveControl(rows) {
  const row = rows.find(r => !r.recentPages && compareBookCounters(r).agree);
  if (!row) return { ok: false, reason: 'no settled, agreeing sampled book to perturb' };
  const fired = [];
  const missed = [];
  for (const c of PAGE_COUNTERS) {
    const perturbed = { ...row, book: { ...row.book, [c]: row.book[c] + 1 } };
    const cmp = compareBookCounters(perturbed);
    const verdict = summarizeCounters([cmp]);
    const ok = cmp.counters[c].direction === 'higher' && cmp.counters[c].unexplained === true && verdict.fails.some(f => f.startsWith(`${c}:`));
    (ok ? fired : missed).push(c);
  }
  return { ok: missed.length === 0, book: row.id, fired, missed };
}

/**
 * Missing `pages_translatable` on live books: FAIL above MAX_MISSING_TRANSLATABLE,
 * and on any growth over the reading from about a week ago. `history` is the
 * audit's own log of earlier readings ({ at, missing }); with none older than six
 * days the growth rule is reported as `no baseline`, not passed silently.
 */
export function checkMissingTranslatable(missing, history = [], now = Date.now()) {
  const fails = [];
  if (missing > MAX_MISSING_TRANSLATABLE) fails.push(`${missing} live books have no numeric pages_translatable (> ${MAX_MISSING_TRANSLATABLE})`);
  const weekAgo = [...history]
    .filter(h => typeof h?.missing === 'number' && now - new Date(h.at).getTime() >= 6 * 86_400_000)
    .sort((a, b) => new Date(b.at) - new Date(a.at))[0] ?? null;
  if (weekAgo && missing > weekAgo.missing) fails.push(`live books without pages_translatable grew ${weekAgo.missing} → ${missing} since ${String(weekAgo.at).slice(0, 10)}`);
  return { missing, max: MAX_MISSING_TRANSLATABLE, week_ago: weekAgo, growth: weekAgo ? missing - weekAgo.missing : null, fails };
}
