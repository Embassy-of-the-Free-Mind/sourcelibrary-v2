// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs (judgePrompt, opusCall, parseVerdict: imported unchanged, through
// scripts/eval/correction-pass-7818/lib.mjs judgeAbsolute and paceCheck, also imported unchanged);
// scripts/eval/lib/plant-ocr-errors.mjs (one grammatical semantic plant in la/de/fr body lines: it has no English, Italian
// or Greek, needs our markup to find body lines, and plants ONE error, so it cannot grade a text by CER — here the
// severities are CER bands, planted as OCR-shaped character confusions, word drops and a line drop, in any script);
// scripts/eval/lib/agreement-stats.mjs (wilson, bootstrapItems: imported); scripts/eval/lib/metrics.mjs
// (scoreAgainstReference / normalizeForScript: the CER). Searched scripts/eval/INDEX.md and EXPERIMENTS.md ("CHURRO",
// "sensitivity", "specificity", "self-preference", "gold"): bench-2 ran CHURRO-3B as an ENGINE; no record calibrates
// the judge against an external human transcription.
/**
 * Judge calibration against CHURRO-DS (#7263, step 2 of the 2026-11-01 R&D plan). Shared pieces: gold extraction from
 * CHURRO's XML, graded planting, CER truth, and the statistics (sensitivity / specificity / kappa, DBG self-preference,
 * the sensitivity-specificity plug-in correction of a router k/n).
 *
 * LICENCE: CHURRO-DS is "permitted for research purposes only" (the dataset card). Nothing of its text or images is
 * committed: the committed rows carry example ids, CERs and verdict fields (defect classes, never quotes).
 */
import { scoreAgainstReference, normalizeForScript, windowedErrorRate } from '../lib/metrics.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

// ── strata: the routed languages present in CHURRO-DS test + dev (Italian and Greek only as manuscripts there) ──
export const STRATA = [
  { id: 'la-print', lang: 'Latin', type: 'print', script: 'latin' },
  { id: 'de-print', lang: 'German', type: 'print', script: 'latin' },
  { id: 'fr-print', lang: 'French', type: 'print', script: 'latin' },
  { id: 'en-print', lang: 'English', type: 'print', script: 'latin' },
  { id: 'it-ms', lang: 'Italian', type: 'handwriting', script: 'latin' },
  { id: 'el-ms', lang: 'Greek', type: 'handwriting', script: 'greek' },
  { id: 'la-ms', lang: 'Latin', type: 'handwriting', script: 'latin' },
];

// ── gold: the text of CHURRO's <Page> (header, body, footer), one <Line> a line, inline tags dropped, text kept ──
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
export function goldText(xml) {
  const page = String(xml).match(/<Page\b[^>]*>([\s\S]*)<\/Page>/)?.[1] ?? '';
  return page
    .replace(/<(Description|PhysicalDescription|Metadata)\b[\s\S]*?<\/\1>/g, ' ')
    .replace(/<\/(Line|PageNumber|Paragraph|Heading|Header|Footer|Signature|Catchword|Item|Cell|Row)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENT[m])
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}

// German ß folds to ss on both sides (#7818 preFold); the script's own normaliser does the rest.
const preFold = (t) => String(t || '').replace(/ß/g, 'ss').replace(/ẞ/g, 'SS');
/** The gold's scored characters (normalised, spaces out): the CER's denominator. */
export const refChars = (gold, script) => normalizeForScript(preFold(gold), script).replace(/ /g, '').length;
/** Windowed CER of a candidate against the gold (metrics.mjs, NORMALIZE_FOR_SCRIPT v4), plus the aligned guard. */
export function cerOf(gold, cand, script) {
  const s = scoreAgainstReference(preFold(gold), preFold(cand), script);
  return { cer: s.windowedCer ?? 1, cer_subsequence: s.cer, wer_guard: s.guard?.value ?? null, aligned: s.aligned, ref_chars: s.windowUnits };
}

/**
 * ORDER-FREE CER: each gold line aligned on its own (fitting alignment, metrics.mjs windowedErrorRate) anywhere in the
 * candidate, edits summed over the gold's characters. It charges a misread, a dropped word and a dropped line as the
 * windowed CER does, but not a column or block read in another order than the gold's: CHURRO's line order is the
 * transcriber's, not an authority on reading order, and on multi-column pages the windowed CER charged a correct read
 * up to 50% for it (results: read-diffs). It does not charge text the candidate ADDS outside the gold's lines.
 */
export function cerLines(gold, cand, script) {
  const C = normalizeForScript(preFold(cand), script);
  let edits = 0, chars = 0;
  for (const l of String(gold).split('\n')) {
    const L = normalizeForScript(preFold(l), script); const n = L.replace(/ /g, '').length;
    if (!n) continue;
    edits += windowedErrorRate(L, C).windowedCer * n; chars += n;
  }
  return chars ? Math.min(1, edits / chars) : 0;
}

/**
 * ABBREVIATION-TOLERANT WORD ERROR (order-free, like cerLines): the share of gold words with no match in the candidate,
 * where a gold word matches a candidate word that keeps its first letter and contains it as a subsequence ("dni" ->
 * "domini", "nri" -> "nostri", "q" -> "que"). A check on the manuscript strata, where the gold is diplomatic and a
 * read may expand: an expansion is not charged, a misread or a dropped word is. Each gold line aligned on its own.
 */
const subseqOf = (g, r) => { if (g[0] !== r[0]) return false; let i = 0; for (const c of r) { if (c === g[i]) i++; if (i === g.length) return true; } return i === g.length; };
export function werTolerant(gold, cand, script) {
  const C = normalizeForScript(preFold(cand), script).split(' ').filter(Boolean);
  let miss = 0, tot = 0;
  for (const l of String(gold).split('\n')) {
    const L = normalizeForScript(preFold(l), script).split(' ').filter(Boolean); if (!L.length) continue;
    tot += L.length;
    let prev = new Array(C.length + 1).fill(0);          // the line may start anywhere in the candidate
    for (let i = 1; i <= L.length; i++) {
      const cur = new Array(C.length + 1); cur[0] = i;
      for (let j = 1; j <= C.length; j++) cur[j] = Math.min(subseqOf(L[i - 1], C[j - 1]) ? prev[j - 1] : Infinity, prev[j] + 1, cur[j - 1] + 1);
      prev = cur;
    }
    miss += Math.min(L.length, ...prev);
  }
  return tot ? miss / tot : 0;
}

// ── graded plants: OCR-shaped errors to a target CER band ──
// S1 ~0.3% (a few slips), S2 ~3%, S3 ~10% with one whole line dropped. Each band is hit by adding errors one at a time
// and re-scoring, so the band is what the scorer measures, not what was intended.
export const SEVERITIES = { S1: { target: 0.003, lo: 0.0015, hi: 0.006 }, S2: { target: 0.03, lo: 0.02, hi: 0.045 }, S3: { target: 0.10, lo: 0.075, hi: 0.15, dropLine: true } };
const CONFUSE = {
  latin: [['e', 'c'], ['c', 'e'], ['n', 'u'], ['u', 'n'], ['m', 'rn'], ['rn', 'm'], ['h', 'b'], ['l', 'i'], ['i', 'l'], ['a', 'o'], ['o', 'a'], ['t', 'r'], ['f', 's'], ['s', 'f'], ['d', 'cl'], ['ii', 'n'], ['1', '7'], ['5', '3']],
  greek: [['ο', 'σ'], ['σ', 'ο'], ['ν', 'υ'], ['υ', 'ν'], ['ε', 'ς'], ['τ', 'γ'], ['γ', 'τ'], ['η', 'ῃ'], ['ι', 'ῖ'], ['α', 'ω'], ['ω', 'α'], ['ρ', 'ϱ'], ['κ', 'χ'], ['λ', 'α'], ['π', 'τ'], ['μ', 'ν']],
};
/**
 * Plant errors into the gold until its CER reaches the severity's target, and keep it only inside the band. Returns { text, cer, ops } or null (no band
 * reachable, e.g. a page too short for a 0.3% slip). Deterministic in (gold, severity, seed).
 */
export function plantGraded(gold, sev, script, seed) {
  const S = SEVERITIES[sev], R = makeRng(seed), conf = CONFUSE[script] ?? CONFUSE.latin;
  let lines = gold.split('\n'); const ops = [];
  if (S.dropLine) {
    const body = lines.map((l, i) => [l, i]).filter(([l, i]) => i > 0 && i < lines.length - 1 && l.length >= 20);
    if (body.length) { const [, i] = body[Math.floor(R() * body.length)]; ops.push({ op: 'drop_line', chars: lines[i].length }); lines = lines.filter((_, j) => j !== i); }
  }
  let text = lines.join('\n'), c = cerOf(gold, text, script).cer;
  const n = refChars(gold, script);
  // Errors go in batches of half the estimated gap (about one scored character an error), re-scored after each batch,
  // until the CER reaches the band's target: a 5,000-character page then takes a handful of O(n^2) scores, not hundreds.
  for (let round = 0; c < S.target && round < 60; round++) {
    const batch = Math.max(1, Math.floor(((S.target - c) * n) / 2));
    for (let e = 0, guard = 0; e < batch && guard < batch * 20; guard++) {
      const k = R();
      if (k < 0.8) {                          // a character confusion inside a word
        const [a, b] = conf[Math.floor(R() * conf.length)];
        const hits = [...text.matchAll(new RegExp(a, 'g'))].map((m) => m.index);
        if (!hits.length) continue;
        const at = hits[Math.floor(R() * hits.length)];
        text = text.slice(0, at) + b + text.slice(at + a.length); ops.push({ op: 'sub', from: a, to: b });
      } else if (k < 0.95) {                  // a short word dropped
        const ws = [...text.matchAll(/(?<=\s)[\p{L}]{2,5}(?=\s)/gu)];
        if (!ws.length) continue;
        const m = ws[Math.floor(R() * ws.length)];
        text = text.slice(0, m.index) + text.slice(m.index + m[0].length + 1); ops.push({ op: 'drop_word', chars: m[0].length });
      } else {                                // two letters transposed
        const ws = [...text.matchAll(/[\p{L}]{4,}/gu)];
        if (!ws.length) continue;
        const m = ws[Math.floor(R() * ws.length)], i = m.index + 1 + Math.floor(R() * (m[0].length - 2));
        text = text.slice(0, i) + text[i + 1] + text[i] + text.slice(i + 2); ops.push({ op: 'swap' });
      }
      e++;
    }
    c = cerOf(gold, text, script).cer;
  }
  if (c < S.lo || c > S.hi) return null;
  return { text, cer: c, ops: ops.length, op_counts: ops.reduce((o, x) => ({ ...o, [x.op]: (o[x.op] ?? 0) + 1 }), {}) };
}

// ── statistics ──
import { wilson } from '../lib/agreement-stats.mjs';
export { wilson };
/** Cohen's kappa on binary pairs [{j, t}] (judge accept, truth accept). */
export function kappa(rows) {
  const n = rows.length; if (!n) return null;
  const po = rows.filter((r) => r.j === r.t).length / n;
  const pj = rows.filter((r) => r.j).length / n, pt = rows.filter((r) => r.t).length / n;
  const pe = pj * pt + (1 - pj) * (1 - pt);
  return pe === 1 ? null : (po - pe) / (1 - pe);
}
/** Page-cluster bootstrap: resample PAGES (all of a page's items together), return [lo, hi] of stat. */
export function clusterBoot(rows, stat, seed = 7263, iters = 2000) {
  const R = makeRng(seed), by = new Map();
  for (const r of rows) by.set(r.page, [...(by.get(r.page) ?? []), r]);
  const groups = [...by.values()], out = [];
  for (let b = 0; b < iters; b++) {
    const s = []; for (let i = 0; i < groups.length; i++) s.push(...groups[Math.floor(R() * groups.length)]);
    const v = stat(s); if (v != null && Number.isFinite(v)) out.push(v);
  }
  out.sort((a, b) => a - b);
  return out.length ? [out[Math.floor(0.025 * out.length)], out[Math.floor(0.975 * out.length) - 1]] : [null, null];
}
/** sensitivity = P(judge accepts | truth accept), specificity = P(judge rejects | truth reject), kappa, with intervals. */
export function confusion(rows, seed) {
  const tp = rows.filter((r) => r.t && r.j).length, fn = rows.filter((r) => r.t && !r.j).length;
  const tn = rows.filter((r) => !r.t && !r.j).length, fp = rows.filter((r) => !r.t && r.j).length;
  const sens = tp + fn ? tp / (tp + fn) : null, spec = tn + fp ? tn / (tn + fp) : null;
  const k = kappa(rows);
  return { n: rows.length, tp, fn, tn, fp, sens, sens_ci: tp + fn ? wilson(tp, tp + fn) : null, spec, spec_ci: tn + fp ? wilson(tn, tn + fp) : null,
    kappa: k, kappa_ci: k == null ? null : clusterBoot(rows, kappa, seed) };
}

/**
 * The sensitivity-specificity plug-in (Rogan-Gladen; Lee et al. 2025, arXiv 2511.21140): the true acceptance theta
 * from the judge's observed rate p = k/n, theta = (p + spec - 1) / (sens + spec - 1), clipped to [0, 1]; its variance
 * by the delta method over all three sources (the router's n, and the calibration set's m1 truth-accept and m0
 * truth-reject items). Also a parametric bootstrap from Beta(k+0.5, n-k+0.5) posteriors, which keeps the clip honest.
 */
export function plugIn({ k, n }, { tp, fn, tn, fp }, seed = 7263) {
  const p = k / n, m1 = tp + fn, m0 = tn + fp, q1 = tp / m1, q0 = tn / m0, D = q1 + q0 - 1;
  const theta = (p + q0 - 1) / D;
  const v = (p * (1 - p) / n + (1 - theta) ** 2 * q0 * (1 - q0) / m0 + theta ** 2 * q1 * (1 - q1) / m1) / D ** 2;
  const se = Math.sqrt(v), clip = (x) => Math.min(1, Math.max(0, x));
  const R = makeRng(seed), draws = [];
  const beta = (a, b) => { const g = (s) => gamma(s, R); const x = g(a); return x / (x + g(b)); };
  for (let i = 0; i < 20000; i++) {
    const pp = beta(k + 0.5, n - k + 0.5), s1 = beta(tp + 0.5, fn + 0.5), s0 = beta(tn + 0.5, fp + 0.5), d = s1 + s0 - 1;
    if (d > 0.05) draws.push(clip((pp + s0 - 1) / d));
  }
  draws.sort((a, b) => a - b);
  return { p_observed: p, sens: q1, spec: q0, youden: D, theta: clip(theta), theta_raw: theta, delta_ci: [clip(theta - 1.96 * se), clip(theta + 1.96 * se)], se,
    boot_ci: [draws[Math.floor(0.025 * draws.length)], draws[Math.floor(0.975 * draws.length)]], boot_draws_kept: draws.length,
    naive_ci: wilson(k, n) };
}
// Marsaglia-Tsang gamma sampler (shape >= 1; boosted below 1).
function gamma(a, R) {
  if (a < 1) return gamma(a + 1, R) * R() ** (1 / a);
  const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v; do { const u1 = R(), u2 = R(); x = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0);
    v = v ** 3; const u = R();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Logistic fit of accept on log10(CER) by Newton's method: returns {a, b, cer50} (cer50 = CER at P(accept) = 0.5). */
export function logitFit(rows) {
  const X = rows.map((r) => Math.log10(Math.max(r.cer, 1e-4))), Y = rows.map((r) => (r.j ? 1 : 0));
  let a = 0, b = -1;
  for (let it = 0; it < 50; it++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (let i = 0; i < X.length; i++) { const p = 1 / (1 + Math.exp(-(a + b * X[i]))), w = p * (1 - p); g0 += Y[i] - p; g1 += (Y[i] - p) * X[i]; h00 += w; h01 += w * X[i]; h11 += w * X[i] * X[i]; }
    const det = h00 * h11 - h01 * h01; if (Math.abs(det) < 1e-12) break;
    a += (h11 * g0 - h01 * g1) / det; b += (h00 * g1 - h01 * g0) / det;
  }
  return { a, b, cer50: b ? 10 ** (-a / b) : null };
}
