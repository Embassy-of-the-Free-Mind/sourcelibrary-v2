import type { ReactNode } from 'react';
import pareto from '@/data/ocr-pareto.json';
import xlate from '@/data/translation-pareto.json';
import ParetoDownload from './ParetoDownload';

// Cost against quality, one section per script (OCR) or per language (translation) (#5983, rebuilt in #6386,
// laid out around the decision in #6524). Server-rendered; the only client code is the download button.
// Every number, verdict and grade comes from src/data/ocr-pareto.json (scripts/eval/build-ocr-pareto.mjs) or
// src/data/translation-pareto.json (scripts/eval/build-translation-pareto.mjs): the renderer composes no claim.
//
// Three things are drawn from the same panels:
//   ParetoSummary       one row per script or language: engine in use, best clear switch, gain, cost, grade.
//                       summaryRow() repeats the choice verdictSentence() makes in scripts/eval/lib/pareto-stats.mjs
//                       (the engine marked `better` with the largest paired difference), so a row and its section's
//                       verdict sentence always name the same engine and the same figures (pinned by a unit test).
//   ParetoPresentation  one section per script or language whose primary panel is fit to read: the verdict sentence,
//                       then a forest plot of each engine's paired difference from the engine in use, sorted, with
//                       its 95% interval and its price as text. The full table and every other run sit in disclosures.
//   NotMeasured         every script or language whose primary panel is not fit to rank, as one list with the reason.
// The plot's x axis is a difference, so zero is the engine in use on every chart. A few far-worse engines may run
// off the left edge (an arrow marks them); their figures are always printed in the row.
// Colour follows the engine's role, never its rank: amber for the engine in use, teal for an engine the data file
// marks better, stone for everything else. Colours are hex rather than var(--…) because the download serialises
// the SVG outside the page's CSS; each one is a Tailwind token the page already uses (named beside it).

const BETTER = '#0b9488'; // teal-600
const PRODUCTION = '#b45309'; // amber-700
const INK = '#44403c'; // stone-700
const MUTED = '#57534e'; // stone-600
const FAINT = '#a8a29e'; // stone-400
const GRID = '#e7e5e4'; // stone-200
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
const GH = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/';

type Cost = { usd_per_1k: number; basis: 'billed' | 'quota'; detail: string; source: string };
type Vs = { diff: number; ci95: number[] | null; n_pages: number; n_works: number };
type Verdict = 'better' | 'same' | 'worse';
/** One engine on one figure, in the measure-neutral shape the renderer draws. */
type Point = {
  engine: string; label: string; production: boolean; y: number; y_ci95: number[] | null;
  cost: Cost | null; no_price: string | null; on_frontier: boolean;
  vs: Vs | null; verdict: Verdict | null;
  /** the measure's extra table cells (pages over half wrong; words not in the reference; reversals) */
  extra: (string | null)[];
  /** position in the data file (placed, then no_cost): the tie-break the verdict sentence uses */
  order: number;
};
type Noise = { kind: 'spread' | 'identical' | 'not_reproduced' | 'unlike'; band: number | null; diff?: number; why?: string | null; n?: number };
type Grade = { level: 'decide' | 'directional' | 'not_fit'; why: string };
type Panel = {
  kind: string; role: string; heading: string | null; n_pages: number; n_works: number; reference: string;
  grade: Grade; frontier: boolean; noise: Noise | null; date: string | null; verdict: string;
  notes: string[]; points: Point[]; extraHeads: { head: string; title: string }[];
};
export type Chart = { id: string; title: string; production_label: string; caption: string | null; storedNow: string | null; mentions: string[]; panels: Panel[] };
type NoChartRow = { title: string; why: string; source: string };

/** Everything that differs between the OCR and the translation figures. No figures in here either. */
export type Measure = {
  key: 'ocr' | 'translation';
  anchor: string;
  title: (c: Chart) => string;
  exportTitle: (c: Chart) => string;
  /** what the plot's axis measures, after "Difference from the engine in use in " */
  yAxis: string;
  fmtY: (v: number | null | undefined) => string;
  fmtDiff: (d: number) => string;
  /** the unit a difference is in, after the number */
  diffUnit: string;
  /** the summary table's gain column */
  gainHead: string;
  yColumn: string;
  charts: Chart[];
  noChart: NoChartRow[];
  gradeRules: Record<Grade['level'], string>;
};

const pctOf = (x: number | null | undefined, d = 1) => (x == null ? '–' : `${(x * 100).toFixed(d)}%`);
const signed = (s: string, d: number) => `${d >= 0 ? '+' : '−'}${s}`;
const usd = (x: number) => `$${x < 0.1 ? x.toFixed(3) : x.toFixed(2)}`;

// ── adapters: each data file to the renderer's shape ─────────────────────────────────────────
type RawCost = { usd_per_1k: number; basis: string; detail: string; source: string } | null;
type OcrPoint = {
  engine: string; label: string; production: boolean; accuracy: number; accuracy_ci95: number[] | null; fail_share: number;
  words_not_in_ref: number | null; cost: RawCost; no_price?: string; on_frontier?: boolean; vs_in_use?: Vs | null; verdict?: Verdict;
  did_not_read: { k: number; n: number; kinds: Record<string, number> }; partly_measured?: string;
};
// #6523: a failed read is counted, not scored
const KIND_WORDS: Record<string, string> = { copy_filter: 'copy filter', refusal: 'refused', empty: 'empty', timeout: 'timed out', other: 'no transcription' };
const didNotRead = (x: OcrPoint) => (x.did_not_read.k === 0 ? '0'
  : `${x.did_not_read.k} of ${x.did_not_read.n} (${Object.entries(x.did_not_read.kinds).map(([k, n]) => `${KIND_WORDS[k] ?? k} ${n}`).join(', ')})${x.partly_measured ? ', partly measured' : ''}`);
type RawPanel<P> = {
  kind: string; role?: string; heading: string | null; n_pages: number; n_works: number; reference: string; grade: Grade;
  frontier: boolean; noise: Noise | null; date: string | null; verdict: string; notes?: string[]; placed: P[]; no_cost: P[];
};
type RawChart<P> = { id: string; title: string; production_label: string; caption?: string | null; stored_now?: string | null; mentions?: string[]; panels: RawPanel<P>[] };

const base = <P,>(p: RawPanel<P>, i: number) => ({
  kind: p.kind, role: p.role ?? (i === 0 ? 'primary' : 'secondary'), heading: p.heading, n_pages: p.n_pages, n_works: p.n_works,
  reference: p.reference, grade: p.grade, frontier: p.frontier, noise: p.noise, date: p.date, verdict: p.verdict, notes: p.notes ?? [],
});
const common = (x: { engine: string; label: string; production: boolean; cost: RawCost; no_price?: string; on_frontier?: boolean; vs_in_use?: Vs | null; verdict?: Verdict }) => ({
  engine: x.engine, label: x.label, production: x.production, cost: x.cost as Cost | null, no_price: x.no_price ?? null,
  on_frontier: !!x.on_frontier, vs: x.vs_in_use ?? null, verdict: x.verdict ?? null,
});
export function ocrPanel(p: RawPanel<OcrPoint>, i = 0): Panel {
  const all = [...p.placed, ...p.no_cost];
  const words = all.some(x => x.words_not_in_ref != null);
  return {
    ...base(p, i),
    extraHeads: [
      { head: 'over half wrong', title: 'share of the pages it read with a character error rate above one half' },
      ...(words ? [{ head: 'words not in ref.', title: "median share of the engine's words found nowhere in the reference; a misspelling counts too" }] : []),
      { head: 'did not read', title: 'pages the engine refused, left empty, ran out of time on, or declined to copy because it recognised a published text; not scored. Above one page in five, its accuracy is partly measured: it rests on the pages it chose to answer' },
    ],
    points: all.map((x, order) => ({ ...common(x), order, y: x.accuracy, y_ci95: x.accuracy_ci95, extra: [pctOf(x.fail_share, 0), ...(words ? [pctOf(x.words_not_in_ref, 0)] : []), didNotRead(x)] }))
      .sort((a, b) => b.y - a.y || a.engine.localeCompare(b.engine)),
  };
}
type XPoint = {
  engine: string; label: string; production: boolean; fidelity: number; fidelity_ci95: number[] | null;
  reversals: { per_100: number }; cost: RawCost; no_price?: string; on_frontier?: boolean; vs_in_use?: Vs; verdict?: Verdict;
};
export function translationPanel(p: RawPanel<XPoint>, i = 0): Panel {
  return {
    ...base(p, i),
    extraHeads: [{ head: 'reversed per 100 pages', title: 'pages where either judge quoted a statement the English reverses, per 100 pages' }],
    points: [...p.placed, ...p.no_cost].map((x, order) => ({ ...common(x), order, y: x.fidelity, y_ci95: x.fidelity_ci95, extra: [x.reversals.per_100.toFixed(1)] }))
      .sort((a, b) => b.y - a.y || a.engine.localeCompare(b.engine)),
  };
}
const adapt = <P,>(c: RawChart<P>, f: (p: RawPanel<P>, i: number) => Panel): Chart => ({
  id: c.id, title: c.title, production_label: c.production_label, caption: c.caption ?? null, storedNow: c.stored_now ?? null, mentions: c.mentions ?? [], panels: c.panels.map(f),
});

type Data<P> = { charts: RawChart<P>[]; no_chart: NoChartRow[]; grade_rules: Record<Grade['level'], string> };
const ocrData = pareto as unknown as Data<OcrPoint>;
const xData = xlate as unknown as Data<XPoint>;

export const OCR: Measure = {
  key: 'ocr', anchor: 'pareto-',
  title: c => c.title,
  exportTitle: c => `${c.title}: what it costs to read, against how well it reads`,
  yAxis: 'accuracy against a typed text, in points a page',
  fmtY: v => pctOf(v),
  fmtDiff: d => signed(Math.abs(d * 100).toFixed(1), d), diffUnit: 'points', gainHead: 'Gain, points a page',
  yColumn: 'mean accuracy',
  charts: ocrData.charts.map(c => adapt(c, ocrPanel)),
  noChart: ocrData.no_chart,
  gradeRules: ocrData.grade_rules,
};

export const TRANSLATION: Measure = {
  key: 'translation', anchor: 'pareto-translation-',
  title: c => `${c.title} into English`,
  exportTitle: c => `${c.title} into English: translation cost against fidelity`,
  yAxis: 'fidelity to a published translation, on the 1 to 5 scale (model-judged)',
  fmtY: v => (v == null ? '–' : v.toFixed(2)),
  fmtDiff: d => signed(Math.abs(d).toFixed(2), d), diffUnit: 'on the 1 to 5 scale', gainHead: 'Gain a page, on the 1 to 5 scale',
  yColumn: 'mean fidelity',
  charts: xData.charts.map(c => adapt(c, translationPanel)),
  noChart: xData.no_chart,
  gradeRules: xData.grade_rules,
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const GRADE_LABEL: Record<Grade['level'], string> = { decide: 'Decide', directional: 'Directional', not_fit: 'Not fit to rank' };
const GRADE_COLOR: Record<Grade['level'], string> = { decide: BETTER, directional: PRODUCTION, not_fit: MUTED };

/** "44 works · 44 pages · Wikisource transcriptions": always beside the verdict. */
const sample = (p: Panel) => `${plural(p.n_works, 'work')} · ${plural(p.n_pages, 'page')} · ${p.reference}`;
const ciText = (m: Measure, ci: number[] | null) => (ci ? `${m.fmtDiff(ci[0])} to ${m.fmtDiff(ci[1])}` : 'no interval');

const SUBSCRIPTION = '$0 via subscription';
const priceText = (p: Point) => (p.cost ? (p.cost.basis === 'quota' ? SUBSCRIPTION : usd(p.cost.usd_per_1k)) : 'no price');
const costText = (p: Point) => (p.cost ? (p.cost.basis === 'quota' ? SUBSCRIPTION : `${usd(p.cost.usd_per_1k)} per 1,000 pages`) : `no price: ${p.no_price}`);
const anchorOf = (m: Measure, chart: Chart, panel?: Panel) =>
  `${m.anchor}${chart.id}${panel && chart.panels.indexOf(panel) > 0 ? `-${panel.kind}` : ''}`;
const svgId = (m: Measure, chart: Chart, panel: Panel) => `${m.anchor}svg-${chart.id}-${panel.kind}`;

// ── the summary: one row per script or language ──────────────────────────────
/** One row of the summary table, read off a chart's primary panel. */
export type SummaryRow = {
  id: string; title: string; anchor: string; grade: Grade; inUse: string;
  /** switch: a Decide panel names a better engine. toward: a Directional one points at one. none: nothing stands out.
   *  withheld: two runs of the engine in use disagreed. not_fit: the panel is not fit to rank. */
  state: 'switch' | 'toward' | 'none' | 'withheld' | 'not_fit';
  best: string | null; gain: string | null; interval: string | null;
  /** "13×" where both prices are billed; `cost` is the price beside it, or the reason there is none */
  multiple: string | null; cost: string | null;
  /** the other engines marked better, in the verdict sentence's order, each with its cost the same way */
  also: { label: string; cost: string }[];
};

/** The engines the data file marks better than the engine in use, largest paired difference first: the same
 *  choice, with the same tie-break, as verdictSentence() in scripts/eval/lib/pareto-stats.mjs. */
const betterOf = (p: Panel) => p.points.filter(x => x.verdict === 'better' && x.vs).sort((a, b) => b.vs!.diff - a.vs!.diff || a.order - b.order);

export function summaryRow(chart: Chart, m: Measure): SummaryRow {
  const p = chart.panels[0];
  const prod = p.points.find(x => x.production);
  const row: SummaryRow = {
    id: chart.id, title: m.title(chart), anchor: anchorOf(m, chart), grade: p.grade, inUse: chart.production_label,
    state: 'none', best: null, gain: null, interval: null, multiple: null, cost: null, also: [],
  };
  if (p.grade.level === 'not_fit' || !prod) return { ...row, state: 'not_fit' };
  row.inUse = prod.label;
  if (p.noise?.kind === 'not_reproduced') return { ...row, state: 'withheld' };
  const [b, ...rest] = betterOf(p);
  if (!b) return row;
  const multiple = (x: Point) => (x.cost?.basis === 'billed' && prod.cost?.basis === 'billed'
    ? `${(r => (r >= 10 ? r.toFixed(0) : r.toFixed(1)))(x.cost.usd_per_1k / prod.cost.usd_per_1k)}×` : null);
  return {
    ...row, state: p.grade.level === 'decide' ? 'switch' : 'toward', best: b.label,
    gain: m.fmtDiff(b.vs!.diff), interval: b.vs!.ci95 ? ciText(m, b.vs!.ci95) : null,
    multiple: multiple(b),
    cost: multiple(b) ? `${usd(b.cost!.usd_per_1k)} against ${usd(prod.cost!.usd_per_1k)} per 1,000 pages` : costText(b),
    also: p.grade.level === 'decide' ? rest.map(x => ({ label: x.label, cost: multiple(x) ?? priceText(x) })) : [],
  };
}

const fit = (c: Chart) => c.panels[0].grade.level !== 'not_fit';

function GradeLabel({ g }: { g: Grade }) {
  return <span className="uppercase tracking-wider text-[0.75rem] font-semibold whitespace-nowrap" style={{ color: GRADE_COLOR[g.level] }} title={g.why}>{GRADE_LABEL[g.level]}</span>;
}

/** The table at the top of /quality/pareto. A table from the sm breakpoint up; on a phone each row stacks,
 *  with the column name written before each value. */
export function ParetoSummary({ m = OCR }: { m?: Measure }) {
  const rows = [...m.charts.filter(fit), ...m.charts.filter(c => !fit(c))].map(c => summaryRow(c, m));
  const th = 'font-normal py-2 pr-4';
  const td = 'block sm:table-cell sm:py-2 sm:pr-4';
  const lab = (s: string) => <span className="sm:hidden text-stone-600">{s}: </span>;
  return (
    <table className="w-full text-base block sm:table">
      <thead className="hidden sm:table-header-group">
        <tr className="text-left text-sm text-stone-600 border-b border-stone-300 align-bottom">
          <th className={th}>{m.key === 'ocr' ? 'Script' : 'Language'}</th>
          <th className={th}>Engine in use</th>
          <th className={th}>Best clear switch</th>
          <th className={th}>{m.gainHead} (95% interval)</th>
          <th className={th}>Cost against the engine in use</th>
          <th className="font-normal py-2">Grade</th>
        </tr>
      </thead>
      <tbody className="block sm:table-row-group">
        {rows.map(r => (
          <tr key={r.id} className="block sm:table-row py-3 sm:py-0 border-b border-stone-200 align-top">
            <th scope="row" className={`${td} text-left font-normal`}>
              <a href={`#${r.anchor}`} className="font-serif text-lg text-stone-900 hover:text-amber-800">{r.title}</a>
              <span className="sm:hidden ml-2"><GradeLabel g={r.grade} /></span>
            </th>
            <td className={`${td} text-stone-700`}>{lab('In use')}{r.inUse}</td>
            {r.state === 'not_fit' || r.state === 'withheld' ? (
              <td colSpan={3} className={`${td} text-stone-600`}>
                {r.state === 'withheld' ? 'Verdict withheld: two runs of the engine in use disagreed.' : `Not measured well enough yet: ${r.grade.why}.`}
              </td>
            ) : r.state === 'none' ? (
              <>
                <td className={`${td} text-stone-700`}>{lab('Best clear switch')}None</td>
                <td className="hidden sm:table-cell sm:py-2 sm:pr-4 text-stone-600">{'–'}</td>
                <td className="hidden sm:table-cell sm:py-2 sm:pr-4 text-stone-600">{'–'}</td>
              </>
            ) : (
              <>
                <td className={td}>
                  {lab(r.state === 'switch' ? 'Best clear switch' : 'Points toward')}
                  <span className="text-stone-900 font-semibold">{r.best}</span>
                  {r.state === 'toward' && <span className="hidden sm:block text-sm text-stone-600">points toward; directional only</span>}
                  {r.also.length > 0 && <span className="block text-sm text-stone-600">Also better: {r.also.map(a => `${a.label} (${a.cost})`).join(', ')}</span>}
                </td>
                <td className={`${td} tabular-nums`}>
                  {lab('Gain')}
                  <span className="text-stone-900 font-semibold">{r.gain}</span>
                  <span className="sm:hidden text-stone-900"> {m.diffUnit}</span>
                  {r.interval && <span className="text-stone-600 whitespace-nowrap"> ({r.interval})</span>}
                </td>
                <td className={`${td} tabular-nums`}>
                  {lab('Cost')}
                  {r.multiple && <span className="text-stone-900 font-semibold">{r.multiple} </span>}
                  <span className={r.multiple ? 'sm:block text-sm text-stone-600' : 'text-stone-700'}>{r.cost}</span>
                </td>
              </>
            )}
            <td className="hidden sm:table-cell sm:py-2"><GradeLabel g={r.grade} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── the forest plot ──────────────────────────────────────────────────────────
// Font sizes are in viewBox units, and each plot is drawn at close to 1:1, so f is the type size in CSS pixels.
type Row = { p: Point; diff: number; ci: number[] | null };

/** Engines sorted by their paired difference from the engine in use, which sits at zero. An engine with no
 *  paired difference (it shared no page with the engine in use) is left to the table. */
const forestRows = (panel: Panel): Row[] => panel.points
  .filter(p => p.production || p.vs)
  .map(p => ({ p, diff: p.vs?.diff ?? 0, ci: p.vs?.ci95 ?? null }))
  .sort((a, b) => b.diff - a.diff || Number(b.p.production) - Number(a.p.production) || a.p.order - b.p.order);

/** The x range and its ticks. The range always holds zero, the noise band and every engine's upper end. On the low
 *  side, take the range without the few lowest engines (at most a third, at most five): one of those is cut off only
 *  where it lies more than twice that range below it. Otherwise one failed engine would squeeze every other row into
 *  a line beside zero. `maxTicks` is how many tick labels fit side by side. */
function forestScale(rows: Row[], band: number, maxTicks = 5) {
  const hi = Math.max(0, band, ...rows.flatMap(r => [r.diff, ...(r.ci ?? [])]));
  const lows = rows.map(r => Math.min(r.diff, ...(r.ci ?? []))).sort((a, b) => a - b);
  const coreLo = Math.min(0, -band, ...lows.slice(Math.min(5, Math.floor(rows.length / 3))));
  const floor = coreLo - 2 * (hi - coreLo);
  const lo = Math.min(coreLo, ...lows.filter(v => v >= floor));
  const cut = lows.some(v => v < floor);
  const span = hi - lo || 1;
  let ticks: number[] = [];
  for (let pow = 10 ** Math.floor(Math.log10(span / maxTicks)), k = 0; ; k++) {
    const step = pow * [1, 2, 5][k % 3] * 10 ** Math.floor(k / 3);
    ticks = [];
    for (let i = Math.ceil(lo / step); i * step <= hi + step * 1e-6; i++) ticks.push(i * step);
    if (ticks.length <= maxTicks) break;
  }
  return { lo: lo - span * 0.04, hi: hi + span * 0.04, cut, ticks };
}

/** The plot. Wide: one line per engine (name, mark, difference, price). Stacked, for a phone: two lines per engine
 *  (name and price, then mark and difference). No label is placed by the data, so none can overlap. */
function forest(panel: Panel, m: Measure, W: number, f: number, stacked: boolean): { H: number; body: ReactNode } {
  const rows = forestRows(panel);
  const band = panel.noise?.kind === 'spread' && panel.noise.band ? panel.noise.band : 0;
  const fs = f * 0.92, r = Math.max(3.5, f * 0.3), gap = f * 0.9;
  const diffW = f * 13.2, priceW = f * 11.2;
  const x0 = stacked ? r + 2 : f * 17.7 + gap;
  const x1 = stacked ? W - diffW - gap : W - priceW - diffW - gap * 2;
  const { lo, hi, ticks } = forestScale(rows, band, Math.floor((x1 - x0) / (fs * 4.2)));
  const sx = (v: number) => x0 + ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * (x1 - x0);
  const head = f * 2.3, rh = stacked ? f * 3.4 : f * 2;
  const H = Math.ceil(head + rows.length * rh + 2);
  const decide = panel.grade.level === 'decide';
  const body = (
    <g fontFamily={FONT}>
      {!stacked && <text x={0} y={f} fontSize={fs} fill={MUTED}>engine</text>}
      {!stacked && <text x={x1 + gap} y={f} fontSize={fs} fill={MUTED}>difference (95% interval)</text>}
      {!stacked && <text x={W} y={f} textAnchor="end" fontSize={fs} fill={MUTED}>per 1,000 pages</text>}
      {ticks.map(t => <text key={t} x={sx(t)} y={stacked ? f * 1.5 : f} textAnchor="middle" fontSize={fs} fill={MUTED}>{t === 0 ? '0' : m.fmtDiff(t)}</text>)}
      <line x1={0} x2={W} y1={head - f * 0.5} y2={head - f * 0.5} stroke={GRID} strokeWidth={1} />
      {rows.map(({ p, diff, ci }, i) => {
        const top = head + i * rh;
        const cy = stacked ? top + f * 2.35 : top + rh / 2;
        const y0 = stacked ? top + f * 1.5 : top, y1 = stacked ? top + f * 3.2 : top + rh;
        const c = p.production ? PRODUCTION : p.verdict === 'better' ? BETTER : INK;
        const strong = p.production || p.verdict === 'better';
        const off = Math.min(diff, ...(ci ?? [])) < lo;
        const diffText = p.production ? 'in use' : `${m.fmtDiff(diff)}${ci ? ` (${ciText(m, ci)})` : ''}`;
        return (
          <g key={p.engine}>
            {band > 0 && <rect x={sx(-band)} width={sx(band) - sx(-band)} y={y0} height={y1 - y0} fill={GRID} opacity={0.7} />}
            {ticks.map(t => <line key={t} x1={sx(t)} x2={sx(t)} y1={y0} y2={y1} stroke={t === 0 ? FAINT : GRID} strokeWidth={1} />)}
            {ci && ci[1] > lo && (
              <g stroke={c} strokeWidth={1.5}>
                <line x1={sx(ci[0])} x2={sx(ci[1])} y1={cy} y2={cy} />
                {ci[0] >= lo && <line x1={sx(ci[0])} x2={sx(ci[0])} y1={cy - 3} y2={cy + 3} />}
                <line x1={sx(ci[1])} x2={sx(ci[1])} y1={cy - 3} y2={cy + 3} />
              </g>
            )}
            {off && <path d={`M${x0 - r - 2} ${cy} l${r * 1.6} ${-r} v${r * 2} z`} fill={c} />}
            {diff >= lo && <circle cx={sx(diff)} cy={cy} r={r} fill={c} />}
            <text x={0} y={stacked ? top + f * 1.05 : cy} dy={stacked ? undefined : '0.34em'} fontSize={f} fontWeight={strong ? 600 : 400} fill={p.production ? PRODUCTION : INK}>{p.label}</text>
            <text x={stacked ? W : x1 + gap} y={cy} dy="0.34em" textAnchor={stacked ? 'end' : 'start'} fontSize={fs}
              fontWeight={decide && (p.verdict === 'better' || p.verdict === 'worse') ? 600 : 400} fill={p.production ? PRODUCTION : INK}>{diffText}</text>
            <text x={W} y={stacked ? top + f * 1.05 : cy} dy={stacked ? undefined : '0.34em'} textAnchor="end" fontSize={fs} fill={MUTED}>{priceText(p)}</text>
          </g>
        );
      })}
    </g>
  );
  return { H, body };
}

/** What the plot's marks mean: only the marks this plot uses. */
function Key({ panel }: { panel: Panel }) {
  const rows = forestRows(panel);
  const band = panel.noise?.kind === 'spread' && !!panel.noise.band;
  const item = 'inline-flex items-center gap-1';
  const dot = (c: string) => <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill={c} /></svg>;
  return (
    <p className="text-sm text-stone-600 mt-2 flex flex-wrap gap-x-4 gap-y-1">
      <span className={item}>{dot(PRODUCTION)}in use</span>
      {rows.some(x => x.p.verdict === 'better') && <span className={item}>{dot(BETTER)}{panel.grade.level === 'decide' ? 'clearly better' : 'the evidence points toward it'}</span>}
      <span className={item}><svg width="18" height="10" aria-hidden="true"><g stroke={INK} strokeWidth="1.5"><line x1="1" x2="17" y1="5" y2="5" /><line x1="1" x2="1" y1="2" y2="8" /><line x1="17" x2="17" y1="2" y2="8" /></g></svg>95% interval</span>
      {band && <span className={item}><svg width="14" height="10" aria-hidden="true"><rect width="14" height="10" fill={GRID} /></svg>spread between two runs of the engine in use</span>}
      {forestScale(rows, band ? panel.noise!.band! : 0).cut && (
        <span className={item}><svg width="8" height="10" aria-hidden="true"><path d="M0 5 l7 -4 v8 z" fill={INK} /></svg>runs off the scale; its figures are in the row</span>
      )}
    </p>
  );
}

/** Greedy word wrap for SVG text, by character count. */
function wrap(s: string, n: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of s.split(' ')) {
    if (cur && (cur + ' ' + w).length > n) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

const axisText = (m: Measure) => `Difference from the engine in use in ${m.yAxis}, on the same pages.`;

/** A self-contained figure for a slide: title, verdict, grade and sample, then the plot. Hidden on the page. */
function ExportSvg({ chart, panel, m }: { chart: Chart; panel: Panel; m: Measure }) {
  const W = 1040, f = 15, pad = 32, chars = 110;
  const head = [
    { t: m.exportTitle(chart), size: f * 1.5, weight: 700, fill: '#1c1917' },
    ...(panel.heading ? [{ t: panel.heading, size: f, weight: 400, fill: MUTED }] : []),
    { t: `${GRADE_LABEL[panel.grade.level]}: ${panel.grade.why}. ${sample(panel)}.`, size: f * 0.9, weight: 400, fill: MUTED },
    ...wrap(panel.verdict, Math.round(chars * 0.9)).map(t => ({ t, size: f, weight: 600, fill: '#1c1917' })),
    { t: axisText(m), size: f * 0.9, weight: 400, fill: MUTED },
  ];
  let y = pad;
  const headEls = head.map((l, i) => { y += l.size * 1.35; return <text key={i} x={pad} y={y} fontSize={l.size} fontWeight={l.weight} fill={l.fill}>{l.t}</text>; });
  const plotY = y + f;
  const plot = forest(panel, m, W - 2 * pad, f, false);
  y = plotY + plot.H + f * 1.6;
  const H = Math.ceil(y + pad);
  return (
    <svg id={svgId(m, chart, panel)} xmlns="http://www.w3.org/2000/svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fontFamily={FONT}>
      <rect width={W} height={H} fill="#fff" />
      {headEls}
      <g transform={`translate(${pad} ${plotY})`}>{plot.body}</g>
      <text x={pad} y={y} fontSize={f * 0.85} fill={MUTED}>Source Library, sourcelibrary.org/quality/pareto#{anchorOf(m, chart, panel)}. Scored {panel.date ?? ''}.</text>
    </svg>
  );
}

function GradeBadge({ g }: { g: Grade }) {
  return (
    <span>
      <span className="uppercase tracking-wider text-[0.75rem] font-semibold whitespace-nowrap" style={{ color: GRADE_COLOR[g.level] }}>{GRADE_LABEL[g.level]}</span>
      <span className="text-stone-600">: {g.why}</span>
    </span>
  );
}

/** What the repeat run of the engine in use says about noise, in one sentence (or nothing when there was none). */
function noiseText(panel: Panel, m: Measure): string | null {
  const n = panel.noise;
  if (!n) return null;
  if (n.kind === 'spread') return `Noise band from a repeat run of the engine in use: ${m.fmtDiff(n.band!).slice(1)}.`;
  if (n.kind === 'identical') return `A repeat run of the engine in use scored the same on all ${n.n} pages.`;
  if (n.kind === 'not_reproduced') return `Repeat run of the engine in use: ${m.fmtDiff(n.diff!)} ${m.diffUnit}.`;
  return `Repeat run not used: ${n.why}.`;
}

function VsCell({ p, m, decide }: { p: Point; m: Measure; decide: boolean }) {
  if (p.production) return <span className="text-stone-600">in use</span>;
  if (!p.vs) return <span className="text-stone-600">{'–'}</span>;
  const strong = decide && (p.verdict === 'better' || p.verdict === 'worse');
  return (
    <span className={strong ? 'text-stone-900 font-semibold' : 'text-stone-700'}>
      {m.fmtDiff(p.vs.diff)}
      {p.vs.ci95 && <span className="text-stone-600 font-normal whitespace-nowrap"> ({m.fmtDiff(p.vs.ci95[0])} to {m.fmtDiff(p.vs.ci95[1])})</span>}
    </span>
  );
}

/** Every engine on the panel, sorted by score, with every figure the data file holds for it. */
function Table({ panel, m }: { panel: Panel; m: Measure }) {
  return (
    <div className="overflow-x-auto"><table className="w-full max-w-3xl tabular-nums text-sm">
      <thead>
        <tr className="text-left text-stone-600 border-b border-stone-200 align-bottom">
          <th className="font-normal py-1 pr-2">engine</th>
          <th className="font-normal py-1 pr-2 text-right">{m.yColumn}</th>
          {panel.extraHeads.map(h => <th key={h.head} className="font-normal py-1 pr-2 text-right" title={h.title}>{h.head}</th>)}
          <th className="font-normal py-1 pr-2 text-right" title="mean difference per page from the engine in use, on the same pages, with its 95% interval">vs in use</th>
          <th className="font-normal py-1 text-right">per 1,000 pages</th>
        </tr>
      </thead>
      <tbody>
        {panel.points.map(p => (
          <tr key={p.engine} className="border-b border-stone-100 align-top">
            <td className="py-1 pr-2" style={{ color: p.production ? PRODUCTION : undefined }}>{p.label}</td>
            <td className="py-1 pr-2 text-right text-stone-800">{m.fmtY(p.y)}</td>
            {p.extra.map((c, k) => <td key={k} className="py-1 pr-2 text-right text-stone-700">{c ?? '–'}</td>)}
            <td className="py-1 pr-2 text-right"><VsCell p={p} m={m} decide={panel.grade.level === 'decide'} /></td>
            <td className="py-1 text-right">
              {p.cost ? (
                <a href={`${GH}${p.cost.source}`} title={p.cost.detail} className="text-stone-800 hover:text-amber-800">
                  {p.cost.basis === 'quota' ? <>{SUBSCRIPTION} <span className="text-stone-600 whitespace-nowrap">({usd(p.cost.usd_per_1k)} at the API price)</span></> : usd(p.cost.usd_per_1k)}
                </a>
              ) : <span className="text-stone-600" title={p.no_price ?? undefined}>no price</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

/** One panel. Fit to read: verdict, plot, and the table under a disclosure. Not fit to rank: the table alone,
 *  because a plot of differences would read as a ranking the grade says the pages cannot support. */
function PanelView({ chart, panel, m, sub }: { chart: Chart; panel: Panel; m: Measure; sub?: boolean }) {
  const id = chart.panels.indexOf(panel) > 0 ? anchorOf(m, chart, panel) : undefined;
  const provenance = [noiseText(panel, m), ...panel.notes].filter(Boolean).join(' ');
  if (panel.grade.level === 'not_fit') {
    return (
      <div id={id} className="scroll-mt-24">
        {panel.heading && <div className="font-serif text-lg text-stone-900">{panel.heading}</div>}
        <p className="text-sm"><GradeBadge g={panel.grade} /></p>
        <p className="text-sm text-stone-600 mb-2">{sample(panel)}.{provenance && <> {provenance}</>}</p>
        <Table panel={panel} m={m} />
      </div>
    );
  }
  // Drawn twice at close to 1:1, so the type holds its size: a phone's column and a wider one.
  const sizes: [string, number, number, boolean][] = [['sm:hidden', 350, 12, true], ['hidden sm:block', 820, 13, false]];
  const label = `${m.title(chart)}: each engine's difference from the engine in use, for ${panel.points.length} engines. ${sample(panel)}. ${panel.verdict}`;
  return (
    <div id={id} className="scroll-mt-24">
      {panel.heading && <div className={`font-serif text-stone-900 ${sub ? 'text-lg' : 'text-base text-stone-600'}`}>{panel.heading}</div>}
      <p className={`text-stone-900 leading-snug mt-1 max-w-3xl ${sub ? 'text-base' : 'text-lg'}`}>{panel.verdict}</p>
      <p className="text-sm mt-1"><GradeBadge g={panel.grade} /></p>
      <p className="text-sm text-stone-600">{sample(panel)}.</p>
      <p className="text-sm text-stone-600 mt-4 max-w-3xl">{axisText(m)}</p>
      {sizes.map(([cls, W, f, stacked]) => {
        const plot = forest(panel, m, W, f, stacked);
        return (
          <svg key={cls} viewBox={`0 0 ${W} ${plot.H}`} className={`w-full h-auto mt-1 ${cls}`} style={{ maxWidth: W }} role="img" aria-label={label}>{plot.body}</svg>
        );
      })}
      <Key panel={panel} />
      <details className="mt-3">
        <summary className="cursor-pointer text-stone-700 hover:text-amber-800">Full table and notes</summary>
        <div className="mt-3 pl-4 border-l border-stone-200">
          <Table panel={panel} m={m} />
          {provenance && <p className="text-sm text-stone-600 mt-2 max-w-3xl">{provenance}</p>}
          <div className="text-sm text-stone-600 mt-2"><ParetoDownload svgId={svgId(m, chart, panel)} name={anchorOf(m, chart, panel)} /></div>
        </div>
      </details>
      <div hidden aria-hidden="true"><ExportSvg chart={chart} panel={panel} m={m} /></div>
    </div>
  );
}

/** Every panel after the primary one, under a closed disclosure. */
function OtherRuns({ chart, m, panels }: { chart: Chart; m: Measure; panels: Panel[] }) {
  if (!panels.length && !chart.mentions.length) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-stone-700 hover:text-amber-800">Other runs ({panels.length})</summary>
      <div className="mt-3 space-y-10 pl-4 border-l border-stone-200">
        <p className="text-sm text-stone-600 max-w-3xl">Each is its own page set or judging round: compare engines within a run, never across runs. {chart.mentions.join(' ')}</p>
        {panels.map(p => <PanelView key={p.kind} chart={chart} panel={p} m={m} sub />)}
      </div>
    </details>
  );
}

/** One script or language: its primary panel, then every other run under a closed disclosure. */
function Figure({ chart, m }: { chart: Chart; m: Measure }) {
  const [primary, ...rest] = chart.panels;
  return (
    <figure id={anchorOf(m, chart)} className="py-10 border-b border-stone-200 scroll-mt-16 min-w-0">
      <div className="font-serif text-2xl md:text-3xl text-stone-900">
        {m.title(chart)}
        <a href={`#${anchorOf(m, chart)}`} className="ml-2 font-sans text-sm text-stone-400 hover:text-amber-800 no-underline" aria-label={`Link to the ${m.title(chart)} section`}>#</a>
      </div>
      <PanelView chart={chart} panel={primary} m={m} />
      {chart.caption && <figcaption className="text-sm text-stone-600 mt-3 max-w-3xl">{chart.caption}</figcaption>}
      <OtherRuns chart={chart} m={m} panels={rest} />
    </figure>
  );
}

/** The sections of /quality/pareto: every script or language whose primary panel is fit to read. */
export function ParetoPresentation({ m = OCR }: { m?: Measure }) {
  return <div>{m.charts.filter(fit).map(chart => <Figure key={chart.id} chart={chart} m={m} />)}</div>;
}

/** Everything that cannot be ranked yet, as one list: the scripts and languages whose primary panel is graded
 *  not fit (their tables open in place, so no figure is lost), then the ones with no panel at all. */
export function NotMeasured({ measures = [OCR, TRANSLATION] }: { measures?: Measure[] }) {
  const tag = (m: Measure) => <span className="uppercase tracking-wider text-[0.75rem] font-semibold text-stone-600 mr-2">{m.key === 'ocr' ? 'Reading' : 'Translating'}</span>;
  return (
    <ul className="divide-y divide-stone-200 border-y border-stone-200 max-w-4xl text-stone-700">
      {measures.flatMap(m => [
        ...m.charts.filter(c => !fit(c)).map(chart => {
          const p = chart.panels[0];
          return (
            <li key={`${m.key}-${chart.id}`} id={anchorOf(m, chart)} className="py-2 scroll-mt-24">
              <details>
                <summary className="cursor-pointer hover:text-amber-800">
                  {tag(m)}<span className="text-stone-900">{chart.title}</span> ({plural(p.n_works, 'work')}, {plural(p.n_pages, 'page')}): {p.grade.why}.
                </summary>
                <div className="mt-3 mb-2 space-y-8 pl-4 border-l border-stone-200">
                  {chart.caption && <p className="text-sm text-stone-600 max-w-3xl">{chart.caption}</p>}
                  {chart.storedNow && (
                    <p className="text-sm text-stone-600 max-w-3xl">
                      The engine in use is the one new pages get. What readers have now: {chart.storedNow} Much of the stored
                      text was written by an earlier engine, so a result against the engine in use applies to new pages.
                    </p>
                  )}
                  {chart.mentions.map(t => <p key={t} className="text-sm text-stone-600 max-w-3xl">{t}</p>)}
                  {chart.panels.map(x => <PanelView key={x.kind} chart={chart} panel={x} m={m} sub />)}
                </div>
              </details>
            </li>
          );
        }),
        ...m.noChart.map(n => (
          <li key={`${m.key}-${n.title}`} className="py-2">{tag(m)}<span className="text-stone-900">{n.title}</span>: {n.why}.</li>
        )),
      ])}
    </ul>
  );
}

/** The grade rules, verbatim from the data file (scripts/eval/lib/pareto-stats.mjs GRADE_RULES). */
export function GradeRules({ m = OCR }: { m?: Measure }) {
  return (
    <ul className="space-y-1">
      {(['decide', 'directional', 'not_fit'] as const).map(k => (
        <li key={k}><span className="uppercase tracking-wider text-[0.75rem] font-semibold" style={{ color: GRADE_COLOR[k] }}>{GRADE_LABEL[k]}</span>: {m.gradeRules[k]}</li>
      ))}
    </ul>
  );
}

/** The list on /quality: one line per script or language, its grade and its verdict, linking to /quality/pareto. */
export default function ParetoCharts({ m = OCR }: { m?: Measure }): ReactNode {
  return (
    <ul className="divide-y divide-stone-200 border-y border-stone-200 max-w-4xl">
      {m.charts.map(chart => {
        const p = chart.panels[0];
        return (
          <li key={chart.id} id={anchorOf(m, chart)} className="py-3 scroll-mt-24">
            <a href={`/quality/pareto#${anchorOf(m, chart)}`} className="font-serif text-lg text-stone-900 hover:text-amber-800">{m.title(chart)}</a>
            <span className="text-sm ml-2"><GradeBadge g={p.grade} /></span>
            <p className="text-stone-700 leading-snug mt-1">{p.verdict}</p>
          </li>
        );
      })}
    </ul>
  );
}
