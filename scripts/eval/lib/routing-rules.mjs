// Routing-decision rules for an engine-vs-engine OCR eval: label precision, a catastrophic-count
// comparison with and without a margin, the by-eye adjudication tally, the invention veto, and
// (#5870) non-inferiority of the ENGLISH made from each engine's read, judged against a human reference.
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

/**
 * Non-inferiority on TRANSLATION FIDELITY against a human reference (#5870), paired by page.
 * `pairs` is one row per page: { candidate: number, baseline: number }, each the mean of the blind
 * judges' 1–5 fidelity for the English made from that engine's read (translation-vs-reference/).
 *
 * pass ⇔ n ≥ min_pairs ∧ lower 95 % bound of mean(candidate − baseline) ≥ −margin.
 * The interval is a seeded percentile bootstrap over pages (bootstrapItems), so the pairing is kept.
 * A failed check whose point estimate is still within the margin is `inconclusive`: the interval is
 * wider than the margin at this n, which is not the same as the candidate being worse.
 * `max_margin_passed` is −(lower bound): the rule passes for any margin at or above it.
 */
export function translationLift(pairs, { margin = 0.25, min_pairs = 6, seed = 5870, iters = 4000, tie = 0.25 } = {}) {
  const P = pairs.filter((p) => Number.isFinite(p.candidate) && Number.isFinite(p.baseline));
  const n = P.length;
  if (n < min_pairs) return { pass: null, n, margin, min_pairs };
  const d = P.map((p) => p.candidate - p.baseline);
  const mean = d.reduce((a, x) => a + x, 0) / n;
  const ci = d.every((x) => x === d[0]) ? [d[0], d[0]] : bootstrapItems(d, (s) => s.reduce((a, x) => a + x, 0) / s.length, makeRng(seed), iters);
  const better = d.filter((x) => x > tie).length, worse = d.filter((x) => x < -tie).length;
  const pass = ci[0] >= -margin - EPS;
  return {
    pass, inconclusive: !pass && mean >= -margin - EPS,
    n, margin, mean_candidate: r3(P.reduce((a, p) => a + p.candidate, 0) / n), mean_baseline: r3(P.reduce((a, p) => a + p.baseline, 0) / n),
    mean_diff: r3(mean), mean_diff_ci95: [r3(ci[0]), r3(ci[1])], better, same: n - better - worse, worse,
    p_sign: better + worse ? r3(binomTwoSided(better, better + worse)) : null, max_margin_passed: r3(Math.max(0, -ci[0])),
  };
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
    // Present only on runs judged against a human reference (#5870): page.fidelity = { <arm>: mean judge fidelity }.
    fidelity: T.some((p) => p.fidelity) ? T.map((p) => ({ slug: p.slug, candidate: p.fidelity?.[candidate] ?? null, baseline: p.fidelity?.[baseline] ?? null })) : null,
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

/**
 * The same control on fidelity: the planted candidate is never better than the baseline on any page
 * (min of the two), and on `share` of the pages (at least 2, seeded) its English scores 1, the floor
 * a failed read produces. A translation rule that passes it has no power at this n.
 */
export function plantInferiorFidelity(inputs, { share = 0.2, seed = 5828 } = {}) {
  const rng = makeRng(seed);
  const base = inputs.fidelity.map((p) => ({ ...p, candidate: Math.min(p.candidate ?? 1, p.baseline ?? 1) }));
  const ok = base.map((p, i) => (p.candidate > 1 ? i : -1)).filter((i) => i >= 0);
  for (let i = ok.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ok[i], ok[j]] = [ok[j], ok[i]]; }
  const k = Math.min(ok.length, Math.max(2, Math.ceil(base.length * share)));
  const hit = new Set(ok.slice(0, k));
  return { ...inputs, planted: k, fidelity: base.map((p, i) => (hit.has(i) ? { ...p, candidate: 1 } : p)) };
}

const CHECKS = {
  labelPrecision: (c, x) => labelPrecision(x.label, c),
  countNoWorse: (c, x) => countNoWorse({ candidate: x.pairs.filter((p) => p.candidate).length, baseline: x.pairs.filter((p) => p.baseline).length }, c),
  rateNonInferior: (c, x) => rateNonInferior(x.pairs, c),
  translationLift: (c, x) => (x.fidelity ? translationLift(x.fidelity, c) : { pass: null, pending: 'no fidelity scores (judge against a reference first)' }),
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
  else if (Object.values(checks).every((c) => c.pass)) verdict = V.pass;
  // Every failed check only failed for want of n (translationLift): the rule's own `inconclusive`, if it names one.
  else verdict = V.inconclusive && Object.values(checks).filter((c) => !c.pass).every((c) => c.inconclusive) ? V.inconclusive : V.fail;
  return { rule: rule.id, group: inputs.group, n_pages: inputs.n_pages, n_text: inputs.n_text, checks, passed: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v.pass])), verdict };
}

/**
 * The negative control for one rule on one group: plant an inferior candidate and apply only the
 * rule's failure-count checks. `held: true` means the planted arm was refused, as it must be.
 */
export function negativeControl(rule, inputs, opts) {
  const countChecks = rule.checks.filter((c) => c.rule === 'countNoWorse' || c.rule === 'rateNonInferior');
  const liftChecks = inputs.fidelity ? rule.checks.filter((c) => c.rule === 'translationLift') : [];
  if ((!countChecks.length && !liftChecks.length) || inputs.n_text < (rule.min_text_pages ?? 10)) return null;
  const out = {}; const res = {};
  if (countChecks.length) {
    const planted = plantInferior(inputs, opts);
    for (const c of countChecks) out[c.id] = CHECKS[c.rule](c, planted);
    Object.assign(res, { planted_pages: planted.planted, baseline_failures: planted.pairs.filter((p) => p.baseline).length, candidate_failures: planted.pairs.filter((p) => p.candidate).length });
  }
  if (liftChecks.length) {
    const planted = plantInferiorFidelity(inputs, opts);
    for (const c of liftChecks) out[c.id] = CHECKS[c.rule](c, planted);
    const lift = out[liftChecks[0].id];
    res.fidelity = { planted_pages: planted.planted, mean_diff: lift.mean_diff, mean_diff_ci95: lift.mean_diff_ci95, held: liftChecks.some((c) => out[c.id].pass === false) };
  }
  // Each planted arm (count, fidelity) must be refused by at least one of its own checks.
  const held = (!countChecks.length || countChecks.some((c) => out[c.id].pass === false)) && (!liftChecks.length || res.fidelity.held);
  return { ...res, held, checks: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.pass])) };
}

// ───────────────────────────── Decision cards (#5873) ─────────────────────────────
// eval-design §10.2 as data: what evidence is ENOUGH for each kind of quality decision, fixed
// before a test. `cardVerdict` answers "do we have enough?" from a description of the evidence;
// it never reads a result file itself and never decides the change (§10: a person signs).
//
// PRIOR ART for this block: scripts/eval/routing-eval/rules/margin-v1.json — a rule for ONE run's
// pages (is flash no worse than lite here?); it does not ask whether the run was big enough for
// the money at stake, whether languages may be pooled, or whether a replication is owed.
// benchmark-dashboard-data.mjs `thresholds` — the 30 / 50 book grades, reused below, with no tier,
// pooling or effect rule. Nothing encoded those before this block.

/** Referenced BOOKS per language (eval-design §3.1; one page per book). */
export const GRADES = { directional: 30, decision: 50 };

/** Measures that may DECIDE (eval-design §2). Everything else screens or supports. */
const DECIDING = ['accuracy', 'judged_vs_reference'];

const TIER_NEEDS = {
  // tier: the grade every cleared language needs, and whether a pool or a replication is owed
  small: { grade: 'directional', pool_or_replication: false, replication: false },
  medium: { grade: 'directional', pool_or_replication: true, replication: false },
  large: { grade: 'decision', pool_or_replication: false, replication: true },
};

/**
 * The four cards. Every number is cited in eval-design §10.2; the ones marked there as a
 * judgement call are `min_effect.fidelity`, `usd_per_page_point_max`, `precision_wilson_lower`
 * and the tier bounds.
 */
export const DECISION_CARDS = {
  routing: {
    id: 'routing', title: 'Route an engine or model for a script or stratum',
    measures: { small: [...DECIDING, 'routing_eval'], medium: [...DECIDING, 'routing_eval'], large: DECIDING },
    min_effect: { fidelity: 0.25, cer_pp: 1, rate_per_100: 8 }, failure_margin: 0.1,
    needs_floor: true, needs_random_sample: false, needs_guards: false,
  },
  backfill: {
    id: 'backfill', title: 'Paid re-OCR or retranslation of served pages',
    measures: { small: DECIDING, medium: DECIDING, large: DECIDING },
    min_effect: { fidelity: 0.25, cer_pp: 1, rate_per_100: 8 }, usd_per_page_point_max: 0.01,
    needs_floor: true, needs_random_sample: true, needs_undo: true, needs_guards: false,
  },
  prompt: {
    id: 'prompt', title: 'Change an OCR or translation prompt, or the request shape',
    measures: { small: [...DECIDING, 'judged'], medium: [...DECIDING, 'judged'], large: DECIDING },
    min_effect: { fidelity: 0.25, cer_pp: 1, rate_per_100: 8 },
    needs_floor: true, needs_random_sample: false, needs_guards: true, min_tier: 'medium',
  },
  gate: {
    id: 'gate', title: 'A gate or withholding rule',
    measures: { small: [...DECIDING, 'by_eye_human'], medium: [...DECIDING, 'by_eye_human'], large: [...DECIDING, 'by_eye_human'] },
    hold: { min_books: 10, sound_line: 4, standing_books: GRADES.directional },
    flag: { precision: 0.8, precision_wilson_lower: 0.65 },
  },
};

/**
 * Tier by dollars and reversibility. `usd` is the incremental spend over the affected backlog
 * (one year for a standing lane) INCLUDING the downstream work the change queues inside its
 * envelope. small: ≤ $10, reversible, nothing served changes. large: > $500, or it queues paid
 * work outside its envelope, or it cannot be undone. medium: the rest.
 */
export function stakeTier({ usd = 0, reversible = true, queues_downstream = false, changes_served_text = false, undo_proven = false } = {}) {
  const undoable = reversible && (!changes_served_text || undo_proven);
  if (usd > 500 || queues_downstream || !undoable) return 'large';
  if (usd <= 10 && !changes_served_text) return 'small';
  return 'medium';
}

/** exploratory < 30 ≤ directional < 50 ≤ decision, in referenced books. */
export function gradeOf(n) {
  return n >= GRADES.decision ? 'decision' : n >= GRADES.directional ? 'directional' : 'exploratory';
}

/**
 * May these languages be pooled? Only languages with ≥ `min_n` books vote (a 5-book cell cannot
 * veto). Pass ⇔ every voting language's effect has the pool's sign AND the pooled effect lies
 * inside every voting language's 95 % interval. The pool must have been named before the run.
 */
export function heterogeneity(languages, pool, { min_n = 10 } = {}) {
  if (!pool || pool.delta == null) return { pass: null, offenders: [], voters: 0 };
  const voters = languages.filter((l) => l.n >= min_n && l.delta != null && l.ci);
  const offenders = voters.filter((l) => Math.sign(l.delta) !== Math.sign(pool.delta) || pool.delta < l.ci[0] - EPS || pool.delta > l.ci[1] + EPS).map((l) => l.lang);
  return { pass: offenders.length === 0, offenders, voters: voters.length };
}

/**
 * Is an effect worth acting on? All of: its 95 % interval excludes 0; the point estimate lies
 * outside the A-vs-A interval measured in the same run; it reaches the minimum effect fixed
 * before the run. `higher_is_better: false` for error rates (the effect is then a fall).
 */
export function effectBeyondFloor(effect, floor, { min_effect, higher_is_better = true } = {}) {
  if (!effect || effect.delta == null || !effect.ci) return { pass: null, why: 'no effect with an interval' };
  const s = higher_is_better ? 1 : -1;
  const d = s * effect.delta, lo = s * (higher_is_better ? effect.ci[0] : effect.ci[1]);
  const floorEdge = floor?.ci ? Math.max(Math.abs(floor.ci[0]), Math.abs(floor.ci[1])) : null;
  const checks = { excludes_zero: lo > EPS, outside_floor: floorEdge == null ? null : d > floorEdge + EPS, reaches_min_effect: d >= min_effect - EPS };
  return { pass: Object.values(checks).some((c) => c == null) ? null : Object.values(checks).every(Boolean), ...checks, min_effect, floor_edge: floorEdge };
}

const TIER_ORDER = ['small', 'medium', 'large'];

/**
 * Apply a card to a description of the evidence. Returns what is sufficient and what is missing.
 *
 * evidence = {
 *   proposes_change: boolean,          // false = "keep what we have": stands at any grade
 *   measure, metric: 'fidelity' | 'cer_pp' | 'rate_per_100', higher_is_better,
 *   stake: { usd, reversible, queues_downstream, changes_served_text, undo_proven },
 *   preregistered: boolean,            // margin and minimum effect committed before the arms ran
 *   floor: { delta, ci } | null,       // the A-vs-A arm of the same run
 *   languages: [{ lang, n, delta, ci, rule_pass? }], negative_control_held?,   // rule_pass: routing_eval runs
 *   pool: { name, n, delta, ci, registered } | null,
 *   judge: { controls_pass, ties_allowed, blind_judges, human_calibrated, absolute_threshold, same_family_as_candidate },
 *   replication: { fresh_books, passed_alone, pooled_registered } | null,
 *   sample: 'random' | 'selected', guards_hold: boolean | null, usd_per_page_point: number | null,
 * }
 */
export function cardVerdict(cardId, evidence) {
  const card = DECISION_CARDS[cardId];
  if (!card) throw new Error(`unknown decision card "${cardId}" (known: ${Object.keys(DECISION_CARDS).join(', ')})`);
  if (cardId === 'gate') return gateVerdict(card, evidence);
  if (evidence.proposes_change === false) return { card: cardId, tier: null, sufficient: true, stands_as: 'no change', missing: [], languages: {} };

  let tier = stakeTier(evidence.stake);
  if (card.min_tier && TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(card.min_tier)) tier = card.min_tier;
  const needs = TIER_NEEDS[tier], missing = [];
  const metric = evidence.metric ?? 'fidelity', minEffect = card.min_effect[metric];
  const opts = { min_effect: minEffect, higher_is_better: evidence.higher_is_better ?? metric === 'fidelity' };

  if (!card.measures[tier].includes(evidence.measure)) missing.push(`measure: "${evidence.measure}" cannot decide a ${tier}-tier ${cardId} decision (allowed: ${card.measures[tier].join(', ')})`);
  if (!evidence.preregistered) missing.push('preregistration: margin and minimum effect were not fixed before the run');
  // A routing-eval run (by eye + failure counts, no reference) has no fidelity effect: its rule
  // file's verdict stands in for the effect, and its planted-inferior control for the A-vs-A arm.
  const byRule = evidence.measure === 'routing_eval';
  if (byRule && evidence.negative_control_held !== true) missing.push('negative control: the rule did not refuse a planted inferior arm');
  if (card.needs_floor && !byRule && !evidence.floor?.ci) missing.push('A-vs-A arm: no noise floor from the same run');
  if (card.needs_random_sample && evidence.sample !== 'random') missing.push('sample: pages were selected (low scorers); a backfill is sized on a random page of the stratum');
  if (card.needs_undo && !evidence.stake?.undo_proven) missing.push('undo: no revision row per page with a restore proven on one page');
  if (card.needs_guards && evidence.guards_hold !== true) missing.push(evidence.guards_hold === false ? 'guards: a preregistered guard failed' : 'guards: none reported');
  if (card.usd_per_page_point_max != null && !(evidence.usd_per_page_point <= card.usd_per_page_point_max)) missing.push(`value: no price at or under $${card.usd_per_page_point_max} per page-point on the random sample`);

  // The judge. A paired difference needs controls, ties and two blind judges; an absolute judged
  // number, a large stake, or a candidate from the judge's own model family also needs readers.
  const j = evidence.judge;
  if (evidence.measure === 'judged_vs_reference' || evidence.measure === 'judged') {
    if (!j?.controls_pass) missing.push('judge: wrong-page, planted-change and duplicate controls did not all pass');
    if (!j?.ties_allowed) missing.push('judge: no tie option, or the duplicate tie rate is under 0.8');
    if (!(j?.blind_judges >= 2)) missing.push('judge: fewer than two blind judges');
    const needsHumans = tier === 'large' || j?.absolute_threshold || j?.same_family_as_candidate;
    if (needsHumans && !j?.human_calibrated) missing.push('judge: not calibrated against readers of the original (required: large stake, absolute threshold, or same model family as the candidate)');
  }

  // Languages. A pool never clears a language that is itself below directional; it can only lift
  // a directional language to decision grade, and only if it was registered and is homogeneous.
  const pool = evidence.pool, het = heterogeneity(evidence.languages, pool);
  const poolUsable = !!pool && pool.registered === true && het.pass === true && pool.n >= GRADES.decision
    && effectBeyondFloor(pool, evidence.floor, opts).pass === true;
  const languages = {};
  for (const l of evidence.languages) {
    const own = gradeOf(l.n), ownEffect = byRule ? { pass: l.rule_pass === true } : effectBeyondFloor(l, evidence.floor, opts);
    const inPool = poolUsable && own !== 'exploratory' && l.delta != null && (opts.higher_is_better ? l.delta : -l.delta) >= minEffect - EPS;
    const grade = own === 'decision' ? 'decision' : inPool ? 'decision (pooled)' : own;
    const enoughN = needs.grade === 'directional' ? own !== 'exploratory' : grade.startsWith('decision');
    const effectOk = ownEffect.pass === true || inPool;
    const short = Math.max(0, GRADES.directional - l.n), shortDecision = Math.max(0, GRADES.decision - l.n);
    languages[l.lang] = {
      n: l.n, grade, cleared: enoughN && effectOk,
      short_by: enoughN ? 0 : needs.grade === 'directional' || poolUsable ? short : shortDecision,
      why: [!enoughN && `${l.n} referenced books (${own}); needs ${needs.grade}`, !effectOk && own !== 'exploratory' && 'effect does not clear the floor and the minimum effect'].filter(Boolean),
    };
  }
  const uncleared = Object.entries(languages).filter(([, v]) => !v.cleared);
  if (uncleared.length) missing.push(`per-language evidence: ${uncleared.map(([k, v]) => `${k} (n ${v.n}${v.short_by ? `, short by ${v.short_by}` : ': the effect does not clear the floor and the minimum effect'})`).join(', ')}`);
  if (pool && pool.registered !== true) missing.push('pooling: the pool was not named before the run');
  if (pool && het.pass === false) missing.push(`pooling: not allowed, ${het.offenders.join(', ')} differ from the pool`);

  const rep = evidence.replication, replicated = !!rep && rep.fresh_books >= GRADES.directional && (rep.passed_alone === true || rep.pooled_registered === true);
  if (needs.replication && !replicated) missing.push(`replication: none on ≥ ${GRADES.directional} fresh books under the same rule`);
  if (needs.pool_or_replication && !replicated && !poolUsable && !Object.values(languages).every((v) => v.grade === 'decision')) missing.push('pool or replication: a medium stake needs a registered homogeneous pool at decision grade, decision grade alone, or a replication');

  return { card: cardId, tier, needs, sufficient: missing.length === 0, missing, languages, cleared: Object.keys(languages).filter((k) => languages[k].cleared), pooling: { usable: poolUsable, ...het } };
}

/**
 * Card 4. `kind: 'hold'` keeps a stratum out of NEW work and removes nothing served: a
 * provisional hold needs ≥ 10 books with the image opened on the low pages and an upper 95 %
 * bound under the sound line (4); it becomes a standing gate at 30 books. `kind: 'flag'` marks or
 * withholds served pages: precision ≥ 0.8 by a human read or an accuracy reference, with a Wilson
 * lower bound ≥ 0.65, and recall reported.
 */
function gateVerdict(card, e) {
  const missing = [];
  if (!e.preregistered) missing.push('preregistration: the threshold was not fixed before the run');
  if (e.kind === 'hold') {
    const strata = {};
    for (const s of e.strata) {
      const below = s.ci && s.ci[1] < card.hold.sound_line - EPS, enough = s.n >= card.hold.min_books;
      const status = !enough || !below ? 'not supported' : s.n >= card.hold.standing_books ? 'standing' : 'provisional';
      strata[s.stratum] = { n: s.n, mean: s.mean, ci: s.ci, status, short_by: Math.max(0, card.hold.standing_books - s.n) };
      if (status === 'not supported') missing.push(`stratum ${s.stratum}: ${!enough ? `n ${s.n} < ${card.hold.min_books}` : `upper bound ${s.ci?.[1]} is not under ${card.hold.sound_line}`}`);
    }
    if (!e.image_opened) missing.push('link 2: the page image was not opened on the low pages, so the OCR is not shown to be the cause');
    if (!e.release_rule) missing.push('release rule: none');
    if (!e.counter) missing.push('counter: none (eval-design §10.1 item 4)');
    if (e.removes_served) missing.push('a hold must remove nothing already served; this is a flag');
    return { card: 'gate', kind: 'hold', sufficient: missing.length === 0, provisional: Object.values(strata).some((s) => s.status === 'provisional'), missing, strata };
  }
  const p = e.precision, ci = p ? wilson95(p.hits, p.flagged) : null, share = p?.flagged ? p.hits / p.flagged : null;
  if (!(share >= card.flag.precision - EPS)) missing.push(`precision: ${share == null ? 'not measured' : r3(share)} is under ${card.flag.precision}`);
  if (!(ci && ci[0] >= card.flag.precision_wilson_lower - EPS)) missing.push(`precision: Wilson lower bound ${ci ? ci[0] : 'n/a'} is under ${card.flag.precision_wilson_lower} (read more flagged pages)`);
  if (!card.measures.small.includes(e.label_from)) missing.push(`label: "${e.label_from}" is not a human read or an accuracy reference`);
  if (e.recall == null) missing.push('recall: not reported');
  if (e.changes_served_text && !e.undo_proven) missing.push('undo: no revision row per page with a restore proven on one page');
  return { card: 'gate', kind: 'flag', sufficient: missing.length === 0, missing, precision: share == null ? null : r3(share), precision_wilson95: ci };
}
