// Routing-decision rules for an engine-vs-engine OCR eval: label precision, a catastrophic-count
// comparison with and without a margin, the by-eye adjudication tally, and the invention veto.
// Pure functions over counts and per-page flags; no I/O, no model call.
//
// PRIOR ART: scripts/eval/benchmark-cost-lane.mjs — the house non-inferiority rule (median CER Δ ≤
// margin, CI-upper ≤ max, catastrophic ≤ ref + 1), but inline in a script, on reference CER, so it
// cannot score a run that has no reference. scripts/eval/hidden-flash-5795/score.mjs — the rule
// this generalises ("catastrophic flash ≤ lite", label ≥ 90 %, wins > losses, no invented page),
// hard-coded to two arm names and with no margin: it flipped on one page in 30 (#5828).
// lib/agreement-stats.mjs (wilson, bootstrapItems) and lib/paired-stats.mjs (makeRng,
// binomTwoSided) are reused here, not re-implemented.

import { wilson, bootstrapItems } from './agreement-stats.mjs';
import { makeRng, binomTwoSided } from './paired-stats.mjs';

const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const EPS = 1e-9;

/** Wilson 95 % interval for k of n, rounded to 3 places; null when n is 0. */
export function wilson95(k, n) {
  if (!n) return null;
  const [lo, hi] = wilson(k, n);
  return [r3(lo), r3(hi)];
}

/**
 * Label precision: is the catalogue label right on enough of the pages that carry text?
 * `use: 'point'` reads the share (the #5795 rule); `use: 'wilson_lower'` reads the lower bound.
 */
export function labelPrecision({ yes, n }, { min = 0.9, use = 'point' } = {}) {
  if (!n) return { pass: null, yes, n, share: null, wilson95: null, min, use };
  const ci = wilson95(yes, n);
  const value = use === 'wilson_lower' ? ci[0] : yes / n;
  return { pass: value >= min - EPS, yes, n, share: r3(yes / n), wilson95: ci, min, use };
}

/**
 * The count rule without a margin: candidate failures ≤ baseline failures + slack.
 * slack 0 is #5795's (b); slack 1 is the catastrophic clause of the cost-lane rule.
 */
export function countNoWorse({ candidate, baseline }, { slack = 0 } = {}) {
  return { pass: candidate <= baseline + slack, candidate, baseline, slack };
}

/**
 * Non-inferiority on a failure RATE, paired by page. `pairs` is one row per page:
 * { candidate: boolean, baseline: boolean } (true = the engine failed the page).
 *
 * pass ⇔ candidate count ≤ baseline count + slack
 *        ∧ upper 95 % bound of (candidate rate − baseline rate) ≤ margin.
 * The interval is a seeded percentile bootstrap over pages (bootstrapItems), so the pairing is
 * kept. Reported beside it: each arm's Wilson interval, the discordant pages, and the exact sign
 * test on them. `min_margin_to_pass` is the upper bound itself: the rule passes for any margin at
 * or above it, which is the number to read when the margin is being argued about.
 */
export function rateNonInferior(pairs, { margin = 0.1, slack = 1, seed = 5828, iters = 4000 } = {}) {
  const n = pairs.length;
  if (!n) return { pass: null, n: 0, margin, slack };
  const kc = pairs.filter((p) => p.candidate).length, kb = pairs.filter((p) => p.baseline).length;
  const d = pairs.map((p) => (p.candidate ? 1 : 0) - (p.baseline ? 1 : 0));
  const worse = d.filter((x) => x > 0).length, better = d.filter((x) => x < 0).length;
  const diff = (kc - kb) / n;
  const ci = worse + better === 0 ? [0, 0] : bootstrapItems(d, (s) => s.reduce((a, x) => a + x, 0) / s.length, makeRng(seed), iters);
  const upper = ci[1];
  return {
    pass: kc <= kb + slack && upper <= margin + EPS,
    n, candidate: kc, baseline: kb, slack, margin,
    candidate_wilson95: wilson95(kc, n), baseline_wilson95: wilson95(kb, n),
    rate_diff: r3(diff), rate_diff_ci95: [r3(ci[0]), r3(upper)],
    discordant: { candidate_only: worse, baseline_only: better, p_sign: worse + better ? r3(binomTwoSided(worse, worse + better)) : null },
    min_margin_to_pass: kc <= kb + slack ? r3(Math.max(0, upper)) : null,
  };
}

/**
 * By-eye adjudication: does the candidate win more pages than it loses?
 * `mode: 'majority'` is wins > losses (a tie fails: the rule says "more than").
 * `mode: 'wilson_lower'` asks the Wilson lower bound of wins / (wins + losses) to exceed `min`.
 */
export function adjudicationWins({ wins, losses }, { mode = 'majority', min = 0.5 } = {}) {
  const untied = wins + losses;
  const ci = wilson95(wins, untied);
  const pass = mode === 'wilson_lower' ? (untied ? ci[0] > min : false) : wins > losses;
  return { pass, wins, losses, untied, win_share_wilson95: ci, p_sign: untied ? r3(binomTwoSided(wins, untied)) : null, mode };
}

/** The invention veto: a candidate that wrote text which is not on the leaf does not pass. */
export function inventionVeto({ candidateInvented = [], baselineInvented = [] }, { max = 0 } = {}) {
  return { pass: candidateInvented.length <= max, candidate_invented: candidateInvented, baseline_invented: baselineInvented, max };
}

/**
 * One group's rule inputs, read from a routing-eval results file ({ families, pages }).
 * The same shape scripts/eval/hidden-flash-5795/score.mjs wrote, so stored runs replay.
 */
export function groupInputs(results, group, { candidate, baseline }) {
  const P = results.pages.filter((p) => p.family === group);
  const T = P.filter((p) => p.page_class === 'text');
  const adj = results.families?.[group]?.adjudication ?? null;
  return {
    group, n_pages: P.length, n_text: T.length,
    label: { yes: T.filter((p) => p.label_ok === 'yes').length, n: T.length },
    pairs: P.map((p) => ({ slug: p.slug, candidate: !!p.arms[candidate]?.catastrophic, baseline: !!p.arms[baseline]?.catastrophic })),
    adjudication: adj && adj.judged === adj.pages ? {
      pages: adj.pages, wins: adj[candidate] ?? 0, losses: adj[baseline] ?? 0, both: adj.both ?? 0, neither: adj.neither ?? 0, cannot_tell: adj.cannot_tell ?? 0,
      candidateInvented: adj[`${candidate}_invented`] ?? [], baselineInvented: adj[`${baseline}_invented`] ?? [],
    } : null,
  };
}

/**
 * Negative control: a candidate that is inferior BY CONSTRUCTION. It fails every page the baseline
 * fails, every page it failed itself, and `share` more of the pages (at least 2, seeded choice
 * among pages both engines passed). A rule that passes this arm has no power at this n, and its
 * verdict on the real arm says nothing.
 */
export function plantInferior(inputs, { share = 0.2, seed = 5828 } = {}) {
  const rng = makeRng(seed);
  const base = inputs.pairs.map((p) => ({ ...p, candidate: p.candidate || p.baseline }));
  const ok = base.map((p, i) => (p.candidate ? -1 : i)).filter((i) => i >= 0);
  for (let i = ok.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ok[i], ok[j]] = [ok[j], ok[i]]; }
  const k = Math.min(ok.length, Math.max(2, Math.ceil(base.length * share)));
  const hit = new Set(ok.slice(0, k));
  return { ...inputs, planted: k, pairs: base.map((p, i) => (hit.has(i) ? { ...p, candidate: true } : p)) };
}

const CHECKS = {
  labelPrecision: (c, x) => labelPrecision(x.label, c),
  countNoWorse: (c, x) => countNoWorse({ candidate: x.pairs.filter((p) => p.candidate).length, baseline: x.pairs.filter((p) => p.baseline).length }, c),
  rateNonInferior: (c, x) => rateNonInferior(x.pairs, c),
  adjudication: (c, x) => {
    if (!x.adjudication) return { pass: null, pending: 'adjudication not complete' };
    const w = adjudicationWins(x.adjudication, c), v = inventionVeto(x.adjudication, { max: c.invention_max ?? 0 });
    return { pass: w.pass && v.pass, wins: w, invention: v, both: x.adjudication.both, neither: x.adjudication.neither, cannot_tell: x.adjudication.cannot_tell };
  },
};

/**
 * Apply a preregistered rule file to one group, mechanically.
 *
 * rule = { id, candidate, baseline, min_text_pages, checks: [{ id, rule, ...params, on_fail? }], verdicts: { pass, fail, small_n, pending } }
 * Order of reading, as #5795 fixed it: too few pages with text → `small_n`, the rule is not
 * applied; a failed check that names its own `on_fail` (the label check → relabelling) wins;
 * an unanswered check → `pending`; every check passes → `pass`; otherwise `fail`.
 */
export function applyRule(rule, inputs) {
  const checks = {};
  for (const c of rule.checks) {
    const fn = CHECKS[c.rule];
    if (!fn) throw new Error(`rule ${rule.id}: unknown check "${c.rule}" (known: ${Object.keys(CHECKS).join(', ')})`);
    checks[c.id] = { rule: c.rule, ...fn(c, inputs) };
  }
  const V = rule.verdicts;
  let verdict;
  const own = rule.checks.find((c) => c.on_fail && checks[c.id].pass === false);
  if (inputs.n_text < (rule.min_text_pages ?? 10)) verdict = V.small_n;
  else if (own) verdict = own.on_fail;
  else if (Object.values(checks).some((c) => c.pass == null)) verdict = V.pending;
  else verdict = Object.values(checks).every((c) => c.pass) ? V.pass : V.fail;
  return { rule: rule.id, group: inputs.group, n_pages: inputs.n_pages, n_text: inputs.n_text, checks, passed: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v.pass])), verdict };
}

/**
 * The negative control for one rule on one group: plant an inferior candidate and apply only the
 * rule's failure-count checks. `held: true` means the planted arm was refused, as it must be.
 */
export function negativeControl(rule, inputs, opts) {
  const countChecks = rule.checks.filter((c) => c.rule === 'countNoWorse' || c.rule === 'rateNonInferior');
  if (!countChecks.length || inputs.n_text < (rule.min_text_pages ?? 10)) return null;
  const planted = plantInferior(inputs, opts);
  const out = Object.fromEntries(countChecks.map((c) => [c.id, CHECKS[c.rule](c, planted)]));
  return { planted_pages: planted.planted, baseline_failures: planted.pairs.filter((p) => p.baseline).length, candidate_failures: planted.pairs.filter((p) => p.candidate).length, held: Object.values(out).some((c) => c.pass === false), checks: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.pass])) };
}
