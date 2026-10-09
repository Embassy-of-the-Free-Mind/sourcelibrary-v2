/**
 * pareto-stats.mjs — the statistics and the fitness rules shared by the two Pareto builders (#6386).
 *
 * PRIOR ART: scripts/eval/lib/paired-stats.mjs (seeded mulberry32, page-level bootstrap and paired sign tests; no
 * resampling by cluster) and lib/agreement-stats.mjs bootstrapItems (one statistic over items, unpaired). The
 * builders each had their own unclustered page bootstrap. Neither resamples WORKS, pairs every engine against the
 * engine in use, or grades a panel's fitness, so those three live here, once, for OCR and translation alike.
 *
 * Everything is seeded, so the committed charts are byte-stable (both builders run --check in CI).
 */
import { makeRng } from './paired-stats.mjs';

export const B = 2000;
export const r3 = x => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
export const median = xs => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Group items by cluster, in a stable order. */
function clusters(items, clusterOf) {
  const m = new Map();
  for (const it of items) { const k = clusterOf(it); if (!m.has(k)) m.set(k, []); m.get(k).push(it); }
  return [...m.keys()].sort().map(k => m.get(k));
}

/**
 * Cluster bootstrap: resample whole clusters (works) with replacement, apply `stat` to the pooled items of each
 * draw, and return the 2.5th and 97.5th percentiles. Pages of one work are one observation, so a page bootstrap
 * over them is too narrow (#6386 audit, point 5). Fewer than 5 clusters: no interval.
 */
export function clusterCI(items, clusterOf, stat, seed) {
  const cs = clusters(items, clusterOf);
  if (cs.length < 5) return null;
  const rand = makeRng(seed), out = [];
  for (let b = 0; b < B; b++) {
    const draw = [];
    for (let i = 0; i < cs.length; i++) for (const it of cs[Math.floor(rand() * cs.length)]) draw.push(it);
    out.push(stat(draw));
  }
  out.sort((a, b) => a - b);
  return [r3(out[Math.floor(0.025 * B)]), r3(out[Math.floor(0.975 * B)])];
}

/**
 * Paired difference against the engine in use: per page, d = score(engine) − score(in use), on the same pages;
 * the estimate is the mean of d, its interval a cluster bootstrap of that mean. Positive = better than in use.
 */
export function pairedDiff(pairs, seed) {
  // pairs: [{ d, cluster }]
  const est = mean(pairs.map(p => p.d));
  const ci = clusterCI(pairs, p => p.cluster, xs => mean(xs.map(p => p.d)), seed);
  return { diff: r3(est), ci95: ci, n_pages: pairs.length, n_works: new Set(pairs.map(p => p.cluster)).size };
}

/**
 * The verdict word for one engine against the engine in use. A difference counts only when its paired 95% interval
 * excludes 0 AND it is larger than the noise band: how far a second run of the engine in use moved on the same
 * pages (|AA − in use|), where such a run exists; else the interval alone decides.
 */
export function verdictOf(vs, band = 0) {
  if (!vs?.ci95) return 'same';
  const [lo, hi] = vs.ci95;
  if (lo > 0 && vs.diff > band) return 'better';
  if (hi < 0 && -vs.diff > band) return 'worse';
  return 'same';
}

/**
 * FITNESS GRADE of one panel, by fixed written rules (#6386). The page lists GRADE_RULES verbatim.
 *
 *   not_fit      fewer than 10 works; or #6304 judged the panel not fit to rank; or two metrics pooled in one score;
 *                or the reference was placed using the production engine's own OCR (latin-period-5126, eebo-tcp-5488,
 *                and the #6295 Syriac print draw), which favours the engine in use.
 *   directional  fit, but fails one soft rule: 10–19 works; or most pages are from famous texts (#6304), which a model
 *                may know by heart; or the reference is a modern edition rather than a transcription of the page.
 *   decide       20 or more works, a reference independent of production, one metric, and none of the above.
 *
 * A not_fit panel draws no frontier and gets no verdict.
 * `why` is the first rule that fired, in at most 12 words, for the badge.
 */
export function gradePanel({ works, unfit6304 = false, metrics = 1, productionAnchored = false, famousShare = 0, modernEdition = false }) {
  if (works < 10) return { level: 'not_fit', why: `${works} work${works === 1 ? '' : 's'}; at least 10 are needed` };
  if (unfit6304) return { level: 'not_fit', why: 'the sample check (#6304) found its references do not fit' };
  if (metrics > 1) return { level: 'not_fit', why: 'two different error measures pooled in one score' };
  if (productionAnchored) return { level: 'not_fit', why: "reference located with the engine in use's own reading" };
  if (works < 20) return { level: 'directional', why: `${works} works; a decision needs 20` };
  if (famousShare > 0.5) return { level: 'directional', why: 'mostly famous texts, which a model may know by heart' };
  if (modernEdition) return { level: 'directional', why: 'reference is a modern edition, not a transcription of the page' };
  return { level: 'decide', why: '20 or more works, independent reference, one measure' };
}

export const GRADE_RULES = {
  decide: '20 or more works, a reference made independently of the engine we use, one error measure, and no problem found by the sample check.',
  directional: 'Fit to read, but 10 to 19 works, or mostly famous texts a model may know by heart, or a modern edition as the reference rather than a transcription of the page.',
  not_fit: 'Fewer than 10 works, or the sample check found the references do not fit, or two error measures pooled, or the reference was located using our own engine’s reading. No frontier and no verdict.',
};

/** Non-dominated set among priced points: nothing else is at least as cheap and at least as good, and better on one. */
export function markFrontier(points, yOf, draw) {
  for (const a of points) a.on_frontier = draw && !points.some(b => b !== a
    && b.cost.usd_per_1k <= a.cost.usd_per_1k && yOf(b) >= yOf(a)
    && (b.cost.usd_per_1k < a.cost.usd_per_1k || yOf(b) > yOf(a)));
}

const listOf = xs => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const usd = x => `$${x < 0.1 ? x.toFixed(3) : x.toFixed(2)}`;

/**
 * The one sentence above a chart, from the paired comparisons and the grade. `num` writes a signed difference in the
 * measure's unit without the unit ("+1.2"); `unit` names it ("points"); `verb` is "reads" or "scores".
 */
export function verdictSentence(panel, { num, unit, verb }) {
  if (panel.grade.level === 'not_fit') return 'No verdict: not fit to rank engines.';
  const all = [...panel.placed, ...panel.no_cost];
  const prod = all.find(p => p.production);
  if (!prod) return 'No verdict: the engine we use was not run on these pages.';
  const better = all.filter(p => p.verdict === 'better').sort((a, b) => b.vs_in_use.diff - a.vs_in_use.diff);
  const out = [];
  if (better.length) {
    const b = better[0], v = b.vs_in_use;
    const cheaper = b.cost && prod.cost && b.cost.basis === 'billed' && b.cost.usd_per_1k < prod.cost.usd_per_1k;
    out.push(`${b.label} ${verb} better than ${prod.label}, the engine we use, by ${num(v.diff)} ${unit} (95% interval ${num(v.ci95[0])} to ${num(v.ci95[1])})${cheaper ? `, and costs less (${usd(b.cost.usd_per_1k)} against ${usd(prod.cost.usd_per_1k)} per 1,000 pages)` : ''}.`);
    if (better.length > 1) {
      const rest = better.slice(1, 3).map(p => p.label);
      out.push(`Also better: ${better.length > 3 ? `${rest.join(', ')} and ${better.length - 3} more` : listOf(rest)}.`);
    }
  } else {
    out.push(`No engine is clearly better than ${prod.label}, the engine we use: the differences are within the noise.`);
  }
  if (prod.cost) {
    const cheaper = panel.placed.filter(p => !p.production && p.verdict === 'same' && p.vs_in_use?.ci95 && p.vs_in_use.ci95[1] >= 0 && p.cost.basis === 'billed' && p.cost.usd_per_1k < prod.cost.usd_per_1k)
      .sort((a, b) => a.cost.usd_per_1k - b.cost.usd_per_1k);
    if (cheaper.length) out.push(`${listOf(cheaper.slice(0, 2).map(p => `${p.label} (${usd(p.cost.usd_per_1k)})`))} cost${cheaper.length === 1 ? 's' : ''} less than ${usd(prod.cost.usd_per_1k)} per 1,000 pages and ${cheaper.length === 1 ? 'is' : 'are'} not measurably worse.`);
  }
  return out.join(' ');
}
