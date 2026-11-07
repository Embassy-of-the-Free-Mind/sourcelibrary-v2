import type { ReactNode } from 'react';
import pareto from '@/data/ocr-pareto.json';
import xlate from '@/data/translation-pareto.json';
import roster from '@/data/model-roster.json';
import ParetoDownload from './ParetoDownload';

// Quality against price or time, one section per script (OCR) or per language (translation) (#5983, rebuilt in
// #6386, laid out around the decision in #6524, drawn as model-comparison scatters in #6776). Server-rendered; the
// only client code is the download button. Every number, verdict and grade comes from src/data/ocr-pareto.json
// (scripts/eval/build-ocr-pareto.mjs) or src/data/translation-pareto.json (scripts/eval/build-translation-pareto.mjs),
// and whether we can run an engine today from src/data/model-roster.json (scripts/eval/build-model-roster.mjs):
// the renderer composes no claim.
//
// What is drawn from the same panels:
//   SmallMultiples      one small scatter per script or language whose primary panel is fit to read, each linking to
//                       its section; under each, the reading summaryRow() takes from the panel. summaryRow() repeats
//                       the choice verdictSentence() makes in scripts/eval/lib/pareto-stats.mjs (the first engine marked
//                       `better` that we can run), so a caption and its section's sentence name the same engine.
//   RosterTable         what we can run today, one line per route, and what we measured but cannot run.
//   ParetoPresentation  one section per script or language whose primary panel is fit to read: the verdict sentence,
//                       then the scatter: quality up, time a page or price across (log), one labelled dot per engine
//                       with its 95% interval, the frontier drawn twice (every engine measured, thin grey; the ones we
//                       can run today, solid). A dot is filled when we can run the engine today or it is the engine in
//                       use, hollow when we cannot; the engine in use is ringed. Availability is per model, by the route
//                       we can run it on (model-roster.json). The x axis switches between time and price with two radio
//                       buttons and CSS alone (Tailwind's group-has), so the page needs no client state. One click
//                       down: the forest plot of each engine's paired difference from the engine in use, and the table.
//   NotEnoughEvidence   the scripts or languages whose primary panel is not fit to rank, per half, collapsed.
// Colour follows the engine's role, never its rank: amber for the engine in use, teal for an engine the data file
// marks better, stone for everything else. Colours are hex rather than var(--…) because the download serialises
// the SVG outside the page's CSS; each one is a Tailwind token the page already uses (named beside it).

const BETTER = '#0b9488'; // teal-600
const PRODUCTION = '#b45309'; // amber-700
const INK = '#44403c'; // stone-700
const MUTED = '#57534e'; // stone-600
const FAINT = '#a8a29e'; // stone-400
const GRID = '#e7e5e4'; // stone-200
const PAPER = '#ffffff'; // white
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
const GH = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/';

type Cost = { usd_per_1k: number; basis: 'billed' | 'quota'; detail: string; source: string };
/** How the engine is run (#6776): billed per request, a CLI on a subscription ($0 billed), a rented GPU, our server. */
type Route = 'api' | 'subscription' | 'gpu' | 'own';
type Secs = { median: number; n: number; files: string[] };
type Vs = { diff: number; ci95: number[] | null; n_pages: number; n_works: number };
type Verdict = 'better' | 'same' | 'worse';
/** One engine's row in src/data/model-roster.json. */
type RosterRow = {
  engine: string; label: string; group: string; route: Route; how: string; available: boolean; why_not: string | null; source: string; checked: string;
  /** measured through a paid API, run today on a subscription: `note` says so */
  measured_via?: 'api'; note?: string;
  /** not for new work, but what production runs on its own lanes: shown as in use there, never as not available */
  in_use_route?: string; lanes?: string;
};
/** One engine on one figure, in the measure-neutral shape the renderer draws. */
type Point = {
  engine: string; label: string; production: boolean; y: number; y_ci95: number[] | null;
  cost: Cost | null; no_price: string | null; on_frontier: boolean;
  vs: Vs | null; verdict: Verdict | null;
  /** median seconds a page from the run's own meter; null: not measured */
  secs: Secs | null;
  /** the engine's roster row: route, and whether we can run it today */
  roster: RosterRow | null;
  /** the measure's extra table cells (pages over half wrong; words not in the reference; reversals) */
  extra: (string | null)[];
  /** position in the data file (placed, then no_cost): the tie-break the verdict sentence uses */
  order: number;
};
type Noise = { kind: 'spread' | 'identical' | 'not_reproduced' | 'unlike'; band: number | null; diff?: number; why?: string | null; n?: number };
type Grade = { level: 'decide' | 'directional' | 'not_fit'; why: string };
type Panel = {
  kind: string; role: string; heading: string | null; n_pages: number; n_works: number; reference: string;
  grade: Grade; toDecide: string[] | null; frontier: boolean; noise: Noise | null; date: string | null; verdict: string;
  notes: string[]; points: Point[]; extraHeads: { head: string; title: string }[];
};
export type Chart = { id: string; title: string; production_label: string; caption: string | null; storedNow: string | null; mentions: string[]; panels: Panel[] };
type NoChartRow = { title: string; why: string; source: string };

/** Everything that differs between the OCR and the translation figures. No figures in here either. */
export type Measure = {
  key: 'ocr' | 'translation';
  anchor: string;
  /** "OCR · Latin print": every chart title says which half it is in */
  title: (c: Chart) => string;
  exportTitle: (c: Chart) => string;
  /** what the forest plot's axis measures, after "Difference from the engine in use in " */
  yAxis: string;
  /** the scatter's y axis, above it */
  scatterY: string;
  fmtY: (v: number | null | undefined) => string;
  /** a y tick, to the precision its step needs */
  fmtTick: (v: number, step: number) => string;
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
/** Coordinates to a tenth of a pixel: the page carries hundreds of plots, and float noise doubled its weight. */
const rd = (v: number) => Math.round(v * 10) / 10;
const decimals = (step: number) => Math.max(0, -Math.floor(Math.log10(step) + 1e-9));

// ── the roster ───────────────────────────────────────────────────────────────────────────────
type RosterGroup = { id: string; title: string; route: Route; how: string; cost_basis: string };
type RosterData = {
  checked: string; agy_models: { source: string; models: string[] }; route_labels: Record<Route, string>; production_lane_note: string;
  newest: { engine: string; label: string }; groups: RosterGroup[]; engines: RosterRow[];
};
const ROSTER = roster as unknown as RosterData;
const ROSTER_BY = new Map(ROSTER.engines.map(r => [r.engine, r]));
/** "<engine>|kraken" is the same engine on another input */
const rosterOf = (engine: string) => ROSTER_BY.get(engine.split('|')[0]) ?? null;

// ── adapters: each data file to the renderer's shape ─────────────────────────────────────────
type RawCost = { usd_per_1k: number; basis: string; detail: string; source: string } | null;
type OcrPoint = {
  engine: string; label: string; production: boolean; accuracy: number; accuracy_ci95: number[] | null; fail_share: number;
  words_not_in_ref: number | null; cost: RawCost; no_price?: string; on_frontier?: boolean; vs_in_use?: Vs | null; verdict?: Verdict;
  secs_per_page?: Secs | null;
  did_not_read: { k: number; n: number; kinds: Record<string, number> }; partly_measured?: string;
};
// #6523: a failed read is counted, not scored
const KIND_WORDS: Record<string, string> = { copy_filter: 'copy filter', refusal: 'refused', empty: 'empty', timeout: 'timed out', other: 'no transcription' };
const didNotRead = (x: OcrPoint) => (x.did_not_read.k === 0 ? '0'
  : `${x.did_not_read.k} of ${x.did_not_read.n} (${Object.entries(x.did_not_read.kinds).map(([k, n]) => `${KIND_WORDS[k] ?? k} ${n}`).join(', ')})${x.partly_measured ? ', partly measured' : ''}`);
type RawPanel<P> = {
  kind: string; role?: string; heading: string | null; n_pages: number; n_works: number; reference: string; grade: Grade;
  to_decide?: string[] | null; frontier: boolean; noise: Noise | null; date: string | null; verdict: string; notes?: string[]; placed: P[]; no_cost: P[];
};
type RawChart<P> = { id: string; title: string; production_label: string; caption?: string | null; stored_now?: string | null; mentions?: string[]; panels: RawPanel<P>[] };

const base = <P,>(p: RawPanel<P>, i: number) => ({
  kind: p.kind, role: p.role ?? (i === 0 ? 'primary' : 'secondary'), heading: p.heading, n_pages: p.n_pages, n_works: p.n_works,
  reference: p.reference, grade: p.grade, toDecide: p.to_decide ?? null, frontier: p.frontier, noise: p.noise, date: p.date, verdict: p.verdict, notes: p.notes ?? [],
});
const common = (x: { engine: string; label: string; production: boolean; cost: RawCost; no_price?: string; on_frontier?: boolean; vs_in_use?: Vs | null; verdict?: Verdict;
  secs_per_page?: Secs | null }) => ({
  engine: x.engine, label: x.label, production: x.production, cost: x.cost as Cost | null, no_price: x.no_price ?? null,
  on_frontier: !!x.on_frontier, vs: x.vs_in_use ?? null, verdict: x.verdict ?? null, secs: x.secs_per_page ?? null, roster: rosterOf(x.engine),
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
  title: c => `OCR · ${c.title}`,
  exportTitle: c => `OCR · ${c.title}: accuracy against price`,
  yAxis: 'accuracy against a typed text, in points a page',
  scatterY: 'character accuracy, mean with 95% interval',
  fmtY: v => pctOf(v),
  fmtTick: (v, step) => `${(v * 100).toFixed(decimals(step * 100))}%`,
  fmtDiff: d => signed(Math.abs(d * 100).toFixed(1), d), diffUnit: 'points', gainHead: 'Gain, points a page',
  yColumn: 'mean accuracy',
  charts: ocrData.charts.map(c => adapt(c, ocrPanel)),
  noChart: ocrData.no_chart,
  gradeRules: ocrData.grade_rules,
};

export const TRANSLATION: Measure = {
  key: 'translation', anchor: 'pareto-translation-',
  title: c => `Translation · ${c.title} into English`,
  exportTitle: c => `Translation · ${c.title} into English: fidelity against price`,
  yAxis: 'fidelity to a published translation, on the 1 to 5 scale (model-judged)',
  scatterY: 'fidelity, 1 to 5 (model-judged), mean with 95% interval',
  fmtY: v => (v == null ? '–' : v.toFixed(2)),
  fmtTick: (v, step) => v.toFixed(decimals(step)),
  fmtDiff: d => signed(Math.abs(d).toFixed(2), d), diffUnit: 'on the 1 to 5 scale', gainHead: 'Gain a page, on the 1 to 5 scale',
  yColumn: 'mean fidelity',
  charts: xData.charts.map(c => adapt(c, translationPanel)),
  noChart: xData.no_chart,
  gradeRules: xData.grade_rules,
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const listOf = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const GRADE_LABEL: Record<Grade['level'], string> = { decide: 'Decide', directional: 'Directional', not_fit: 'Not fit to rank' };
const GRADE_COLOR: Record<Grade['level'], string> = { decide: BETTER, directional: PRODUCTION, not_fit: MUTED };

/** "44 works · 44 pages · Wikisource transcriptions": always beside the verdict. */
const sample = (p: Panel) => `${plural(p.n_works, 'work')} · ${plural(p.n_pages, 'page')} · ${p.reference}`;
const ciText = (m: Measure, ci: number[] | null) => (ci ? `${m.fmtDiff(ci[0])} to ${m.fmtDiff(ci[1])}` : 'no interval');

const BILLED_NOTHING = '$0 billed';
/** run on a subscription: a CLI run, or an engine measured through an API that we run on a subscription today */
const isSub = (p: Point) => !p.production && (p.cost?.basis === 'quota' || p.roster?.route === 'subscription');
/** The price an engine is drawn at. A subscription route shows the API price for the same requests beside the $0 it
 *  bills, so the comparison price is never read as a bill (#6776). */
const priceText = (p: Point) => (p.cost ? (isSub(p) ? `${usd(p.cost.usd_per_1k)} API, ${BILLED_NOTHING}` : usd(p.cost.usd_per_1k))
  : isSub(p) ? BILLED_NOTHING : 'no price');
const secsText = (p: Point) => (p.secs ? `${p.secs.median.toFixed(p.secs.median < 10 ? 1 : 0)} s a page` : 'not measured');
const anchorOf = (m: Measure, chart: Chart, panel?: Panel) =>
  `${m.anchor}${chart.id}${panel && chart.panels.indexOf(panel) > 0 ? `-${panel.kind}` : ''}`;
const svgId = (m: Measure, chart: Chart, panel: Panel) => `${m.anchor}svg-${chart.id}-${panel.kind}`;
/** What a dot says about running the engine. The engine in use is in use, whatever its route (Derek 2026-10-16: what
 *  production runs is never "not available"); otherwise the roster row decides. */
type State = 'in_use' | 'available' | 'not_available';
const stateOf = (p: Point): State => (p.production ? 'in_use' : p.roster?.available ? 'available' : 'not_available');
/** paint order: hollow first, so no dot we cannot run is drawn over one we can */
const STATE_RANK: Record<State, number> = { not_available: 0, available: 1, in_use: 2 };
const stateText = (p: Point) => (p.production ? `in use${p.roster?.in_use_route ? ` (${p.roster.in_use_route})` : ''}`
  : p.roster?.available ? `available today: ${p.roster.how}${p.roster.note ? ` (${p.roster.note})` : ''}` : `not runnable today: ${p.roster?.why_not ?? 'not in the roster'}`);

// ── the roster table ─────────────────────────────────────────────────────────────────────────
/** "What we can run today": one line per route group with the engines measured on this page, then a closed list of
 *  the engines measured here that we cannot run, each with the reason and the rule it comes from. */
export function RosterTable() {
  const usable = ROSTER.groups.filter(g => g.id !== 'production')
    .map(g => ({ g, rows: ROSTER.engines.filter(r => r.group === g.id && (r.available || r.in_use_route)) })).filter(x => x.rows.length);
  const not = ROSTER.engines.filter(r => !r.available);
  const th = 'font-normal py-2 pr-4';
  const td = 'block sm:table-cell sm:py-1.5 sm:pr-4';
  return (
    <div>
      <table className="w-full text-base block sm:table">
        <thead className="hidden sm:table-header-group">
          <tr className="text-left text-sm text-stone-600 border-b border-stone-300 align-bottom">
            <th className={th}>Engines</th><th className="font-normal py-2">How we run them, and what it costs</th>
          </tr>
        </thead>
        <tbody className="block sm:table-row-group">
          {usable.map(({ g, rows }) => (
            <tr key={g.id} className="block sm:table-row py-2 sm:py-0 border-b border-stone-200 align-top">
              <th scope="row" className={`${td} text-left font-normal`}>
                <span className="text-stone-900 font-semibold">{g.title}</span>
                <span className={`block text-sm text-stone-600 ${rows.length === 1 && rows[0].label === g.title ? 'hidden' : ''}`}>
                  {rows.map(r => `${r.label}${r.measured_via ? ' (measured via API)' : ''}${r.in_use_route ? ` (in use on its production lanes only: ${r.lanes})` : ''}`).join(', ')}
                </span>
              </th>
              <td className={`${td} text-sm sm:text-base text-stone-700`}>{g.how}; {g.cost_basis}.</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-stone-600 mt-2 max-w-3xl">
        {ROSTER.production_lane_note} An engine measured through a paid API that we can run on a subscription is drawn
        filled and marked as measured via API; on the subscription it is $0 billed.
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-stone-700 hover:text-amber-800">Measured but not runnable today ({not.length}): drawn as hollow dots</summary>
        <ul className="mt-2 pl-4 border-l border-stone-200 text-sm text-stone-700 space-y-1 max-w-3xl">
          {not.map(r => (
            <li key={r.engine}><span className="text-stone-900">{r.label}</span>: {r.why_not}. <a href={`${GH}${r.source}`} className="text-stone-600 hover:text-amber-800 underline decoration-stone-300">source</a></li>
          ))}
        </ul>
        <p className="text-sm text-stone-600 mt-2 max-w-3xl">
          Checked {ROSTER.checked}. The command-line models are the ones Google&rsquo;s Antigravity command-line tool (<code>agy models</code>) listed that day
          ({listOf(ROSTER.agy_models.models.filter(x => !/^claude-/.test(x)))}; Claude is never run through it).{' '}
          <a href={`${GH}${ROSTER.agy_models.source}`} className="underline decoration-stone-300 hover:text-amber-800">Recorded output</a>.
        </p>
      </details>
    </div>
  );
}

// ── the reading of one panel ─────────────────────────────────────────────────
/** One script's or language's reading, from its primary panel: what the small multiple and its caption say. */
export type SummaryRow = {
  id: string; title: string; anchor: string; grade: Grade; inUse: string;
  /** switch: a Decide panel names a better engine we can run. toward: a Directional one points at one. none: nothing we
   *  can run stands out. withheld: two runs of the engine in use disagreed. not_fit: the panel is not fit to rank. */
  state: 'switch' | 'toward' | 'none' | 'withheld' | 'not_fit';
  best: string | null; gain: string | null; interval: string | null;
  /** the other engines marked better that we can run, in the verdict sentence's order */
  also: { label: string }[];
  /** engines marked better that we cannot run today, in the verdict sentence's order: named, never offered */
  cannotRun: string[];
};

/** The engines the data file marks better than the engine in use, largest paired difference first: the same
 *  choice, with the same tie-break, as verdictSentence() in scripts/eval/lib/pareto-stats.mjs. */
const betterOf = (p: Panel) => p.points.filter(x => x.verdict === 'better' && x.vs).sort((a, b) => b.vs!.diff - a.vs!.diff || a.order - b.order);

/** No engine we cannot run is ever offered (#6776, Derek 2026-10-16): the switch is the first engine marked better that
 *  we can run, as verdictSentence() chooses it. */
export function summaryRow(chart: Chart, m: Measure): SummaryRow {
  const p = chart.panels[0];
  const prod = p.points.find(x => x.production);
  const row: SummaryRow = {
    id: chart.id, title: chart.title, anchor: anchorOf(m, chart), grade: p.grade, inUse: chart.production_label,
    state: 'none', best: null, gain: null, interval: null, also: [], cannotRun: [],
  };
  if (p.grade.level === 'not_fit' || !prod) return { ...row, state: 'not_fit' };
  row.inUse = prod.label;
  if (p.noise?.kind === 'not_reproduced') return { ...row, state: 'withheld' };
  const all = betterOf(p);
  const runs = all.filter(x => stateOf(x) !== 'not_available');
  const cannotRun = all.filter(x => stateOf(x) === 'not_available').map(x => x.label);
  const [b, ...rest] = runs;
  if (!b) return { ...row, cannotRun };
  return {
    ...row, state: p.grade.level === 'decide' ? 'switch' : 'toward', cannotRun,
    best: b.label, gain: m.fmtDiff(b.vs!.diff), interval: b.vs!.ci95 ? ciText(m, b.vs!.ci95) : null,
    also: p.grade.level === 'decide' ? rest.map(x => ({ label: x.label })) : [],
  };
}

const fit = (c: Chart) => c.panels[0].grade.level !== 'not_fit';

// ── the scatter ──────────────────────────────────────────────────────────────
type Axis = 'price' | 'time';
const xOf = (p: Point, axis: Axis) => (axis === 'price' ? p.cost?.usd_per_1k ?? null : p.secs?.median ?? null);
/** Time a page is the default view (Derek 2026-10-16), where at least three engines were timed; a run that timed fewer
 *  opens on price, where the comparison has more than one or two dots (and on time if nothing has a price). */
const defaultAxis = (panel: Panel): Axis => {
  const n = (axis: Axis) => panel.points.filter(p => xOf(p, axis) != null).length;
  return n('time') >= 3 || n('time') >= n('price') ? 'time' : 'price';
};

/** The non-dominated points: nothing else is at least as cheap (or fast) and at least as good, and better on one.
 *  The same rule as markFrontier() in scripts/eval/lib/pareto-stats.mjs, sorted along x for drawing. */
export function frontierOf<T>(pts: T[], x: (p: T) => number, y: (p: T) => number): T[] {
  return pts.filter(a => !pts.some(b => b !== a && x(b) <= x(a) && y(b) >= y(a) && (x(b) < x(a) || y(b) > y(a))))
    .sort((a, b) => x(a) - x(b) || y(a) - y(b));
}

/** Linear ticks on a 1–2–5 step, at most `max` of them. */
function niceTicks(lo: number, hi: number, max: number) {
  const span = hi - lo || 1;
  for (let pow = 10 ** Math.floor(Math.log10(span / max)), k = 0; ; k++) {
    const step = pow * [1, 2, 5][k % 3] * 10 ** Math.floor(k / 3);
    const ticks: number[] = [];
    for (let i = Math.ceil(lo / step - 1e-9); i * step <= hi + step * 1e-9; i++) ticks.push(i * step);
    if (ticks.length <= max) return { ticks, step };
  }
}
/** Log ticks at 1, 2 and 5 of each decade, thinned to at most `max`. */
function logTicks(lo: number, hi: number, max: number) {
  const all: number[] = [];
  for (let d = Math.floor(Math.log10(lo)); d <= Math.ceil(Math.log10(hi)); d++) for (const k of [1, 2, 5]) {
    const v = k * 10 ** d;
    if (v >= lo * 0.999 && v <= hi * 1.001) all.push(v);
  }
  if (all.length <= max) return all;
  const ones = all.filter(v => Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9);
  return ones.length >= 2 ? ones : [all[0], all.at(-1)!];
}
const fmtX = (axis: Axis, v: number) => (axis === 'price' ? `$${v < 1 ? String(v) : v.toFixed(0)}` : `${v < 1 ? String(v) : v.toFixed(0)} s`);

type Box = { x0: number; y0: number; x1: number; y1: number };
const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
type Label = { p: Point; x: number; y: number; anchor: 'start' | 'end'; lines: string[]; lead: [number, number, number, number] | null };

/**
 * One scatter: quality up, price or time across (log). The y axis is zoomed to the engines' scores (a whisker that
 * runs past it is cut at the edge), so a close cluster at the top is not flattened by one wide interval. Every plotted
 * engine gets its name, placed by a greedy search outward from its dot, with a leader line when it lands away from it;
 * no name may touch another name, a dot or a frontier line. Where none fits, a number keyed under the plot. A small
 * multiple (`mini`) names only the engine in use and the frontier of what we can run, and drops a name that does not
 * fit. Engines with no x value on this axis are returned in `absent`, for the list under the plot.
 */
function scatter(panel: Panel, m: Measure, axis: Axis, W: number, f: number, plotH: number, mini = false) {
  const pts = panel.points.filter(p => xOf(p, axis) != null);
  const absent = panel.points.filter(p => xOf(p, axis) == null);
  const fs = rd(f * 0.85), r = rd(Math.max(3, f * (mini ? 0.3 : 0.36)));
  const lh = fs * 1.15;
  const head = mini ? f * 1.3 : f * 2.5;
  const padL = rd(f * 3.1), padR = rd(f * 0.5), top = rd(head + lh * 1.2), bottom = rd(f * (mini ? 1.6 : 2.8));
  const H = Math.ceil(top + plotH + bottom);
  const X0 = padL, X1 = W - padR, Y0 = top, Y1 = top + plotH;
  const keyed: [number, Point][] = [];
  if (!pts.length) return { H: 0, body: null, absent, keyed };

  // y: the scores, padded; at most three far-low engines (a quarter at most) sit on the floor with an arrow when they
  // lie more than the rest's range below it, so one failed engine cannot flatten the others
  const ys = pts.map(p => p.y).sort((a, b) => a - b);
  const hiY = ys.at(-1)!;
  const coreLo = ys[Math.min(3, Math.floor(pts.length / 4))];
  const minSpan = m.key === 'ocr' ? 0.01 : 0.1;
  const floorY = coreLo - Math.max((hiY - coreLo) * 0.5, minSpan);
  const cut = new Set(pts.filter(p => p.y < floorY));
  const loY = Math.min(...pts.filter(p => !cut.has(p)).map(p => p.y));
  const span = Math.max(hiY - loY, minSpan);
  const yLo = loY - span * 0.12, yHi = hiY + span * 0.25;
  const { ticks: yTicks, step: yStep } = niceTicks(yLo, yHi, Math.max(2, Math.floor(plotH / (f * (mini ? 2.4 : 2.8)))));
  const sy = (v: number) => rd(Y1 - ((Math.min(Math.max(v, yLo), yHi) - yLo) / (yHi - yLo)) * (Y1 - Y0));

  // x: log, padded a fifth of a decade on the left and nearly half of one on the right, where names go
  const xs = pts.map(p => xOf(p, axis)!);
  const one = Math.min(...xs) === Math.max(...xs);
  const xLo = Math.min(...xs) / 10 ** (one ? 0.5 : 0.2), xHi = Math.max(...xs) * 10 ** (one ? 0.5 : W >= 500 ? 0.45 : 0.33);
  const lx0 = Math.log10(xLo), lx1 = Math.log10(xHi);
  const sx = (v: number) => rd(X0 + ((Math.log10(v) - lx0) / (lx1 - lx0)) * (X1 - X0));
  const xTicks = logTicks(xLo, xHi, Math.max(2, Math.floor((X1 - X0) / (fs * 4.5))));

  // the frontier, twice: every engine plotted, and the ones we can run today; never on a panel not fit to rank
  const draw = panel.grade.level !== 'not_fit' && pts.length >= 3;
  const at = (p: Point) => ({ x: sx(xOf(p, axis)!), y: cut.has(p) ? Y1 : sy(p.y) });
  const steps = (fr: Point[]) => fr.map(at).map((q, i) => (i === 0 ? `M${q.x} ${q.y}` : `H${q.x} V${q.y}`)).join(' ')
    + (fr.length ? ` H${X1}` : '');
  const allFr = draw ? frontierOf(pts, p => xOf(p, axis)!, p => p.y) : [];
  const runFr = draw ? frontierOf(pts.filter(p => stateOf(p) !== 'not_available'), p => xOf(p, axis)!, p => p.y) : [];

  // names: the engine in use first, then the frontier of what we can run, then the rest of the frontier, then by score
  const dots: Box[] = pts.map(p => { const q = at(p); return { x0: q.x - r - 1.5, y0: q.y - r - 1.5, x1: q.x + r + 1.5, y1: q.y + r + 1.5 }; });
  const lines: Box[] = [];
  for (const fr of [allFr, runFr]) fr.map(at).forEach((q, i, a) => {
    const nx = i + 1 < a.length ? a[i + 1].x : X1;
    lines.push({ x0: q.x, y0: q.y - 1.5, x1: nx, y1: q.y + 1.5 });
    if (i + 1 < a.length) lines.push({ x0: nx - 1.5, y0: Math.min(q.y, a[i + 1].y), x1: nx + 1.5, y1: Math.max(q.y, a[i + 1].y) });
  });
  const names: Box[] = [];
  const bounds: Box = { x0: X0 + 2, y0: head + 2, x1: W, y1: Y1 - 1 };   // never over the y tick labels or the header
  const inside = (b: Box) => b.x0 >= bounds.x0 && b.x1 <= bounds.x1 && b.y0 >= bounds.y0 && b.y1 <= bounds.y1;
  const rank = (p: Point) => (p.production ? 0 : runFr.includes(p) ? 1 : allFr.includes(p) ? 2 : 3);
  const order = [...pts].sort((a, b) => rank(a) - rank(b) || b.y - a.y);
  const labels: Label[] = [];
  // candidate offsets, nearest first: beside the dot, then stepped up or down and outward, each with a leader line
  const g = r + 3;
  const offsets: [number, number][] = [];
  for (const dy of [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -7, 7]) for (const dx of [0, 1.5, 3.5, 6]) offsets.push([dx, dy]);
  offsets.sort((a, b) => Math.hypot(a[0] * 1.2, a[1]) - Math.hypot(b[0] * 1.2, b[1]));
  const place = (p: Point, text: string[]) => {
    const q = at(p), w = Math.max(...text.map(t => t.length)) * fs * 0.6, h = text.length * lh;
    const crosses = (x0: number, y0: number, x1: number, y1: number) => {
      for (let k = 1; k < 8; k++) {
        const bx = x0 + ((x1 - x0) * k) / 8, by = y0 + ((y1 - y0) * k) / 8;
        const b = { x0: bx - 0.5, y0: by - 0.5, x1: bx + 0.5, y1: by + 0.5 };
        if (names.some(t => hit(t, b))) return true;
        if (dots.some((t, i) => pts[i] !== p && hit(t, b))) return true;
      }
      return false;
    };
    for (const [dx, dy] of offsets) for (const side of [1, -1] as const) {
      const ax = q.x + side * (g + dx * fs);
      const cy = q.y + dy * lh * 0.75;
      const x0 = side === 1 ? ax : ax - w;
      const b = { x0, y0: cy - h / 2, x1: x0 + w, y1: cy + h / 2 };
      if (!inside(b) || names.some(t => hit(t, b)) || dots.some(t => hit(t, b)) || lines.some(t => hit(t, b))) continue;
      const far = dx > 0 || Math.abs(dy) > 0.5;
      const lead: Label['lead'] = far ? [q.x + side * (r + 1), q.y, ax - side * 2, cy] : null;
      if (lead && crosses(...lead)) continue;
      names.push(b);
      if (lead) for (let k = 1; k < 6; k++) {
        const bx = lead[0] + ((lead[2] - lead[0]) * k) / 6, by = lead[1] + ((lead[3] - lead[1]) * k) / 6;
        lines.push({ x0: bx - 1, y0: by - 1, x1: bx + 1, y1: by + 1 });
      }
      return { x: rd(ax), y: rd(cy - h / 2 + lh / 2), anchor: (side === 1 ? 'start' : 'end') as Label['anchor'], lead: lead && lead.map(rd) as Label['lead'] };
    }
    return null;
  };
  for (const p of order) {
    if (mini && rank(p) > 1) continue;
    const sub = isSub(p) && axis === 'price';
    const text = mini ? [p.label]
      : [`${p.label}${sub ? ' †' : ''}${cut.has(p) ? ` ${m.fmtY(p.y)}` : ''}`, ...(sub ? [BILLED_NOTHING] : [])];
    let s = place(p, text);
    // a long name may take two lines: "Gemini 3.1 Pro" over "(thinking 128)"
    const cut2 = text[0].indexOf(' (');
    const wrapped = cut2 > 0 ? [text[0].slice(0, cut2), text[0].slice(cut2 + 1), ...text.slice(1)] : null;
    if (!s && wrapped && !mini) { s = place(p, wrapped); if (s) { labels.push({ p, lines: wrapped, ...s }); continue; } }
    if (s) { labels.push({ p, lines: text, ...s }); continue; }
    if (mini) continue;
    const n = keyed.length + 1;
    keyed.push([n, p]);
    const t = place(p, [String(n)]);
    const q = at(p);
    labels.push({ p, lines: [String(n)], x: t ? t.x : q.x + r + 2, y: t ? t.y : q.y - r - 2, anchor: t ? t.anchor : 'start', lead: t ? t.lead : null });
  }

  const color = (p: Point) => (p.production ? PRODUCTION : p.verdict === 'better' ? BETTER : INK);
  const xTitle = axis === 'price' ? '$ per 1,000 pages, log scale →' : 'median seconds a page, log scale →';
  // hollow dots first, so a filled dot is never painted over by one we cannot run
  const drawOrder = [...pts].sort((a, b) => STATE_RANK[stateOf(a)] - STATE_RANK[stateOf(b)]);
  const body = (
    <g fontFamily={FONT}>
      <text x={0} y={f * 1.0} fontSize={fs} fontWeight={600} fill={GRADE_COLOR[panel.grade.level]}>{GRADE_LABEL[panel.grade.level].toUpperCase()}
        <tspan fontWeight={400} fill={MUTED}>{` · ${plural(panel.n_works, 'work')}${mini ? ` · by ${axis === 'price' ? 'price' : 'time'}` : ` · ${plural(panel.n_pages, 'page')}`}`}</tspan>
      </text>
      {!mini && <text x={0} y={f * 2.2} fontSize={fs} fill={MUTED}>{`↑ ${m.scatterY}`}</text>}
      {yTicks.map(t => (
        <g key={t}>
          <line x1={X0} x2={X1} y1={sy(t)} y2={sy(t)} stroke={GRID} strokeWidth={1} />
          <text x={X0 - 4} y={sy(t)} dy="0.34em" textAnchor="end" fontSize={fs} fill={MUTED}>{m.fmtTick(t, yStep)}</text>
        </g>
      ))}
      {xTicks.map(t => (
        <g key={t}>
          <line x1={sx(t)} x2={sx(t)} y1={Y0} y2={Y1} stroke={GRID} strokeWidth={1} />
          <text x={sx(t)} y={Y1 + fs * 1.3} textAnchor="middle" fontSize={fs} fill={MUTED}>{fmtX(axis, t)}</text>
        </g>
      ))}
      <line x1={X0} x2={X1} y1={Y1} y2={Y1} stroke={FAINT} strokeWidth={1} />
      {!mini && <text x={X1} y={Y1 + fs * 2.6} textAnchor="end" fontSize={fs} fill={MUTED}>{xTitle}</text>}
      {allFr.length > 0 && <path d={steps(allFr)} fill="none" stroke={FAINT} strokeWidth={1.25} />}
      {runFr.length > 0 && <path d={steps(runFr)} fill="none" stroke={INK} strokeWidth={2} />}
      {!mini && pts.map(p => {
        const q = at(p), ci = p.y_ci95;
        return ci && !cut.has(p) && <line key={`ci-${p.engine}`} x1={q.x} x2={q.x} y1={sy(ci[0])} y2={sy(ci[1])} stroke={color(p)} strokeWidth={1.25} opacity={0.45} />;
      })}
      {drawOrder.map(p => {
        const q = at(p), c = color(p), st = stateOf(p), filled = st !== 'not_available', ci = p.y_ci95;
        const tip = `${p.label}: ${m.fmtY(p.y)}${ci ? ` (95% interval ${m.fmtY(ci[0])} to ${m.fmtY(ci[1])})` : ''}; ${axis === 'price' ? priceText(p) : secsText(p)}; ${stateText(p)}`;
        return (
          <g key={p.engine} data-engine={p.engine} data-state={st}>
            <title>{tip}</title>
            {p.production && <circle cx={q.x} cy={q.y} r={r + 3.5} fill="none" stroke={PRODUCTION} strokeWidth={1.5} />}
            {cut.has(p)
              ? <path d={`M${q.x - r} ${q.y - r * 1.6} h${r * 2} l${-r} ${r * 1.6} z`} fill={filled ? c : PAPER} stroke={c} strokeWidth={1.5} />
              : <circle cx={q.x} cy={q.y} r={r} fill={filled ? c : PAPER} stroke={c} strokeWidth={1.5} />}
          </g>
        );
      })}
      {labels.map(l => (
        <g key={`l-${l.p.engine}`}>
          {l.lead && <line x1={l.lead[0]} y1={l.lead[1]} x2={l.lead[2]} y2={l.lead[3]} stroke={MUTED} strokeWidth={0.75} />}
          <text x={l.x} y={l.y} dy="0.34em" textAnchor={l.anchor} fontSize={fs} fontWeight={l.p.production || l.p.verdict === 'better' ? 600 : 400}
            fill={l.p.production ? PRODUCTION : INK} stroke={PAPER} strokeWidth={3} strokeOpacity={0.85} paintOrder="stroke">
            {l.lines.map((t, i) => <tspan key={i} x={l.x} dy={i ? lh : undefined} fontWeight={i ? 400 : undefined} fill={i ? MUTED : undefined}>{t}</tspan>)}
          </text>
        </g>
      ))}
    </g>
  );
  return { H, body, absent, keyed };
}

const AXIS_PRICE = 'group-has-[.axis-time:checked]/axis:hidden';
const AXIS_TIME = 'hidden group-has-[.axis-time:checked]/axis:block';

/** What is not on one view of the scatter, in one paragraph: the numbered names, the engine in use's production
 *  route, the engines we cannot run (their reasons are in the roster and the dot's tooltip), the engines measured on a
 *  route other than the one we run them on, the engines this axis cannot place, and the newest CLI model when it was
 *  not measured here. */
function ScatterNotes({ chart, panel, axis, keyed }: { chart: Chart; panel: Panel; axis: Axis; keyed: [number, Point][] }) {
  const pts = panel.points.filter(p => xOf(p, axis) != null);
  const absent = panel.points.filter(p => xOf(p, axis) == null);
  const prod = panel.points.find(p => p.production);
  const viaApi = pts.filter(p => p.roster?.measured_via && !p.production);
  const newest = !panel.points.some(p => p.engine === ROSTER.newest.engine);
  const elsewhere = newest && chart.panels.some(x => x !== panel && x.points.some(p => p.engine === ROSTER.newest.engine));
  const parts: ReactNode[] = [
    keyed.length > 0 && `${keyed.map(([n, p]) => `${n} ${p.label}`).join(' · ')}.`,
    prod?.roster?.in_use_route && `In use: ${prod.label} (${prod.roster.in_use_route}).`,
    viaApi.length > 0 && `Measured via API; we run ${viaApi.length === 1 ? 'it' : 'them'} on a subscription: ${listOf(viaApi.map(p => p.label))}.`,
    newest && `${ROSTER.newest.label}: not measured on this set yet${elsewhere ? '; measured in another run' : ''}.`,
    panel.grade.level === 'not_fit' && 'No frontier: this run is not fit to rank.',
  ].filter(Boolean);
  return (
    <div className="text-sm text-stone-600 mt-1">
      {parts.length > 0 && <p>{parts.map((x, i) => <span key={i}>{i ? ' ' : ''}{x}</span>)}</p>}
      {absent.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer hover:text-amber-800">
            Not on this view: {plural(absent.length, 'engine')} {axis === 'price' ? 'with no price on record' : 'not timed (never estimated)'}
          </summary>
          <p>{absent.map((p, i) => <span key={p.engine} title={axis === 'price' ? p.no_price ?? undefined : undefined}>{i ? ', ' : ''}{p.label}</span>)}.</p>
        </details>
      )}
    </div>
  );
}

/** The scatter with its time / price switch, and the notes for each view, as two pieces the panel lays out: on a wide
 *  screen the notes sit beside the plot, on a phone under it. Each is drawn at two widths so the type holds its size.
 *  The switch, plots and notes must share one `group/axis` ancestor, which the panel provides; a panel with only one
 *  measured axis gets no switch, just a line saying why. */
function scatterParts(chart: Chart, panel: Panel, m: Measure) {
  const sizes: [string, number, number, number][] = [['sm:hidden', 360, 12, 155], ['hidden sm:block', 700, 13, 215]];
  const name = `axis-${svgId(m, chart, panel)}`;
  const first = defaultAxis(panel);
  const has = (axis: Axis) => panel.points.some(p => xOf(p, axis) != null);
  const both = has('price') && has('time');
  const axes: Axis[] = both ? ['time', 'price'] : [first];
  const cls = (axis: Axis) => (!both ? '' : axis === 'price' ? AXIS_PRICE : AXIS_TIME);
  const drawn = axes.map(axis => {
    const n = panel.points.filter(p => xOf(p, axis) != null).length;
    const label = `${m.title(chart)}, ${axis === 'price' ? 'quality against price' : 'quality against time a page'}: ${n} engines plotted. ${sample(panel)}.`;
    return { axis, label, views: sizes.map(([c, W, f, h]) => ({ c, W, s: scatter(panel, m, axis, W, f, h) })) };
  });
  const pill = 'cursor-pointer rounded border border-stone-300 px-3 py-0.5 text-stone-700 hover:text-amber-800 has-[:checked]:border-stone-700 has-[:checked]:text-stone-900 has-[:checked]:font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-amber-700';
  const plot = (
    <div>
      {both ? (
        <fieldset className="flex flex-wrap items-center gap-2 text-sm">
          <legend className="sr-only">Across the bottom</legend>
          <span className="text-stone-600 mr-1">Across:</span>
          <label className={pill}><input type="radio" name={name} defaultChecked={first === 'time'} className="axis-time sr-only" />Time a page</label>
          <label className={pill}><input type="radio" name={name} defaultChecked={first === 'price'} className="sr-only" />Price</label>
        </fieldset>
      ) : !m.charts.some(c => c.panels.some(x => x.points.some(p => p.secs))) ? null : (
        <p className="text-sm text-stone-600">
          Across: {first === 'price' ? 'price (no engine on this run timed its pages)' : 'time a page (no engine on this run has a price on record)'}.
        </p>
      )}
      {drawn.map(({ axis, label, views }) => (
        <div key={axis} className={cls(axis)}>
          {views.map(({ c, W, s }) => s.body && <svg key={c} viewBox={`0 0 ${W} ${s.H}`} className={`w-full h-auto mt-1 ${c}`} style={{ maxWidth: W }} role="img" aria-label={label}>{s.body}</svg>)}
        </div>
      ))}
    </div>
  );
  const notes = (
    <div>
      {drawn.map(({ axis, views }) => (
        <div key={axis} className={cls(axis)}>
          {views.map(({ c, s }) => <div key={c} className={c}><ScatterNotes chart={chart} panel={panel} axis={axis} keyed={s.keyed} /></div>)}
        </div>
      ))}
    </div>
  );
  return { plot, notes };
}

// ── the forest plot (one click down) ─────────────────────────────────────────
// Font sizes are in viewBox units, and each plot is drawn at close to 1:1, so f is the type size in CSS pixels.
type Row = { p: Point; diff: number; ci: number[] | null };

/** Engines sorted by their paired difference from the engine in use, which sits at zero. An engine with no
 *  paired difference (it shared no page with the engine in use) is left to the table. */
const forestRows = (panel: Panel): Row[] => (panel.points.some(p => p.production) ? panel.points
  .filter(p => p.production || p.vs)
  .map(p => ({ p, diff: p.vs?.diff ?? 0, ci: p.vs?.ci95 ?? null }))
  .sort((a, b) => b.diff - a.diff || Number(b.p.production) - Number(a.p.production) || a.p.order - b.p.order) : []);

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
  const { ticks } = niceTicks(lo, hi, maxTicks);
  return { lo: lo - span * 0.04, hi: hi + span * 0.04, cut, ticks };
}

/** The plot. Wide: one line per engine (name, mark, difference, price). Stacked, for a phone: two lines per engine
 *  (name and price, then mark and difference). No label is placed by the data, so none can overlap. */
function forest(panel: Panel, m: Measure, W: number, f: number, stacked: boolean): { H: number; body: ReactNode } {
  const rows = forestRows(panel);
  const band = panel.noise?.kind === 'spread' && panel.noise.band ? panel.noise.band : 0;
  const fs = rd(f * 0.92), r = rd(Math.max(3.5, f * 0.3)), gap = rd(f * 0.9);
  const quota = rows.some(x => x.p.cost && isSub(x.p));
  const diffW = f * 13.2, priceW = f * (quota ? 13.2 : 11.2);
  const x0 = rd(stacked ? r + 2 : f * 17.7 + gap);
  const x1 = rd(stacked ? W - diffW - gap : W - priceW - diffW - gap * 2);
  const { lo, hi, ticks } = forestScale(rows, band, Math.floor((x1 - x0) / (fs * 4.2)));
  const sx = (v: number) => rd(x0 + ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * (x1 - x0));
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
        const top = rd(head + i * rh);
        const cy = rd(stacked ? top + f * 2.35 : top + rh / 2);
        const y0 = rd(stacked ? top + f * 1.5 : top), y1 = rd(stacked ? top + f * 3.2 : top + rh);
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
            {diff >= lo && <circle cx={sx(diff)} cy={cy} r={r} fill={stateOf(p) === 'not_available' ? PAPER : c} stroke={c} strokeWidth={1.5} />}
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

/** What the forest plot's marks mean: only the marks this plot uses. */
function Key({ panel }: { panel: Panel }) {
  const rows = forestRows(panel);
  const quota = rows.some(x => x.p.cost && isSub(x.p));
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
      {quota && <span>API: the API price for the same requests, for comparison; a run on a subscription bills nothing</span>}
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

/** A self-contained figure for a slide: title, verdict, grade and sample, then the price scatter. Hidden on the page. */
function ExportSvg({ chart, panel, m }: { chart: Chart; panel: Panel; m: Measure }) {
  const W = 1040, f = 15, pad = 32, chars = 110;
  const head = [
    { t: m.exportTitle(chart), size: f * 1.5, weight: 700, fill: '#1c1917' },
    ...(panel.heading ? [{ t: panel.heading, size: f, weight: 400, fill: MUTED }] : []),
    { t: `${GRADE_LABEL[panel.grade.level]}: ${panel.grade.why}. ${sample(panel)}.`, size: f * 0.9, weight: 400, fill: MUTED },
    ...wrap(panel.verdict, Math.round(chars * 0.9)).map(t => ({ t, size: f, weight: 600, fill: '#1c1917' })),
  ];
  let y = pad;
  const headEls = head.map((l, i) => { y += l.size * 1.35; return <text key={i} x={pad} y={y} fontSize={l.size} fontWeight={l.weight} fill={l.fill}>{l.t}</text>; });
  const plotY = y + f;
  const plot = scatter(panel, m, panel.points.some(p => p.cost) ? 'price' : 'time', W - 2 * pad, f, 380);
  const keyLine = plot.keyed.map(([n, p]) => `${n} ${p.label}`).join(' · ');
  y = plotY + plot.H + f * 1.2;
  const notes = [
    'Filled: we can run it today. Hollow: not runnable today. Ringed: the engine in use. Solid line: frontier of what we can run; grey: of everything measured. †: run on a subscription, $0 billed, placed at the API price.',
    ...(keyLine ? [keyLine] : []),
  ].flatMap(t => wrap(t, chars + 10));
  const noteEls = notes.map((t, i) => <text key={i} x={pad} y={y + i * f * 1.2} fontSize={f * 0.8} fill={MUTED}>{t}</text>);
  y += notes.length * f * 1.2 + f * 0.6;
  const H = Math.ceil(y + pad);
  return (
    <svg id={svgId(m, chart, panel)} xmlns="http://www.w3.org/2000/svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fontFamily={FONT}>
      <rect width={W} height={H} fill={PAPER} />
      {headEls}
      <g transform={`translate(${pad} ${plotY})`}>{plot.body}</g>
      {noteEls}
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

/** What a rerun of the engine in use says about noise, in one sentence, on every panel: where no like-for-like rerun
 *  was made, it says so rather than draw a band (#6776). */
function noiseText(panel: Panel, m: Measure): string {
  const n = panel.noise;
  if (!n) return 'Rerun noise not measured: the engine in use was run once on these pages.';
  if (n.kind === 'spread') return `Rerun noise: ${m.fmtDiff(n.band!).slice(1)} ${m.diffUnit}, the spread between two runs of the engine in use (the shaded band).`;
  if (n.kind === 'identical') return `Rerun noise: none; a second run of the engine in use scored the same on all ${n.n} pages.`;
  if (n.kind === 'not_reproduced') return `Rerun noise: a second run of the engine in use differed by ${m.fmtDiff(n.diff!)} ${m.diffUnit}, so verdicts are withheld.`;
  return `Rerun noise not measured like for like: the second run is not used, because ${n.why}.`;
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
  const timed = panel.points.some(p => p.secs);
  return (
    <div className="overflow-x-auto"><table className="w-full max-w-4xl tabular-nums text-sm">
      <thead>
        <tr className="text-left text-stone-600 border-b border-stone-200 align-bottom">
          <th className="font-normal py-1 pr-2">engine</th>
          <th className="font-normal py-1 pr-2 text-right">{m.yColumn}</th>
          {panel.extraHeads.map(h => <th key={h.head} className="font-normal py-1 pr-2 text-right" title={h.title}>{h.head}</th>)}
          <th className="font-normal py-1 pr-2 text-right" title="mean difference per page from the engine in use, on the same pages, with its 95% interval">vs in use</th>
          <th className="font-normal py-1 pr-2 text-left">route</th>
          <th className="font-normal py-1 pr-2 text-left">today</th>
          {timed && <th className="font-normal py-1 pr-2 text-right" title="median seconds a page from the run's own meter, on these pages">seconds a page</th>}
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
            <td className="py-1 pr-2 text-stone-700 whitespace-nowrap">{p.roster ? ROSTER.route_labels[p.roster.route] : '–'}</td>
            <td className="py-1 pr-2 text-stone-700 whitespace-nowrap" title={stateText(p)}>{stateOf(p) === 'in_use' ? 'in use' : stateOf(p) === 'available' ? 'available' : 'not runnable'}</td>
            {timed && <td className="py-1 pr-2 text-right text-stone-700 whitespace-nowrap" title={p.secs ? `${p.secs.n} pages timed: ${p.secs.files.join(', ')}` : undefined}>{secsText(p)}</td>}
            <td className="py-1 text-right">
              {p.cost ? (
                <a href={`${GH}${p.cost.source}`} title={p.cost.detail} className="text-stone-800 hover:text-amber-800">
                  {isSub(p) ? <>{BILLED_NOTHING} <span className="text-stone-600 whitespace-nowrap">({usd(p.cost.usd_per_1k)} at the API price, for comparison)</span></> : usd(p.cost.usd_per_1k)}
                </a>
              ) : <span className="text-stone-600" title={p.no_price ?? undefined}>{isSub(p) ? BILLED_NOTHING : 'no price'}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

/** One panel: verdict, grade, the scatter, and one click down the difference from the engine in use, the table, and
 *  (for a primary panel) every other run. A panel not fit to rank keeps its scatter (no frontier) and its table, but no
 *  forest plot, because a plot of differences would read as a ranking the grade says the pages cannot support. */
function PanelView({ chart, panel, m, sub, caption, others = [], title }: { chart: Chart; panel: Panel; m: Measure; sub?: boolean; caption?: string | null; others?: Panel[]; title?: ReactNode }) {
  const id = chart.panels.indexOf(panel) > 0 ? anchorOf(m, chart, panel) : undefined;
  const provenance = panel.notes.join(' ');
  // the forest plot for each script's or language's primary run; another run's differences are in its table
  const rows = sub ? [] : forestRows(panel);
  const notFit = panel.grade.level === 'not_fit';
  // a slide figure for each script's or language's primary run only: the other runs would double the page's weight
  const exportable = !sub && !notFit;
  const sizes: [string, number, number, boolean][] = [['sm:hidden', 350, 12, true], ['hidden sm:block', 820, 13, false]];
  const label = `${m.title(chart)}: each engine's difference from the engine in use, for ${rows.length} engines. ${sample(panel)}. ${panel.verdict}`;
  const { plot, notes } = scatterParts(chart, panel, m);
  const more = [notFit || !rows.length ? 'full table' : 'Difference from the engine in use, full table', ...(others.length ? [`other runs (${others.length})`] : [])].join(', ');
  return (
    <div id={id} className="scroll-mt-24">
      <div className={`group/axis grid grid-cols-1 ${sub ? '' : 'lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-rows-[auto_1fr] lg:gap-x-8'}`}>
        <div className="lg:col-start-1 lg:row-start-1">
          {title}
          {sub && panel.heading && <div className="font-serif text-stone-900 text-lg">{panel.heading}</div>}
          <p className={`text-stone-900 leading-snug mt-1 max-w-3xl ${sub ? 'text-base' : 'text-base lg:text-lg'}`}>{panel.verdict}</p>
          {sub && <p className="text-sm mt-1"><GradeBadge g={panel.grade} /></p>}
        </div>
        <div className={`min-w-0 mt-2 lg:mt-0 ${sub ? '' : 'lg:col-start-2 lg:row-start-1 lg:row-span-2'}`}>{plot}</div>
        <div className={sub ? '' : 'lg:col-start-1 lg:row-start-2 lg:mt-2'}>{notes}</div>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-stone-700 hover:text-amber-800">{more[0].toUpperCase() + more.slice(1)}{provenance ? ', notes' : ''}</summary>
        <div className="mt-3 pl-4 border-l border-stone-200">
          {!sub && <p className="text-sm mb-1 max-w-3xl">{panel.heading && <span className="text-stone-900">{panel.heading}. </span>}<GradeBadge g={panel.grade} />.{panel.toDecide && <span className="text-stone-600"> To grade Decide: {listOf(panel.toDecide)}.</span>}</p>}
          <p className="text-sm text-stone-600 mb-2 max-w-3xl">{sample(panel)}. {noiseText(panel, m)}{caption ? ` ${caption}` : ''}</p>
          {!sub && chart.storedNow && (
            <p className="text-sm text-stone-600 mb-2 max-w-3xl">
              The engine in use is the one new pages get. What readers have now: {chart.storedNow} Much of the stored
              text was written by an earlier engine, so a result against the engine in use applies to new pages.
            </p>
          )}
          {!notFit && rows.length > 0 && (
            <>
              <p className="text-sm text-stone-600 max-w-3xl">{axisText(m)}</p>
              {sizes.map(([cls, W, f, stacked]) => {
                const fp = forest(panel, m, W, f, stacked);
                return <svg key={cls} viewBox={`0 0 ${W} ${fp.H}`} className={`w-full h-auto mt-1 ${cls}`} style={{ maxWidth: W }} role="img" aria-label={label}>{fp.body}</svg>;
              })}
              <Key panel={panel} />
            </>
          )}
          <div className="mt-4"><Table panel={panel} m={m} /></div>
          {provenance && <p className="text-sm text-stone-600 mt-2 max-w-3xl">{provenance}</p>}
          {exportable && <div className="text-sm text-stone-600 mt-2"><ParetoDownload svgId={svgId(m, chart, panel)} name={anchorOf(m, chart, panel)} /></div>}
          {(others.length > 0 || (!sub && chart.mentions.length > 0)) && (
            <div className="mt-8 space-y-10">
              <p className="font-serif text-xl text-stone-900">Other runs</p>
              <p className="text-sm text-stone-600 max-w-3xl -mt-8">Each is its own page set or judging round: compare engines within a run, never across runs. {chart.mentions.join(' ')}</p>
              {others.map(x => <PanelView key={x.kind} chart={chart} panel={x} m={m} sub />)}
            </div>
          )}
        </div>
      </details>
      {exportable && <div hidden aria-hidden="true"><ExportSvg chart={chart} panel={panel} m={m} /></div>}
    </div>
  );
}

/** One script or language: its primary panel, with every other run inside its disclosure. */
function Figure({ chart, m }: { chart: Chart; m: Measure }) {
  const [primary, ...rest] = chart.panels;
  return (
    <figure id={anchorOf(m, chart)} className="py-5 border-b border-stone-200 scroll-mt-16 min-w-0">
      <PanelView chart={chart} panel={primary} m={m} caption={chart.caption} others={rest} title={
        <h3 className="font-serif text-xl sm:text-2xl md:text-3xl text-stone-900 mb-1">
          {m.title(chart)}
          <a href={`#${anchorOf(m, chart)}`} className="ml-2 font-sans text-sm text-stone-400 hover:text-amber-800 no-underline" aria-label={`Link to the ${m.title(chart)} section`}>#</a>
        </h3>
      } />
    </figure>
  );
}

/** The sections of one half: every script or language whose primary panel is fit to read. */
export function ParetoPresentation({ m = OCR }: { m?: Measure }) {
  return <div>{m.charts.filter(fit).map(chart => <Figure key={chart.id} chart={chart} m={m} />)}</div>;
}

/** One half's "Not enough evidence yet": the scripts or languages whose primary panel is graded not fit, each with its
 *  n, what would make it decide-grade, and its runs (points still visible) inside; then the ones with no panel at all. */
export function NotEnoughEvidence({ m = OCR }: { m?: Measure }) {
  const thin = m.charts.filter(c => !fit(c));
  if (!thin.length && !m.noChart.length) return null;
  return (
    <details id={`${m.key}-not-enough`} className="mt-10 scroll-mt-16">
      <summary className="cursor-pointer font-serif text-xl text-stone-900 hover:text-amber-800">
        Not enough evidence yet ({thin.length + m.noChart.length} {m.key === 'ocr' ? 'scripts' : 'languages'})
      </summary>
      <ul className="mt-3 divide-y divide-stone-200 border-y border-stone-200 max-w-4xl text-stone-700">
        {thin.map(chart => {
          const p = chart.panels[0];
          return (
            <li key={chart.id} id={anchorOf(m, chart)} className="py-2 scroll-mt-24">
              <details>
                <summary className="cursor-pointer hover:text-amber-800">
                  <span className="text-stone-900">{m.title(chart)}</span> ({plural(p.n_works, 'work')}, {plural(p.n_pages, 'page')}): {p.grade.why}.
                  {p.toDecide && <span className="text-stone-600"> To decide: {listOf(p.toDecide)}.</span>}
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
        })}
        {m.noChart.map(n => (
          <li key={n.title} className="py-2"><span className="text-stone-900">{n.title}</span>: {n.why}.</li>
        ))}
      </ul>
    </details>
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

/** The short version of the roster, for /quality: the routes we can run today, in one sentence. */
export function RosterLine() {
  const groups = ROSTER.groups.filter(g => !['production', 'production-lane'].includes(g.id) && ROSTER.engines.some(r => r.group === g.id && r.available));
  return <>{listOf(groups.map(g => `${g.title} (${g.cost_basis})`))}</>;
}

/** What the marks mean, once per half and once above the small multiples. */
export function ChartLegend({ m, short = false }: { m?: Measure; short?: boolean }) {
  const item = 'inline-flex items-center gap-1';
  const sw = (filled: boolean, ring = false) => (
    <svg width="16" height="12" aria-hidden="true">
      {ring && <circle cx="8" cy="6" r="5.5" fill="none" stroke={PRODUCTION} strokeWidth="1.25" />}
      <circle cx="8" cy="6" r="3.5" fill={filled ? (ring ? PRODUCTION : INK) : PAPER} stroke={ring ? PRODUCTION : INK} strokeWidth="1.25" />
    </svg>
  );
  const line = (c: string, w: number) => <svg width="18" height="10" aria-hidden="true"><path d="M1 8 H8 V2 H17" fill="none" stroke={c} strokeWidth={w} /></svg>;
  const charts = m ? m.charts : [...OCR.charts, ...TRANSLATION.charts];
  const lane = charts.some(c => c.panels[0].points.some(p => p.production && p.roster?.in_use_route));
  return (
    <div className="text-sm text-stone-600 space-y-1">
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        <span className={item}>{sw(true)}we can run it today</span>
        <span className={item}>{sw(false)}not runnable today</span>
        <span className={item}>{sw(true, true)}engine in use</span>
        <span className={item}><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill={BETTER} /></svg>measured better than the engine in use</span>
        <span className={item}>{line(INK, 2)}frontier of what we can run</span>
        <span className={item}>{line(FAINT, 1.25)}frontier of everything measured</span>
      </p>
      {!short && <p>† On the price view, an engine run on a subscription is $0 billed; it is placed at the API price for the same requests, for comparison.</p>}
      {lane && <p>{ROSTER.production_lane_note}</p>}
    </div>
  );
}

/** Under one small multiple: what the panel says, naming only engines we can run (#6776). */
function MiniCaption({ chart, m }: { chart: Chart; m: Measure }) {
  const r = summaryRow(chart, m);
  const strong = (x: string | null) => <span className="text-stone-900 font-semibold">{x}</span>;
  return (
    <p className="text-sm text-stone-700 mt-1 leading-snug">
      {r.state === 'switch' && <>Better, and we can run it: {strong(r.best)}, {r.gain} {m.key === 'ocr' ? 'points' : 'on 1 to 5'}.</>}
      {r.state === 'toward' && <>Points toward {strong(r.best)}, {r.gain} {m.key === 'ocr' ? 'points' : 'on 1 to 5'}; directional.</>}
      {r.state === 'none' && <>Nothing we can run beats the engine in use, {r.inUse}.</>}
      {r.state === 'withheld' && <>Verdict withheld: two runs of the engine in use disagreed.</>}
    </p>
  );
}

/** One small scatter: the chart's primary panel on its default axis, at a phone's half column and a desktop quarter
 *  column, linking to its full section on /quality/pareto. */
function SmallScatter({ chart, m, href, withId }: { chart: Chart; m: Measure; href: string; withId: boolean }) {
  const panel = chart.panels[0];
  const axis = defaultAxis(panel);
  const sizes: [string, number, number, number][] = [['sm:hidden', 190, 11, 80], ['hidden sm:block', 300, 11, 115]];
  const label = `${m.title(chart)}, quality against ${axis === 'price' ? 'price' : 'time a page'}. ${sample(panel)}.`;
  const title = m.title(chart), cut = title.indexOf('· ') + 2;
  return (
    <li id={withId ? anchorOf(m, chart) : undefined} className="scroll-mt-24 min-w-0">
      <a href={`${href}#${anchorOf(m, chart)}`} className="block hover:text-amber-800">
        {/* on a phone the half's heading above carries the "OCR ·" / "Translation ·" */}
        <span className="font-serif text-base sm:text-lg text-stone-900 leading-tight">
          <span className="hidden sm:inline">{title.slice(0, cut)}</span>{title.slice(cut)}
        </span>
        {sizes.map(([cls, W, f, h]) => {
          const s = scatter(panel, m, axis, W, f, h, true);
          return s.body && <svg key={cls} viewBox={`0 0 ${W} ${s.H}`} className={`w-full h-auto ${cls}`} role="img" aria-label={label}>{s.body}</svg>;
        })}
      </a>
      <MiniCaption chart={chart} m={m} />
    </li>
  );
}

/** The small multiples: one per script, then one per language, each linking to its detail. On /quality the small
 *  scatters carry the old anchors (#pareto-latin, #pareto-translation-latin, …) so every old link still lands. */
export function SmallMultiples({ m, href = '', withIds = false }: { m: Measure; href?: string; withIds?: boolean }) {
  const thin = m.charts.filter(c => !fit(c));
  return (
    <div>
      <ul className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-6">
        {m.charts.filter(fit).map(chart => <SmallScatter key={chart.id} chart={chart} m={m} href={href} withId={withIds} />)}
      </ul>
      {thin.length > 0 && (
        <p className="text-sm text-stone-600 mt-4 max-w-3xl">
          Not enough evidence yet to draw a frontier:{' '}
          {thin.map((c, i) => (
            <span key={c.id} id={withIds ? anchorOf(m, c) : undefined} className="scroll-mt-24">
              {i ? ', ' : ''}<a href={`${href}#${anchorOf(m, c)}`} className="text-stone-800 hover:text-amber-800 underline decoration-stone-300">{c.title}</a> ({plural(c.panels[0].n_works, 'work')})
            </span>
          ))}.
        </p>
      )}
    </div>
  );
}

/** The summary on /quality: the small multiples of one half, with the old anchors. */
export default function ParetoCharts({ m = OCR }: { m?: Measure }): ReactNode {
  return (
    <div>
      <div className="mb-3"><ChartLegend m={m} short /></div>
      <SmallMultiples m={m} href="/quality/pareto" withIds />
    </div>
  );
}
