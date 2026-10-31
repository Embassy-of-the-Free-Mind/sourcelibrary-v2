/**
 * The lead of the live read-surface page (#6740): the screen's 3 × 3 cells (pages a call × thinking), each compared
 * with live inside the books that read both, for the 3D surface and the grid that say the finding at a glance.
 *
 * Estimator, cell c against live L, over the books P_c that have a scored row in both (book weights from the doc's
 * queue weights when the language has them, else 1; a book with no weight gets 1, as the instrument's "weighted"):
 *   CER difference  = Σ w (cer_c − cer_L) / Σ w                          (pages with a CER in both)
 *   cost a page     = cost_L(all live books) × Σ w cost_c / Σ w cost_L  (a within-book ratio: cost is skewed and
 *                     multiplicative in pages a call, as the experiment's log-cost model)
 *   yield           = yield_L(all live books) + Σ w (acc_c − acc_L) / Σ w, capped at 1
 *   cost / accepted = cost a page / yield;  saving = 1 − (cost / accepted)_c / (cost / accepted)_L
 * Intervals: 95 % percentile bootstrap resampling books (seeded, so a render is reproducible). Non-inferior: the upper
 * end of the CER-difference interval under the margin (1 pp, Amendment 6). Optimum: the cheapest non-inferior cell
 * by cost per accepted page.
 *
 * PRIOR ART: live/rsm.ts (within-book WLS over the four-factor design: a surface model, not per-cell paired means; the
 * lead wants the measured cells, not a fit) and scripts/eval/read-surface-6740/analysis6.py (the a6 cell table, by a
 * mixed model in Python, not in the doc this page reads; its numbers differ from these in the second digit).
 */
import type { LiveDoc, LiveRow, LiveSetting } from './shape';

export const MARGIN_PP = 1;
export const PPC = [1, 4, 8] as const;
export const THINKS = ['low', 'medium', 'high'] as const;
export const LANG_NAME: Record<string, string> = { de: 'German', la: 'Latin', en: 'English' };

export type Iv = [number, number] | null;
export interface Cell {
  ppc: number; think: (typeof THINKS)[number]; setting: string | null; status: LiveSetting['status'] | 'absent';
  live: boolean; books: number;
  d_cer_pp: number | null; d_cer_iv: Iv;
  usd_1k_pages: number | null; yield: number | null; yield_iv: Iv;
  usd_1k_accepted: number | null; cpa_iv: Iv;
  saving: number | null; saving_iv: Iv;
  non_inferior: boolean | null; optimum: boolean;
}
export interface Lead { lang: string; books: number; settings_done: number; settings: number; cells: Cell[]; live: Cell | null; optimum: Cell | null }

/** mulberry32: a small seeded generator, so the bootstrap gives the same interval on every render. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const q = (xs: number[], p: number) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const isAccepted = (r: LiveRow) => (r.accepted === undefined ? r.cer !== null && !r.wrong_text && !r.loop && !r.cut : r.accepted);

/** Languages with a screen (stage "screen") that has at least one scored row. */
export function screenLangs(doc: LiveDoc): string[] {
  const ids = new Set(doc.design.settings.filter((s) => s.stage === 'screen').map((s) => `${s.lang}:${s.id}`));
  return [...new Set(doc.rows.filter((r) => ids.has(`${r.lang}:${r.setting_id}`)).map((r) => r.lang))]
    .sort((a, b) => ['de', 'la', 'en'].indexOf(a) - ['de', 'la', 'en'].indexOf(b));
}

interface BookCell { cer: number | null; cost: number; acc: number }

export function buildLead(doc: LiveDoc, lang: string, opts: { B?: number; seed?: number } = {}): Lead {
  const B = opts.B ?? 1000;
  const settings = doc.design.settings.filter((s) => s.stage === 'screen' && (s.lang ?? lang) === lang);
  // Cell index: thinking row-major, pages a call across (0 = 1 low … 8 = 8 high). A setting off the 3 × 3 is ignored.
  const ci = (s: { pages_a_call: number; thinking: string }) => {
    const a = PPC.indexOf(s.pages_a_call as (typeof PPC)[number]), t = THINKS.indexOf(s.thinking as (typeof THINKS)[number]);
    return a < 0 || t < 0 ? -1 : 3 * t + a;
  };
  const byId = new Map(settings.map((s) => [s.id, s]));
  const liveS = settings.find((s) => s.live) ?? settings.find((s) => s.pages_a_call === 4 && s.thinking === 'low');
  const LI = liveS ? ci(liveS) : 1;
  const W = doc.weights?.[lang];
  const wOf = (b: string) => (W && W[b] !== undefined ? W[b] : 1);

  // book → cell → its mean row (a setting read twice for a book averages).
  const acc = new Map<string, ({ cer: number[]; cost: number; accN: number; n: number } | null)[]>();
  for (const r of doc.rows) {
    if (r.lang !== lang || r.excluded) continue;
    const s = byId.get(r.setting_id), k = s ? ci(s) : -1;
    if (k < 0) continue;
    const m = acc.get(r.book_id) ?? new Array(9).fill(null); acc.set(r.book_id, m);
    const c = (m[k] ??= { cer: [], cost: 0, accN: 0, n: 0 });
    if (r.cer !== null) c.cer.push(r.cer);
    c.cost += r.quota_cost; c.accN += isAccepted(r) ? 1 : 0; c.n++;
  }
  const books = [...acc.keys()].sort();
  const table = books.map((b) => ({
    w: wOf(b),
    m: acc.get(b)!.map((c): BookCell | null => (c ? { cer: c.cer.length ? c.cer.reduce((a, x) => a + x, 0) / c.cer.length : null, cost: c.cost / c.n, acc: c.accN / c.n } : null)),
  }));

  type Est = { d: number | null; cost: number | null; y: number | null; cpa: number | null; n: number };
  const NONE: Est = { d: null, cost: null, y: null, cpa: null, n: 0 };
  const estimate = (idx: number[]): Est[] => {
    let lw = 0, lc = 0, ly = 0, ln = 0;
    for (const i of idx) { const L = table[i].m[LI]; if (L) { ln++; lw += table[i].w; lc += table[i].w * L.cost; ly += table[i].w * L.acc; } }
    const costL = lw ? lc / lw : null, yL = lw ? ly / lw : null;
    const out: Est[] = [];
    for (let k = 0; k < 9; k++) {
      if (k === LI) { out.push({ d: costL === null ? null : 0, cost: costL, y: yL, cpa: costL !== null && yL ? costL / yL : null, n: ln }); continue; }
      let sw = 0, sc = 0, scL = 0, sa = 0, dw = 0, dd = 0, n = 0;
      for (const i of idx) {
        const { w, m } = table[i]; const C = m[k], L = m[LI];
        if (!C || !L) continue;
        n++; sw += w; sc += w * C.cost; scL += w * L.cost; sa += w * (C.acc - L.acc);
        if (C.cer !== null && L.cer !== null) { dw += w; dd += w * (C.cer - L.cer); }
      }
      if (!sw || costL === null || yL === null || !scL) { out.push({ ...NONE, n }); continue; }
      // A share: the additive estimate can step past 1 when live misses pages the cell reads; it is capped there.
      const cost = costL * (sc / scL), y = Math.min(1, yL + sa / sw);
      out.push({ d: dw ? dd / dw : null, cost, y, cpa: cost / Math.max(0.01, y), n });
    }
    return out;
  };

  const all = table.map((_, i) => i);
  const point = estimate(all);
  const draws: Est[][] = [];
  const rand = rng(opts.seed ?? 6740);
  for (let b = 0; b < B && table.length; b++) draws.push(estimate(all.map(() => Math.floor(rand() * table.length))));
  const iv = (k: number, f: (e: Est, live: Est) => number | null): Iv => {
    const xs = draws.map((d) => f(d[k], d[LI])).filter((v): v is number => v !== null && Number.isFinite(v));
    return xs.length >= 20 ? [q(xs, 0.025), q(xs, 0.975)] : null;
  };
  const sav = (e: Est, L: Est) => (e.cpa !== null && L.cpa ? 1 - e.cpa / L.cpa : null);

  const cells: Cell[] = [];
  for (const th of THINKS) for (const p of PPC) {
    const k = ci({ pages_a_call: p, thinking: th }), e = point[k], L = point[LI], live = k === LI;
    const s = settings.find((x) => ci(x) === k);
    const dIv = live ? null : iv(k, (x) => (x.d === null ? null : 100 * x.d));
    cells.push({
      ppc: p, think: th, setting: s?.id ?? null, status: s?.status ?? 'absent', live, books: e.n,
      d_cer_pp: e.d === null ? null : 100 * e.d, d_cer_iv: dIv,
      usd_1k_pages: e.cost === null ? null : 1000 * e.cost,
      yield: e.y, yield_iv: live ? null : iv(k, (x) => x.y),
      usd_1k_accepted: e.cpa === null ? null : 1000 * e.cpa, cpa_iv: live ? null : iv(k, (x) => (x.cpa === null ? null : 1000 * x.cpa)),
      saving: live ? 0 : sav(e, L), saving_iv: live ? null : iv(k, sav),
      non_inferior: live ? true : dIv ? dIv[1] < MARGIN_PP : null, optimum: false,
    });
  }
  const ok = cells.filter((c) => c.non_inferior && c.usd_1k_accepted !== null);
  const opt = ok.length ? ok.reduce((a, c) => (c.usd_1k_accepted! < a.usd_1k_accepted! ? c : a)) : null;
  if (opt) opt.optimum = true;
  return {
    lang, books: table.length, settings_done: settings.filter((s) => s.status === 'done').length, settings: settings.length,
    cells, live: cells.find((c) => c.live) ?? null, optimum: opt,
  };
}

const pc = (v: number) => Math.round(100 * v);
const thinkName = (c: Cell) => `${c.ppc} page${c.ppc === 1 ? '' : 's'} a call at ${c.think} thinking`;

/** The one measured sentence for a language, from the cells. */
export function sentence(L: Lead): string {
  const name = LANG_NAME[L.lang] ?? L.lang;
  const head = `${name}, ${L.books} books`;
  const measured = L.cells.filter((c) => !c.live && c.d_cer_iv);
  const running = L.settings_done < L.settings ? ` (screen still running: ${L.settings_done} of ${L.settings} settings done)` : '';
  if (!L.live || measured.length === 0) return `${head}: no setting has been compared with live yet${running}.`;
  const worse = measured.filter((c) => !c.non_inferior);
  const widest = Math.max(...measured.map((c) => Math.abs(c.d_cer_pp ?? 0)));
  const acc = worse.length
    ? `${worse.length} of ${measured.length} settings may lose more than ${MARGIN_PP} pp of accuracy`
    : `no setting changes accuracy (every CER difference within ${widest.toFixed(2)} pp of live, against a ${MARGIN_PP} pp margin)`;
  const o = L.optimum;
  let cost: string;
  if (!o || o.live) cost = 'live is already the cheapest setting that keeps accuracy';
  else {
    const s = o.saving!, si = o.saving_iv;
    const verb = s >= 0 ? `costs ${pc(s)} % less` : `costs ${pc(-s)} % more`;
    cost = `${thinkName(o)} ${verb} per accepted page than live${si ? ` [${pc(si[0])}, ${pc(si[1])}]` : ''}${si && si[0] <= 0 ? ', not clearly cheaper' : ''}`;
  }
  return `${head}: ${acc}; ${cost}${running}.`;
}

// ── the confirmation run on fresh queue pages: an OPTIONAL doc field, asserted when present ──
export interface Confirmation { route: string; queue_pages: number; n: number; accepted: number; wrong_text: number; usd_1k_accepted: number; passes: boolean; why: string }
export type ConfirmationRead = { state: 'absent' } | { state: 'ok'; c: Confirmation } | { state: 'bad'; problems: string[] };

export function readConfirmation(doc: unknown, lang: string): ConfirmationRead {
  const all = (doc as { confirmation?: unknown } | null)?.confirmation;
  if (all === undefined || all === null) return { state: 'absent' };
  const c = (all as Record<string, unknown>)[lang] as Record<string, unknown> | undefined;
  if (c === undefined) return { state: 'absent' };
  const p: string[] = [];
  if (typeof c !== 'object' || c === null) return { state: 'bad', problems: [`confirmation.${lang}: not an object`] };
  for (const k of ['route', 'why']) if (typeof c[k] !== 'string') p.push(`confirmation.${lang}.${k}: not a string`);
  for (const k of ['queue_pages', 'n', 'accepted', 'wrong_text', 'usd_1k_accepted']) if (typeof c[k] !== 'number' || !Number.isFinite(c[k])) p.push(`confirmation.${lang}.${k}: not a number`);
  if (typeof c.passes !== 'boolean') p.push(`confirmation.${lang}.passes: not true/false`);
  return p.length ? { state: 'bad', problems: p } : { state: 'ok', c: c as unknown as Confirmation };
}

// ── shared by the 3D surface and the grid ──
/** Diverging colour for a CER difference in pp, fixed to ±MARGIN_PP: teal is better than live, red worse, grey equal. */
export function cerColour(dpp: number | null): [number, number, number] {
  if (dpp === null || !Number.isFinite(dpp)) return [0.43, 0.46, 0.51];
  const t = Math.max(-1, Math.min(1, dpp / MARGIN_PP));
  const mid = [0.43, 0.46, 0.51], neg = [0.18, 0.83, 0.75], pos = [0.97, 0.32, 0.29];   // #6e7681, #2dd4bf, #f85149
  const end = t < 0 ? neg : pos, a = Math.abs(t);
  return [0, 1, 2].map((i) => mid[i] + (end[i] - mid[i]) * a) as [number, number, number];
}
export const hex = (c: [number, number, number]) => `#${c.map((v) => Math.round(255 * v).toString(16).padStart(2, '0')).join('')}`;
export const fmtPp = (v: number | null, d = 2) => (v === null ? '–' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)} pp`);
export const fmtUsd = (v: number | null) => (v === null ? '–' : `$${v < 10 ? v.toFixed(2) : v.toFixed(1)}`);
