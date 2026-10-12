/**
 * Pure comparators for the translation-state reconciling audit (#5290, design:
 * .claude/docs/translation-state.md § The audit). The CLI that feeds them is
 * scripts/audit/translation-state-audit.mjs; they live here so the unit test
 * can import them without opening a database.
 *
 * PRIOR ART: scripts/lib/stage-coverage.mjs — `compareCounters()` checks stored
 *   counters against a recount with a tolerance and owns the probe_broken
 *   convention, but it compares page SUMS, not a per-book rung, and has no notion
 *   of direction (a rung that overstates is worse than one that lags).
 *   scripts/lib/page-counts.mjs owns the rule itself (`computeTranslationState`,
 *   `READABLE_IN_ENGLISH_FILTER`); nothing here re-types it.
 */
import { TRANSLATION_RUNGS } from './page-counts.mjs';

/** Sample recount: FAIL above this share of disagreeing books (1%, the issue's bar). */
export const MAX_RUNG_DISAGREEMENT = 0.01;

/**
 * Headline drift a surface may carry while still inside its freshness bound.
 * This is the audit's own instrument tolerance, not a new rung threshold: the
 * view moves by at most ~150 books a day (2026-10-11 → 10-12: 20,220 → 20,189),
 * and the two definitions this audit exists to catch sat 11% and 14% away from
 * the view (homepage rule 16,492 vs 14,852; catalog 17,301 vs 15,131).
 */
export const HEADLINE_TOLERANCE = 0.02;

/** The #5063 shape, carried forward onto the rung (see carryForwardFilter). */
export const CARRY_FORWARD_MIN_PAGES = 30;
export const CARRY_FORWARD_MAX_TRANSLATED_SHARE = 0.5;

const rungIndex = (rung) => TRANSLATION_RUNGS.indexOf(rung);

/**
 * Compare one book's stored `translation_state` with the state recomputed from
 * a recount of its pages. `direction` is the stored rung relative to the
 * recount: `higher` means the book claims more than its pages show — the one
 * direction the design says must never happen.
 */
export function compareRung({ id, stored, recount }) {
  const base = { id, stored_rung: stored?.rung ?? null, recount_rung: recount.rung };
  if (typeof stored?.rung !== 'string' || rungIndex(stored.rung) < 0) {
    return { ...base, agree: false, direction: 'unstamped' };
  }
  const d = rungIndex(stored.rung) - rungIndex(recount.rung);
  if (d !== 0) return { ...base, agree: false, direction: d > 0 ? 'higher' : 'lower' };
  if ((stored.english_original === true) !== (recount.english_original === true)) {
    return { ...base, agree: false, direction: 'english_original' };
  }
  return { ...base, agree: true, direction: 'same' };
}

/** Fold per-book comparisons into the sample verdict. */
export function summarizeRecount(comparisons, { max = MAX_RUNG_DISAGREEMENT } = {}) {
  const disagreements = comparisons.filter(c => !c.agree);
  const higher = disagreements.filter(c => c.direction === 'higher');
  const share = comparisons.length ? disagreements.length / comparisons.length : 0;
  const fails = [];
  if (higher.length) fails.push(`${higher.length} of ${comparisons.length} sampled books store a rung HIGHER than their pages recount to`);
  if (share > max) fails.push(`rung disagreement ${disagreements.length} of ${comparisons.length} books (${(100 * share).toFixed(1)}%) > ${100 * max}%`);
  return { n: comparisons.length, disagree: disagreements.length, share, higher: higher.length, disagreements, fails };
}

/**
 * Positive control. Take one sampled book whose stored rung agrees with its
 * recount, move the stored rung one step in memory, and require the SAME
 * comparator and the SAME verdict function to flag it. `ok: false` means the
 * probe is broken and the run must not report PASS.
 */
export function rungPositiveControl(rows) {
  const row = rows.find(r => compareRung(r).agree);
  if (!row) return { ok: false, reason: 'no agreeing sampled book to perturb' };
  const at = rungIndex(row.stored.rung);
  const up = at < TRANSLATION_RUNGS.length - 1;
  const to = TRANSLATION_RUNGS[up ? at + 1 : at - 1];
  const perturbed = { ...row, stored: { ...row.stored, rung: to } };
  const cmp = compareRung(perturbed);
  const verdict = summarizeRecount([cmp]);
  const want = up ? 'higher' : 'lower';
  const ok = cmp.agree === false && cmp.direction === want && verdict.fails.length > 0;
  return { ok, book: row.id, from: row.stored.rung, to, expected: want, got: cmp.direction };
}

/**
 * One headline against a fresh count of its named view.
 *   stale       — the surface's own timestamp is older than its freshness bound
 *   drift       — inside the bound (or undated) but further from the view than HEADLINE_TOLERANCE
 *   unreadable  — the read path returned no number; never a pass
 * `maxAgeMs`/`at` are omitted for a surface with no timestamp of its own (a rendered page).
 */
export function checkHeadline({ surface, view, value, expected, at = null, maxAgeMs = null, now = Date.now(), tolerance = HEADLINE_TOLERANCE, slack = 0 }) {
  const row = { surface, view, value: value ?? null, expected, at: at ? new Date(at).toISOString() : null };
  if (typeof value !== 'number' || !Number.isFinite(value)) return { ...row, status: 'unreadable' };
  const diff = value - expected;
  const allowed = Math.max(slack, Math.ceil(tolerance * expected));
  const out = { ...row, diff, allowed };
  if (maxAgeMs != null) {
    const age = at ? now - new Date(at).getTime() : NaN;
    if (!Number.isFinite(age)) return { ...out, status: 'unreadable', detail: 'no timestamp' };
    out.age_h = +(age / 3_600_000).toFixed(1);
    out.max_age_h = +(maxAgeMs / 3_600_000).toFixed(1);
    if (age > maxAgeMs) return { ...out, status: 'stale' };
  }
  return { ...out, status: Math.abs(diff) > allowed ? 'drift' : 'ok' };
}

/** The headline comparator's own control: a stale stamp and a drifted value must both be flagged. */
export function headlinePositiveControl(expected, now = Date.now()) {
  const day = 86_400_000;
  const drift = checkHeadline({ surface: 'control', view: 'control', value: Math.ceil(expected * (1 + HEADLINE_TOLERANCE)) + 2, expected, now });
  const stale = checkHeadline({ surface: 'control', view: 'control', value: expected, expected, at: now - 3 * day, maxAgeMs: day, now });
  const fresh = checkHeadline({ surface: 'control', view: 'control', value: expected, expected, at: now, maxAgeMs: day, now });
  return { ok: drift.status === 'drift' && stale.status === 'stale' && fresh.status === 'ok', drift: drift.status, stale: stale.status, fresh: fresh.status };
}

/**
 * Every "N readable in English" figure in a rendered page's HTML. The number
 * and its label sit in neighbouring elements (`20,189</div><div …>books readable
 * in English`), so the pattern steps over tags and React comment markers between
 * them rather than stripping the page first. A page whose copy no longer carries
 * the phrase returns [] — the caller reports it unreadable rather than passing it.
 */
export function parseReadableFigures(html) {
  const out = [];
  for (const m of String(html ?? '').matchAll(/(\d[\d,]*)(?:\s|<[^>]*>)*(?:books\s+|of them\s+)?readable in English/gi)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * #5063 carried forward onto the rung: a book on `readable` or `complete` with
 * more than 30 pages and under half of them translated is the preview-stub
 * shape, whatever its counters say.
 *
 * The denominator is `pages_count − pages_blank` ("whole"), not `pages_count`
 * as #5063 wrote it for `is_fully_translated`. Measured 2026-10-12: on bare
 * `pages_count` the rule flags 46 live books, every one of them a facsimile
 * whose other half is blank versos (Papyrus of Ani: 168 leaves, 86 blank, 82
 * of 82 translatable pages translated) — correct rungs. On `whole` it flags 0.
 * translation-state.md § Do not: "Do not divide by `pages_count`".
 */
export function carryForwardFilter() {
  return {
    'translation_state.rung': { $in: ['readable', 'complete'] },
    pages_count: { $gt: CARRY_FORWARD_MIN_PAGES },
    $expr: {
      $lt: [
        { $ifNull: ['$pages_translated', 0] },
        { $multiply: [CARRY_FORWARD_MAX_TRANSLATED_SHARE, { $subtract: ['$pages_count', { $ifNull: ['$pages_blank', 0] }] }] },
      ],
    },
  };
}

/** JS form of carryForwardFilter(), for the control that proves the query can match. */
export function isCarryForwardShape(book) {
  const rung = book?.translation_state?.rung;
  if (rung !== 'readable' && rung !== 'complete') return false;
  if (!((book.pages_count ?? 0) > CARRY_FORWARD_MIN_PAGES)) return false;
  return (book.pages_translated ?? 0) < CARRY_FORWARD_MAX_TRANSLATED_SHARE * ((book.pages_count ?? 0) - (book.pages_blank ?? 0));
}

/**
 * Overall verdict. A broken control or an unreadable surface is never PASS:
 * FAIL when something was measured wrong, `probe_broken` when the audit could
 * not vouch for its own reading.
 */
export function auditVerdict({ fails, controlsOk, unreadable }) {
  if (fails.length) return { verdict: 'FAIL', exit: 1 };
  if (!controlsOk || unreadable.length) return { verdict: 'probe_broken', exit: 2 };
  return { verdict: 'PASS', exit: 0 };
}
