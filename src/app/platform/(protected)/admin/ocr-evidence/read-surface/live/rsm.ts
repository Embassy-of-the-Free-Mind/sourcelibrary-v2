/**
 * The response-surface fit behind /platform/admin/ocr-evidence/read-surface/live (#6740), in plain TS so the browser
 * can refit on every update and every control change.
 *
 * Estimator: within-book weighted least squares. Every book is a block: its mean is subtracted from the response and
 * from every model term, so a comparison is only ever made inside a book (the paired design's analysis; the
 * fixed-effect twin of the experiment's random book intercept). Terms are in real units, coded on fixed scales that
 * never move as runs land: pages a call in log pages (1 → −1, 8 → +1: a call's cost is shared by its pages, so cost a
 * page falls like 1 / pages and is near-linear only in the log), long edge in log pixels (768 px → −1, 2,400 px → +1),
 * thinking low/medium/high −1/0/+1, prompt line live −1 / other +1. A factor with one level in the data drops out; a
 * factor with two levels gets no square; a term the data cannot separate from the others is reported as not estimable
 * rather than given a number.
 *
 * PRIOR ART: scripts/eval/read-surface-6740/surface6.mjs (full quadratic by least squares on run means, coded −1/0/1
 * levels; that coding cannot pool 1,024/1,600/2,400 px with 768/1,400 px, and run means cannot fit at the page level).
 */
import type { LiveDoc, LiveRow, LiveSetting } from './shape';

export type ModelKind = 'main' | 'twofi' | 'quad';
export const BASES = ['cer', 'quota_cost', 'calls', 'wall_s', 'accepted'] as const;
export type Base = (typeof BASES)[number];
export type Response = 'cer' | 'quota_cost' | 'cost_per_accepted' | 'calls' | 'accepted_per_hour';

/** A point in real units. `line` is true for any prompt line other than the live prompt. */
export interface Point { ppc: number; edge: number; think: number; line: boolean }

const E_LO = Math.log2(768), E_HI = Math.log2(2400);
export const FACTORS = ['pages a call', 'long edge', 'thinking', 'prompt line'] as const;
export const code = (p: Point): number[] => [Math.log2(p.ppc) / 1.5 - 1, (Math.log2(p.edge) - (E_LO + E_HI) / 2) / ((E_HI - E_LO) / 2), p.think, p.line ? 1 : -1];
export const edgeOf = (x: number[]) => Math.pow(2, x[1] * ((E_HI - E_LO) / 2) + (E_LO + E_HI) / 2);
export const THINK_X: Record<string, number> = { low: -1, medium: 0, high: 1 };
export const SERVED_PX = 2350;   // the panel median long edge, for a setting at "image as served" with no rows yet

export interface Obs { book: string; run: string; x: number[]; pool: number; w: number; y: Record<Base, number | null> }
export interface Term { name: string; f: (x: number[], pool: number) => number }

/** Rows → observations. Excluded targets never enter; `null` y means that response was not measured on the row. */
export function toObs(rows: LiveRow[], settings: LiveSetting[], weightOf: (book: string) => number): Obs[] {
  const sById = new Map(settings.map((s) => [`${s.lang ?? rows[0]?.lang}:${s.id}`, s]));
  const out: Obs[] = [];
  for (const r of rows) {
    if (r.excluded) continue;
    const s = sById.get(`${r.lang}:${r.setting_id}`);
    if (!s) continue;
    const w = weightOf(r.book_id);
    if (!(w > 0)) continue;
    const edge = r.long_edge_px ?? s.long_edge ?? SERVED_PX;
    out.push({
      book: r.book_id, run: r.run_id, w, pool: r.pool === 'default' ? 0 : 1,
      x: code({ ppc: s.pages_a_call, edge, think: THINK_X[s.thinking], line: s.prompt_line !== 'live' }),
      y: { cer: r.cer, quota_cost: r.quota_cost, calls: r.calls, wall_s: r.wall_s, accepted: r.accepted === undefined ? (r.cer !== null && !r.wrong_text && !r.loop && !r.cut ? 1 : 0) : r.accepted ? 1 : 0 },
    });
  }
  return out;
}

/** The model's terms for this data: factors with one level drop, squares only for factors with ≥ 3 levels. */
export function termsFor(obs: Obs[], kind: ModelKind): Term[] {
  const distinct = [0, 1, 2, 3].map((j) => new Set(obs.map((o) => Math.round(o.x[j] * 1000))).size);
  const act = [0, 1, 2, 3].filter((j) => distinct[j] > 1);
  const T: Term[] = act.map((j) => ({ name: FACTORS[j], f: (x) => x[j] }));
  if (kind !== 'main') for (let a = 0; a < act.length; a++) for (let b = a + 1; b < act.length; b++) {
    const i = act[a], j = act[b];
    T.push({ name: `${FACTORS[i]} × ${FACTORS[j]}`, f: (x) => x[i] * x[j] });
  }
  if (kind === 'quad') for (const j of act) if (j < 3 && distinct[j] >= 3) T.push({ name: `${FACTORS[j]}²`, f: (x) => x[j] * x[j] });
  if (new Set(obs.map((o) => o.pool)).size > 1) T.push({ name: 'pool (James − default)', f: (_x, pool) => pool });
  return T;
}

/** The richest model with fewer terms than the runs it is fitted through, less one: a model with as many terms as
 *  design points passes through every run exactly and says nothing between them. */
export function autoKind(obs: Obs[]): ModelKind {
  const runs = new Set(obs.map((o) => o.run)).size;
  for (const k of ['quad', 'twofi', 'main'] as ModelKind[]) if (termsFor(obs, k).length < runs - 1) return k;
  return 'main';
}

export interface Fit { beta: number[]; estimable: boolean[]; grand: number; fbar: number[]; n: number; books: number; resid: { fitted: number; resid: number }[] }

/** Within-book WLS of one response on the terms. */
export function fitWithin(obs: Obs[], terms: Term[], base: Base): Fit {
  const k = terms.length;
  const rows = obs.filter((o) => o.y[base] !== null && Number.isFinite(o.y[base] as number));
  const byBook = new Map<string, Obs[]>();
  for (const o of rows) { const a = byBook.get(o.book); if (a) a.push(o); else byBook.set(o.book, [o]); }
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0)), Xty = new Array(k).fill(0);
  let sw = 0, sy = 0; const sf = new Array(k).fill(0);
  const dm: { o: Obs; f: number[]; y: number; fr: number[]; yb: number }[] = [];
  for (const os of byBook.values()) {
    const F = os.map((o) => terms.map((t) => t.f(o.x, o.pool)));
    const fm = new Array(k).fill(0); let ym = 0;
    os.forEach((o, i) => { ym += o.y[base] as number; for (let j = 0; j < k; j++) fm[j] += F[i][j]; });
    ym /= os.length; for (let j = 0; j < k; j++) fm[j] /= os.length;
    os.forEach((o, i) => {
      const y = o.y[base] as number, w = o.w;
      sw += w; sy += w * y; for (let j = 0; j < k; j++) sf[j] += w * F[i][j];
      if (os.length < 2) return;
      const f = F[i].map((v, j) => v - fm[j]), yd = y - ym;
      for (let a = 0; a < k; a++) { Xty[a] += w * f[a] * yd; for (let b = a; b < k; b++) XtX[a][b] += w * f[a] * f[b]; }
      dm.push({ o, f, y: yd, fr: F[i], yb: ym });
    });
  }
  for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
  const { beta, estimable } = solvePivot(XtX, Xty);
  const grand = sw ? sy / sw : NaN, fbar = sf.map((v) => (sw ? v / sw : 0));
  const resid = dm.map(({ f, y, fr }) => {
    const within = f.reduce((s, v, j) => s + v * beta[j], 0);
    return { fitted: grand + fr.reduce((s, v, j) => s + (v - fbar[j]) * beta[j], 0), resid: y - within };
  });
  return { beta, estimable, grand, fbar, n: rows.length, books: byBook.size, resid };
}

/** Symmetric solve that drops (zeroes) any term whose pivot vanishes: a term the data cannot separate. */
function solvePivot(A0: number[][], b0: number[]) {
  const k = b0.length, A = A0.map((r) => [...r]), b = [...b0];
  const est = new Array(k).fill(true), diag = A0.map((r, i) => r[i]);
  for (let c = 0; c < k; c++) {
    if (!(Math.abs(A[c][c]) > 1e-9 * Math.max(1e-12, diag[c])) || diag[c] <= 1e-12) {
      est[c] = false;
      for (let j = 0; j < k; j++) { A[c][j] = 0; A[j][c] = 0; } A[c][c] = 1; b[c] = 0;
      continue;
    }
    for (let r = 0; r < k; r++) if (r !== c && A[r][c] !== 0) {
      const f = A[r][c] / A[c][c];
      for (let j = c; j < k; j++) A[r][j] -= f * A[c][j];
      b[r] -= f * b[c];
    }
  }
  return { beta: b.map((v, i) => (est[i] ? v / A[i][i] : 0)), estimable: est };
}

export const predictBase = (fit: Pick<Fit, 'beta' | 'grand' | 'fbar'>, terms: Term[], x: number[]) =>
  fit.grand + terms.reduce((s, t, j) => s + (t.f(x, 0) - fit.fbar[j]) * fit.beta[j], 0);

export type FitSet = Record<Base, Pick<Fit, 'beta' | 'grand' | 'fbar'>>;

/** Every response at a point, from one set of base fits (prediction at the default pool). */
export function predictAll(fs: FitSet, terms: Term[], p: Point): Record<Response, number> {
  const x = code(p);
  // Floored at what is physically possible: a quadratic carried to a corner will happily predict a negative cost.
  const cer = Math.max(0, predictBase(fs.cer, terms, x)), cost = Math.max(0, predictBase(fs.quota_cost, terms, x)), calls = Math.max(0, predictBase(fs.calls, terms, x));
  const wall = Math.max(1, predictBase(fs.wall_s, terms, x)), acc = Math.min(1, Math.max(0.01, predictBase(fs.accepted, terms, x)));
  return { cer, quota_cost: cost, calls, cost_per_accepted: cost / acc, accepted_per_hour: (3600 * acc) / wall };
}

export const MAXIMISE: Record<Response, boolean> = { cer: false, quota_cost: false, cost_per_accepted: false, calls: false, accepted_per_hour: true };
/** The cost the optimum minimises (or throughput it maximises); for CER the cost is quota cost a page. */
export const objectiveOf = (r: Response): Response => (r === 'cer' ? 'quota_cost' : r);

export interface Region { ppc: [number, number]; edge: [number, number]; think: number[]; line: boolean[] }

/** The region the data covers; the optimum is never read off outside it. */
export function regionOf(doc: LiveDoc, lang: string, obs: Obs[]): Region {
  const ss = doc.design.settings.filter((s) => (s.lang ?? lang) === lang && s.status === 'done');
  const ppcs = ss.map((s) => s.pages_a_call);
  // Pixels actually sent; an image as served runs from ~1,000 to ~6,600 px, so the tails are a handful of pages and
  // the region is the middle 90 % of them, not the extremes.
  const edges = obs.map((o) => edgeOf(o.x));
  return {
    ppc: [Math.min(...ppcs, 4), Math.max(...ppcs, 4)],
    edge: edges.length ? [quantile(edges, 0.05), quantile(edges, 0.95)] : [SERVED_PX, SERVED_PX],
    think: [...new Set(ss.map((s) => THINK_X[s.thinking]))].sort(),
    line: [...new Set(ss.map((s) => s.prompt_line !== 'live'))],
  };
}

export function candidates(R: Region, nEdge = 12): Point[] {
  const out: Point[] = [];
  const ppcs: number[] = []; for (let p = Math.ceil(R.ppc[0]); p <= R.ppc[1]; p++) ppcs.push(p);
  const edges = R.edge[1] / R.edge[0] < 1.02 ? [R.edge[0]] : Array.from({ length: nEdge }, (_, i) => R.edge[0] * Math.pow(R.edge[1] / R.edge[0], i / (nEdge - 1)));
  for (const ppc of ppcs) for (const edge of edges) for (const think of R.think.length ? R.think : [-1]) for (const line of R.line.length ? R.line : [false]) out.push({ ppc, edge, think, line });
  return out;
}

export interface Optimum { point: Point; value: number; cer: number; feasible: number }

/** Cheapest point (by the objective) whose predicted CER is within `margin` of the live point's predicted CER. */
export function optimum(fs: FitSet, terms: Term[], cands: Point[], live: Point, resp: Response, margin: number): Optimum | null {
  const obj = objectiveOf(resp), sign = MAXIMISE[obj] ? -1 : 1;
  const bound = predictAll(fs, terms, live).cer + margin;
  let best: Optimum | null = null, feasible = 0;
  for (const p of cands) {
    const v = predictAll(fs, terms, p);
    if (!(v.cer > 0 && v.quota_cost > 0 && v.calls > 0)) continue;   // floored: the surface is past what is possible
    if (!(v.cer <= bound)) continue;
    feasible++;
    if (!best || sign * v[obj] < sign * best.value) best = { point: p, value: v[obj], cer: v.cer, feasible: 0 };
  }
  if (best) best.feasible = feasible;
  return best;
}

/** How far a point sits from the frontier: its objective against the best objective at equal or lower predicted CER. */
export function frontierGap(fs: FitSet, terms: Term[], cands: Point[], p: Point, resp: Response): number | null {
  const obj = objectiveOf(resp), here = predictAll(fs, terms, p);
  let best: number | null = null;
  for (const c of cands) {
    const v = predictAll(fs, terms, c);
    if (v.cer > here.cer) continue;
    if (best === null || (MAXIMISE[obj] ? v[obj] > best : v[obj] < best)) best = v[obj];
  }
  if (best === null || best === 0) return null;
  return MAXIMISE[obj] ? 1 - here[obj] / best : here[obj] / best - 1;
}

export function fitAll(obs: Obs[], terms: Term[]): Record<Base, Fit> {
  return Object.fromEntries(BASES.map((b) => [b, fitWithin(obs, terms, b)])) as Record<Base, Fit>;
}

/** Book-adjusted mean of each run: the mean of (row − its book's mean) plus the grand mean. Paired, so runs that read
 *  different books (the incomplete blocks) are compared as if they had read the same ones. */
export function adjustedRunMeans(obs: Obs[], base: Base): Map<string, number> {
  const rows = obs.filter((o) => o.y[base] !== null);
  const bm = new Map<string, { s: number; n: number }>();
  let sw = 0, sy = 0;
  for (const o of rows) { const a = bm.get(o.book) ?? { s: 0, n: 0 }; a.s += o.y[base] as number; a.n++; bm.set(o.book, a); sw += o.w; sy += o.w * (o.y[base] as number); }
  const grand = sw ? sy / sw : 0, acc = new Map<string, { s: number; w: number }>();
  for (const o of rows) {
    const b = bm.get(o.book)!; if (b.n < 2) continue;
    const a = acc.get(o.run) ?? { s: 0, w: 0 }; a.s += o.w * ((o.y[base] as number) - b.s / b.n); a.w += o.w; acc.set(o.run, a);
  }
  return new Map([...acc].map(([r, a]) => [r, grand + a.s / a.w]));
}

/** Resample books with replacement; each copy of a book is its own block. Deterministic for a seed. */
export function resampleBooks(obs: Obs[], seed: number): Obs[] {
  const books = [...new Set(obs.map((o) => o.book))];
  const by = new Map<string, Obs[]>(); for (const o of obs) { const a = by.get(o.book); if (a) a.push(o); else by.set(o.book, [o]); }
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const out: Obs[] = [];
  for (let i = 0; i < books.length; i++) { const b = books[Math.floor(rnd() * books.length)]; for (const o of by.get(b)!) out.push({ ...o, book: `${b}#${i}` }); }
  return out;
}

export interface BootResult { fits: FitSet[]; }

/** B resamples by book, every base refit on the same resample. */
export function bootstrap(obs: Obs[], terms: Term[], B: number, onProgress?: (i: number) => void): BootResult {
  const fits: FitSet[] = [];
  for (let i = 0; i < B; i++) {
    const rs = resampleBooks(obs, 6740 + i * 7919);
    const f = {} as FitSet;
    for (const b of BASES) { const r = fitWithin(rs, terms, b); f[b] = { beta: r.beta, grand: r.grand, fbar: r.fbar }; }
    fits.push(f);
    if (onProgress && i % 20 === 19) onProgress(i + 1);
  }
  return { fits };
}

export const quantile = (xs: number[], p: number) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!s.length) return NaN;
  const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};

/** Inverse standard normal (Acklam), for the half-normal plot's quantiles. */
export function qnorm(p: number) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) return -qnorm(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
