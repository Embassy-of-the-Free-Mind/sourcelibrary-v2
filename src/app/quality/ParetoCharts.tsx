import type { ReactNode } from 'react';
import pareto from '@/data/ocr-pareto.json';
import ParetoDownload from './ParetoDownload';

// Cost against accuracy, one figure per script (#5983). Server-rendered SVG; the only client code
// is the download button. Exact values ride on <title> tooltips and on the table under each plot,
// which is the table view. Engines are told apart by NUMBER (keyed in the table), not by colour, so
// identity never depends on hue and labels cannot collide at 390 px. Colours are the house pair from
// /research/canon-gap/diagrams.tsx (validated there): teal for the frontier, amber for production.
// Every number comes from src/data/ocr-pareto.json (scripts/eval/build-ocr-pareto.mjs); the
// "what it means" sentence is composed from it, never typed.
//
// Used twice: the grid on /quality (anchors #pareto-<id>) and the presenting page /quality/pareto,
// one panel per screen. Type is sized to read at 14 px or more when the page is 1280 px wide.

const FRONTIER = '#0b9488';
const PRODUCTION = '#b45309';
const INK = '#44403c';
const MUTED = '#57534e';
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
const GH = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/';
// Below this many books, a figure says on its face that it is provisional.
const FEW_BOOKS = 30;

type Cost = { usd_per_1k: number; basis: string; detail: string; source: string };
type Point = {
  engine: string; label: string; production: boolean; median_cer: number | null; cer_ci95: number[] | null;
  accuracy: number | null; accuracy_ci95: number[] | null; invented: { median: number | null; n: number } | null;
  cost: Cost | null; on_frontier?: boolean;
};
type Panel = {
  kind: string; n_pages: number; n_books: number; frontier: boolean; frontier_note: string | null;
  references: { stratum: string; reference: string; pages: number; date: string }[]; date: string;
  placed: Point[]; no_cost: Point[];
};
export type Chart = { id: string; title: string; production_label: string; panels: Panel[]; not_on_shared_pages: { label: string; pages: number }[]; not_tested: string[] };

const data = pareto as unknown as { charts: Chart[]; no_chart: { title: string; why: string; source: string }[]; cost_sources: { metered: string } };
export const charts = data.charts;

const pct = (x: number | null | undefined, d = 1) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`);
const usd = (x: number) => `$${x < 0.1 ? x.toFixed(3) : x.toFixed(2)}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const listOf = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** The plain explanation, the same for every figure. */
export const EXPLAIN =
  'Each dot is a reading engine. Further right costs more per 1,000 pages; higher reads more accurately. ' +
  'The line joins the engines that nothing else beats on both. The one we use now is amber.';

const panelHeading = (p: Panel) => (p.kind === 'most-pages' ? 'The engines read on the most pages' : 'The most engines read on the same pages');

/** "28 pages from 28 books" — always on the face of the figure. */
function sample(p: Panel) {
  return p.n_books === p.n_pages ? `${plural(p.n_pages, 'page')}, one per book` : `${plural(p.n_pages, 'page')} from ${plural(p.n_books, 'book')}`;
}

/** The warning a figure must carry on its face, if any. */
function caution(p: Panel): string | null {
  if (!p.frontier) return 'Too few engines for a frontier';
  if (p.n_books < FEW_BOOKS) return `Only ${plural(p.n_books, 'book')}: provisional`;
  return null;
}

const overlaps = (a: Point, b: Point) =>
  !!a.accuracy_ci95 && !!b.accuracy_ci95 && a.accuracy_ci95[0] <= b.accuracy_ci95[1] && b.accuracy_ci95[0] <= a.accuracy_ci95[1];

/** One or two sentences on what the figure means for this script, composed from the data. */
export function meaning(p: Panel): string {
  const pts = p.placed;
  if (!pts.length) return '';
  const best = pts.reduce((a, b) => (b.accuracy! > a.accuracy! ? b : a));
  const cheap = pts.reduce((a, b) => (b.cost!.usd_per_1k < a.cost!.usd_per_1k ? b : a));
  const prod = pts.find(x => x.production);
  // An engine with no measured cost is off the plot, but if it reads better, the sentence must say so.
  const better = p.no_cost.filter(x => x.accuracy != null && x.accuracy > best.accuracy!).sort((a, b) => b.accuracy! - a.accuracy!);
  const offPlot = better.length
    ? ` ${better[0].label}, not plotted because its cost is not measured, reads better still, at ${pct(better[0].accuracy)}` +
      (better.length > 1 ? `, as ${better.length === 2 ? 'does one other' : `do ${better.length - 1} others`} without a measured cost.` : '.')
    : '';
  if (!p.frontier) {
    return `Only ${plural(pts.length, 'engine')} with a measured cost read these pages, too few to draw a frontier` +
      (pts.length > 1 ? `; of ${pts.length === 2 ? 'the two' : 'those'}, ${best.label} reads more accurately${pts.some(x => x !== best && overlaps(x, best)) ? ', though the intervals overlap' : ''}.` : '.') + offPlot;
  }
  const out = [best === cheap
    ? `${best.label} is both the cheapest engine here and the most accurate.`
    : `${cheap.label} is the cheapest engine here; ${best.label} reads most accurately.`];
  if (prod) {
    if (prod === best) out.push(`The one we use now, ${prod.label}, is that most accurate engine.`);
    else if (prod.on_frontier) {
      out.push(`The one we use now, ${prod.label}, is on the frontier` +
        (overlaps(prod, best) ? `, and its interval overlaps ${best.label}’s.` : `, but reads less accurately than ${best.label}.`));
    } else {
      const beaters = pts.filter(b => b !== prod && b.cost!.usd_per_1k <= prod.cost!.usd_per_1k && b.accuracy! >= prod.accuracy!);
      const settled = beaters.some(b => !overlaps(b, prod));
      out.push(`The one we use now, ${prod.label}, is beaten on both cost and accuracy by ${listOf(beaters.map(b => b.label))}` +
        (settled ? '.' : ', though the intervals overlap, so that is not yet settled.'));
    }
  }
  return out.join(' ') + offPlot;
}

// ── geometry ─────────────────────────────────────────────────────────────────
// Font sizes are in viewBox units. The grid figure is 300 wide and shows at ≈ 400 px on /quality at
// 1280, so 11 units ≈ 14.7 px; at 390 px it shows at ≈ 310 px, so 11 units ≈ 11.4 px.
const X_TICKS = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30];

/** The plot itself, drawn into a W×H box: header lines (sample, caution), axes, frontier, points. */
function PlotBody({ panel, W, H, f }: { panel: Panel; W: number; H: number; f: number }) {
  const pts = panel.placed;
  const warn = caution(panel);
  // The y-axis title sits horizontally above the plot: rotated, it outgrows a short axis.
  const M = { l: f * 3.6, r: f * 1.2, t: f * (warn ? 5 : 3.7), b: f * 3.4 };
  const costs = pts.map(p => p.cost!.usd_per_1k);
  const x0 = Math.log10(Math.min(...costs) / 1.8), x1 = Math.log10(Math.max(...costs) * 1.8);
  const lows = pts.map(p => p.accuracy_ci95?.[0] ?? p.accuracy ?? 1);
  const highs = pts.map(p => p.accuracy_ci95?.[1] ?? p.accuracy ?? 1);
  // y range in whole steps that leave a margin; step chosen so there are 3–6 ticks
  const span = Math.max(...highs) - Math.min(...lows);
  const step = span > 0.5 ? 0.2 : span > 0.2 ? 0.1 : span > 0.08 ? 0.05 : span > 0.03 ? 0.02 : 0.01;
  const y0 = Math.max(0, Math.floor((Math.min(...lows) - step / 4) / step) * step);
  const y1 = Math.min(1, Math.ceil((Math.max(...highs) + step / 4) / step) * step);
  const sx = (c: number) => M.l + ((Math.log10(c) - x0) / (x1 - x0)) * (W - M.l - M.r);
  const sy = (a: number) => H - M.b - ((a - y0) / (y1 - y0 || 1)) * (H - M.t - M.b);
  const yTicks: number[] = [];
  for (let v = y0; v <= y1 + 1e-9; v += step) yTicks.push(Math.round(v * 1000) / 1000);
  const xTicks = X_TICKS.filter(t => Math.log10(t) >= x0 && Math.log10(t) <= x1);
  const frontier = panel.frontier ? pts.filter(p => p.on_frontier) : [];
  const r = f * 0.8;

  return (
    <g fontFamily={FONT}>
      <text x={0} y={f} fontSize={f} fill={MUTED}>{sample(panel)}</text>
      {warn && <text x={0} y={f * 2.3} fontSize={f} fontWeight={700} fill={PRODUCTION}>{warn}</text>}

      {/* grid + axes: recessive */}
      {yTicks.map(v => (
        <g key={`y${v}`}>
          <line x1={M.l} x2={W - M.r} y1={sy(v)} y2={sy(v)} stroke="#e7e5e4" strokeWidth={1} />
          <text x={M.l - f * 0.5} y={sy(v)} dy="0.32em" textAnchor="end" fontSize={f} fill={MUTED}>{Math.round(v * 100)}%</text>
        </g>
      ))}
      {xTicks.map(t => (
        <g key={`x${t}`}>
          <line x1={sx(t)} x2={sx(t)} y1={M.t} y2={H - M.b} stroke="#f5f5f4" strokeWidth={1} />
          <text x={sx(t)} y={H - M.b + f * 1.3} textAnchor="middle" fontSize={f} fill={MUTED}>${t}</text>
        </g>
      ))}
      <text x={(M.l + W - M.r) / 2} y={H - f * 0.4} textAnchor="middle" fontSize={f} fill={INK}>cost per 1,000 pages →</text>
      <text x={0} y={M.t - f * 0.9} fontSize={f} fill={INK}>↑ accuracy against a typed edition</text>

      {/* frontier */}
      {frontier.length >= 2 && (
        <polyline points={frontier.map(p => `${sx(p.cost!.usd_per_1k)},${sy(p.accuracy!)}`).join(' ')} fill="none" stroke={FRONTIER} strokeWidth={f * 0.2} strokeLinejoin="round" />
      )}

      {pts.map((p, i) => {
        const cx = sx(p.cost!.usd_per_1k), cy = sy(p.accuracy!);
        const ring = p.invented?.median != null ? r + f * 0.2 + p.invented.median * f * 3 : null;
        const compute = p.cost!.basis === 'compute';
        const tip = `${p.label}${p.production ? ' (in production)' : ''}: accuracy ${pct(p.accuracy)}${p.accuracy_ci95 ? ` [${pct(p.accuracy_ci95[0])}–${pct(p.accuracy_ci95[1])}]` : ''}, ${usd(p.cost!.usd_per_1k)} per 1,000 pages (${p.cost!.basis})${p.invented?.median != null ? `, invented text ${pct(p.invented.median)}` : ''}${p.on_frontier ? ', on the frontier' : ''}`;
        return (
          <g key={p.engine}>
            <title>{tip}</title>
            {p.accuracy_ci95 && (
              <line x1={cx} x2={cx} y1={sy(p.accuracy_ci95[0])} y2={sy(p.accuracy_ci95[1])} stroke="#a8a29e" strokeWidth={f * 0.2} strokeLinecap="round" />
            )}
            {ring && <circle cx={cx} cy={cy} r={ring} fill="none" stroke="#a8a29e" strokeWidth={1} strokeDasharray="2 2" />}
            <circle cx={cx} cy={cy} r={r} fill={compute ? '#fff' : p.production ? PRODUCTION : INK} stroke={p.production ? PRODUCTION : INK} strokeWidth={compute ? 1.5 : 2} />
            <text x={cx} y={cy} dy="0.35em" textAnchor="middle" fontSize={f * 0.95} fontWeight={700} fill={compute ? INK : '#fff'}>{i + 1}</text>
            {/* a hit target bigger than the mark */}
            <circle cx={cx} cy={cy} r={r * 1.6} fill="transparent" />
          </g>
        );
      })}
    </g>
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

const svgId = (chart: Chart, panel: Panel) => `pareto-svg-${chart.id}-${panel.kind}`;

/** A self-contained figure for a slide: title, explanation, plot, key, notes. Hidden on the page. */
function ExportSvg({ chart, panel }: { chart: Chart; panel: Panel }) {
  const W = 960, f = 16, pad = 32, PH = 480, chars = 100;
  const lines: { t: string; size: number; weight?: number; fill: string; gap?: number }[] = [];
  const head = [
    { t: `${chart.title}: what it costs to read, against how well it reads`, size: f * 1.5, weight: 700, fill: '#1c1917' },
    ...(chart.panels.length > 1 ? [{ t: panelHeading(panel), size: f, fill: MUTED }] : []),
    ...wrap(EXPLAIN, chars).map(t => ({ t, size: f, fill: INK })),
    ...wrap(meaning(panel), Math.round(chars * 0.9)).map(t => ({ t, size: f, weight: 600, fill: '#1c1917' })),
  ];
  let y = pad;
  const headEls = head.map((l, i) => { y += l.size * 1.35; return <text key={i} x={pad} y={y} fontSize={l.size} fontWeight={l.weight} fill={l.fill}>{l.t}</text>; });
  const plotY = y + f;
  y = plotY + PH + f * 0.5;
  for (const [i, p] of [...panel.placed, ...panel.no_cost].entries()) {
    const n = i < panel.placed.length ? `${i + 1}  ` : '–  ';
    const tags = [p.production ? 'in use now' : '', p.on_frontier ? 'on the frontier' : ''].filter(Boolean).join(', ');
    const key = `${n}${p.label}${tags ? ` (${tags})` : ''}: accuracy ${pct(p.accuracy)}${p.accuracy_ci95 ? ` [${pct(p.accuracy_ci95[0], 0)}–${pct(p.accuracy_ci95[1], 0)}]` : ''}; ${p.cost ? `${usd(p.cost.usd_per_1k)} per 1,000 pages${p.cost.basis === 'compute' ? ' (inference time only)' : ''}` : 'cost not measured'}${p.invented?.median != null ? `; invented text ${pct(p.invented.median, 0)}` : ''}`;
    wrap(key, chars).forEach((t, j) => lines.push({ t: j ? `     ${t}` : t, size: f * 0.9, fill: INK }));
  }
  const nKey = lines.length;
  const notes = [
    'Bar: 95% interval. Dashed ring: share of words found nowhere in the reference (bigger ring, more invented text). Hollow dot: self-hosted, priced on inference time alone, so it reads low.',
    `${sample(panel)}, read by every engine shown.${panel.n_books < panel.n_pages ? ' Pages of one book are not independent, so the intervals are too narrow.' : ''}${caution(panel) ? ` ${caution(panel)}.` : ''}`,
    `Reference: ${panel.references.map(r => `${r.reference} (${r.pages})`).join('; ')}. Scored ${panel.date}.`,
    `Not yet tested on this script: ${chart.not_tested.join(', ')}.`,
    `Source Library, sourcelibrary.org/quality/pareto#pareto-${chart.id}${chart.panels.indexOf(panel) > 0 ? `-${panel.kind}` : ''}`,
  ];
  for (const n of notes) for (const t of wrap(n, Math.round(chars * 1.12))) lines.push({ t, size: f * 0.8, fill: MUTED });
  if (lines[nKey]) lines[nKey].gap = f * 0.6;
  const bodyEls = lines.map((l, i) => { y += l.size * 1.4 + (l.gap ?? 0); return <text key={i} x={pad} y={y} fontSize={l.size} fill={l.fill}>{l.t}</text>; });
  const H = Math.ceil(y + pad);
  return (
    <svg id={svgId(chart, panel)} xmlns="http://www.w3.org/2000/svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fontFamily={FONT}>
      <rect width={W} height={H} fill="#fff" />
      {headEls}
      <g transform={`translate(${pad} ${plotY})`}><PlotBody panel={panel} W={W - 2 * pad} H={PH} f={f} /></g>
      {bodyEls}
    </svg>
  );
}

function Tag({ color, children }: { color: string; children: ReactNode }) {
  return <span className="ml-1 text-[0.7rem] uppercase tracking-wider whitespace-nowrap" style={{ color }}>{children}</span>;
}

function PanelView({ chart, panel, present }: { chart: Chart; panel: Panel; present?: boolean }) {
  const refs = panel.references;
  // Presenting: wider and shorter, so the plot and its table fit one 1280×800 screen.
  const [W, H, f] = present ? [340, 230, 11] : [300, 250, 11];
  const plot = (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${chart.title}: accuracy against cost per 1,000 pages for ${panel.placed.length} engines. ${sample(panel)}.${caution(panel) ? ` ${caution(panel)}.` : ''}`}>
      <PlotBody panel={panel} W={W} H={H} f={f} />
    </svg>
  );
  const table = (
    <div className="overflow-x-auto"><table className="w-full tabular-nums text-sm">
      <thead>
        <tr className="text-left text-stone-600 border-b border-stone-200">
          <th className="font-normal py-1 pr-1 w-5">#</th>
          <th className="font-normal py-1 pr-2">engine</th>
          <th className="font-normal py-1 pr-2 text-right">accuracy <span className="whitespace-nowrap">[95% interval]</span></th>
          <th className="font-normal py-1 pr-2 text-right">per 1,000 pages</th>
          <th className="font-normal py-1 text-right" title="share of the engine's words absent from the reference">invented</th>
        </tr>
      </thead>
      <tbody>
        {[...panel.placed, ...panel.no_cost].map((p, i) => (
          <tr key={p.engine} className="border-b border-stone-100 align-top">
            <td className="py-1 pr-1 text-stone-600">{i < panel.placed.length ? i + 1 : ''}</td>
            <td className="py-1 pr-2 text-stone-800">
              {p.label}
              {p.production && <Tag color={PRODUCTION}>in use</Tag>}
              {p.on_frontier && <Tag color={FRONTIER}>frontier</Tag>}
            </td>
            <td className="py-1 pr-2 text-right text-stone-800">
              {pct(p.accuracy)}
              {p.accuracy_ci95 && <span className="text-stone-600 whitespace-nowrap"> [{pct(p.accuracy_ci95[0], 0)}–{pct(p.accuracy_ci95[1], 0)}]</span>}
            </td>
            <td className="py-1 pr-2 text-right whitespace-nowrap">
              {p.cost ? (
                <a href={`${GH}${p.cost.source}`} title={p.cost.detail} className="text-stone-800 hover:text-amber-800">
                  {usd(p.cost.usd_per_1k)}{p.cost.basis === 'compute' && <sup className="text-stone-600">c</sup>}
                </a>
              ) : <span className="text-stone-600">not measured</span>}
            </td>
            <td className="py-1 text-right text-stone-700">{pct(p.invented?.median, 0)}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
  const notes = (
    <p className="text-stone-600 mt-2 leading-snug text-sm">
      {panel.n_books === panel.n_pages
        ? <>{panel.n_books} books, one page each, read by every engine above.</>
        : <>{panel.n_pages} pages from {plural(panel.n_books, 'book')}, read by every engine above; pages of one book are not independent, so the intervals are too narrow.</>}{' '}
      Reference: {refs.map((r, i) => (
        <span key={r.stratum}>{i > 0 && '; '}{r.reference} ({r.pages})</span>
      ))}. Scored {panel.date}.
    </p>
  );
  const heading = chart.panels.length > 1 && (
    <div className={`uppercase tracking-wider text-stone-600 mb-1 ${present ? 'text-sm' : 'text-xs'}`}>{panelHeading(panel)}</div>
  );
  const says = <p className={`text-stone-900 leading-snug ${present ? 'text-lg' : 'text-sm font-medium mb-2'}`}>{meaning(panel)}</p>;
  const download = (
    <div className={`text-stone-600 mt-2 ${present ? 'text-base' : 'text-sm'}`}>
      <ParetoDownload svgId={svgId(chart, panel)} name={`pareto-${chart.id}${chart.panels.length > 1 ? `-${panel.kind}` : ''}`} />
    </div>
  );
  const hidden = <div hidden aria-hidden="true"><ExportSvg chart={chart} panel={panel} /></div>;

  if (present) {
    return (
      <div className="grid gap-8 lg:grid-cols-[4fr_3fr] items-start">
        <div className="min-w-0">{heading}{plot}{download}</div>
        <div className="min-w-0">{says}<div className="mt-4">{table}</div>{notes}</div>
        {hidden}
      </div>
    );
  }
  return (
    <div className="mt-5 first:mt-0">
      {heading}
      {says}
      {plot}
      {table}
      {notes}
      {download}
      {hidden}
    </div>
  );
}

function Explain({ present }: { present?: boolean }) {
  return <p className={`text-stone-700 leading-snug ${present ? 'text-lg max-w-4xl' : 'text-sm mb-3'}`}>{EXPLAIN}</p>;
}

function Caption({ chart, present }: { chart: Chart; present?: boolean }) {
  return (
    <figcaption className={`text-stone-600 mt-3 pt-3 border-t border-stone-100 leading-snug space-y-1 ${present ? 'text-base' : 'text-sm'}`}>
      {chart.not_on_shared_pages.length > 0 && (
        <p>Also run here, on too few of the same pages to compare: {chart.not_on_shared_pages.map(e => `${e.label} (${e.pages})`).join(', ')}.</p>
      )}
      <p>Not yet tested on this script: {chart.not_tested.join(', ')}.</p>
    </figcaption>
  );
}

/** The anchor link shown beside a figure's title. */
function Anchor({ chart, base }: { chart: Chart; base: string }) {
  return (
    <a href={`${base}#pareto-${chart.id}`} className="ml-2 font-sans text-sm text-stone-400 hover:text-amber-800 no-underline" aria-label={`Link to the ${chart.title} chart`}>#</a>
  );
}

/** One script per screen, for presenting (/quality/pareto). Each panel takes its own screen. */
export function ParetoPresentation() {
  return (
    <div>
      {charts.map(chart => chart.panels.map((panel, i) => (
        <figure key={`${chart.id}-${panel.kind}`} id={i === 0 ? `pareto-${chart.id}` : `pareto-${chart.id}-${panel.kind}`}
          className="min-h-screen flex flex-col justify-center py-8 border-b border-stone-200 scroll-mt-0">
          <div className="font-serif text-3xl md:text-4xl text-stone-900">
            {chart.title}<Anchor chart={chart} base="/quality/pareto" />
          </div>
          <div className="text-base text-stone-600 mb-2">In use now: {chart.production_label}</div>
          <Explain present />
          <div className="mt-4"><PanelView chart={chart} panel={panel} present /></div>
          {i === chart.panels.length - 1 && <Caption chart={chart} present />}
        </figure>
      )))}
      <NoChart />
    </div>
  );
}

function NoChart() {
  return (
    <div className="mt-6 text-base text-stone-700 max-w-3xl">
      <p className="font-semibold text-stone-900 mb-1">No chart yet</p>
      <ul className="list-disc pl-5 space-y-1">
        {data.no_chart.map(n => (
          <li key={n.title}>
            <span className="text-stone-900">{n.title}</span>: {n.why}.
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ParetoCharts() {
  return (
    <div>
      <div className="grid gap-6 md:grid-cols-2">
        {charts.map(chart => (
          <figure key={chart.id} id={`pareto-${chart.id}`} className="rounded-sm border border-stone-200 bg-white px-4 py-5 min-w-0 scroll-mt-24">
            <div className="font-serif text-xl text-stone-900">{chart.title}<Anchor chart={chart} base="" /></div>
            <div className="text-sm text-stone-600 mb-2">In use now: {chart.production_label}</div>
            <Explain />
            {chart.panels.map(p => <PanelView key={p.kind} chart={chart} panel={p} />)}
            <Caption chart={chart} />
          </figure>
        ))}
      </div>
      <NoChart />
    </div>
  );
}
