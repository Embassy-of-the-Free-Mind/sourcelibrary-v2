import type { ReactNode } from 'react';
import pareto from '@/data/ocr-pareto.json';
import xlate from '@/data/translation-pareto.json';
import ParetoDownload from './ParetoDownload';

// Cost against quality, one figure per script (OCR) or per language (translation) (#5983).
// Server-rendered SVG; the only client code is the download button. Exact values ride on <title>
// tooltips and on the table under each plot, which is the table view. Engines are told apart by
// NUMBER (keyed in the table), not by colour, so identity never depends on hue and labels cannot
// collide at 390 px. Colours are the house pair from /research/canon-gap/diagrams.tsx (validated
// there): teal for the frontier, amber for production. Every number comes from
// src/data/ocr-pareto.json (scripts/eval/build-ocr-pareto.mjs) or src/data/translation-pareto.json
// (scripts/eval/build-translation-pareto.mjs); the "what it means" sentence is composed from it.
//
// Used twice: the grids on /quality (anchors #pareto-<id>, #pareto-translation-<id>) and the
// presenting page /quality/pareto, one panel per screen. Type is sized to read at 14 px or more
// when the page is 1280 px wide.

const FRONTIER = '#0b9488';
const PRODUCTION = '#b45309';
const INK = '#44403c';
const MUTED = '#57534e';
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
const GH = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/';
// Below this many books, a figure says on its face that it is provisional.
const FEW_BOOKS = 30;

type Cost = { usd_per_1k: number; basis: string; detail: string; source: string };
/** One engine on one figure, in the measure-neutral shape the renderer draws. */
type Point = {
  engine: string; label: string; production: boolean; y: number | null; y_ci95: number[] | null;
  /** the ring: a share in 0–1 (invented words, or pages with a reversed statement) */
  ring: number | null; ring_text: string | null;
  cost: Cost | null; on_frontier?: boolean;
  /** an off-plot engine scored on only some of the pages, with production's score on the same pages */
  subset?: { n_pages: number; production_label: string; production_y: number; separate_read?: boolean } | null;
  note?: string | null;
};
type Panel = {
  kind: string; n_pages: number; n_books: number; frontier: boolean; frontier_note: string | null;
  /** a panel that is its own read (another packet) names itself; otherwise the heading follows `kind` */
  heading?: string;
  references: { stratum: string; reference: string; pages: number; date: string }[]; date: string;
  judges?: number; notes?: string[];
  placed: Point[]; no_cost: Point[];
};
export type Chart = {
  id: string; title: string; production_label: string; panels: Panel[]; not_on_shared_pages: { label: string; pages: number; why?: string }[]; not_tested: string[];
  /** engines to be run on these same pages on the subscription, not yet run (#6295) */
  pending?: string[];
};
const PENDING = 'CLI arm pending';
const pendingText = (c: Chart) => `${PENDING} (to run on these same pages through the command-line tool on the subscription, not yet run): ${c.pending!.join(', ')}.`;
type NoChartRow = { title: string; why: string; source: string };

/** Everything that differs between the OCR and the translation figures. No figures in here either. */
export type Measure = {
  key: 'ocr' | 'translation';
  anchor: string;
  title: (c: Chart) => string;
  exportTitle: (c: Chart) => string;
  explain: string;
  /** on the face of the plot, under the sample line */
  badge: string | null;
  yAxis: string;
  yTick: (v: number) => string;
  fmtY: (v: number | null | undefined, d?: number) => string;
  yRange: [number, number];
  step: (span: number) => number;
  yColumn: string;
  ringColumn: string;
  ringTitle: string;
  ringLegend: string;
  verb: string;
  unit: string;
  more: string;
  less: string;
  most: string;
  mostAdj: string;
  better: string;
  scoreWord: string;
  judgesNote: (p: Panel) => string;
  extraLegend: string;
  charts: Chart[];
  noChart: NoChartRow[];
};

const pctOf = (x: number | null | undefined, d = 1) => (x == null ? '–' : `${(x * 100).toFixed(d)}%`);

// ── adapters: each data file to the renderer's shape ─────────────────────────────────────────
type OcrPoint = { engine: string; label: string; production: boolean; accuracy: number | null; accuracy_ci95: number[] | null; invented: { median: number | null } | null; cost: Cost | null; on_frontier?: boolean };
type OcrPanel = Omit<Panel, 'placed' | 'no_cost'> & { placed: OcrPoint[]; no_cost: OcrPoint[] };
export function ocrPanel(p: OcrPanel): Panel {
  const pt = (x: OcrPoint): Point => ({
    engine: x.engine, label: x.label, production: x.production, y: x.accuracy, y_ci95: x.accuracy_ci95,
    ring: x.invented?.median ?? null, ring_text: x.invented?.median != null ? pctOf(x.invented.median, 0) : null,
    cost: x.cost, on_frontier: x.on_frontier,
  });
  return { ...p, placed: p.placed.map(pt), no_cost: p.no_cost.map(pt) };
}
type XPoint = {
  engine: string; label: string; production: boolean; fidelity: number; fidelity_ci95: number[] | null;
  reversals: { per_100: number; pages: number; n: number }; cost: Cost | null; on_frontier?: boolean;
  subset?: { n_pages: number; production_label: string; production_fidelity: number; separate_read?: boolean }; note?: string;
};
type XPanel = Omit<Panel, 'placed' | 'no_cost'> & { placed: XPoint[]; no_cost: XPoint[] };
export function translationPanel(p: XPanel): Panel {
  const pt = (x: XPoint): Point => ({
    engine: x.engine, label: x.label, production: x.production, y: x.fidelity, y_ci95: x.fidelity_ci95,
    ring: x.reversals.per_100 / 100, ring_text: x.reversals.per_100.toFixed(1),
    cost: x.cost, on_frontier: x.on_frontier, note: x.note ?? null,
    subset: x.subset ? { n_pages: x.subset.n_pages, production_label: x.subset.production_label, production_y: x.subset.production_fidelity, separate_read: x.subset.separate_read } : null,
  });
  return { ...p, placed: p.placed.map(pt), no_cost: p.no_cost.map(pt) };
}

type OcrData = { charts: (Omit<Chart, 'panels'> & { panels: OcrPanel[] })[]; no_chart: NoChartRow[] };
type XData = { charts: (Omit<Chart, 'panels'> & { panels: XPanel[] })[]; no_chart: NoChartRow[] };
const ocrData = pareto as unknown as OcrData;
const xData = xlate as unknown as XData;

const score = (v: number | null | undefined, d = 2) => (v == null ? '–' : v.toFixed(d));

export const OCR: Measure = {
  key: 'ocr', anchor: 'pareto-',
  title: c => c.title,
  exportTitle: c => `${c.title}: what it costs to read, against how well it reads`,
  explain:
    'Each dot is a reading engine. Further right costs more per 1,000 pages; higher reads more accurately. ' +
    'The line joins the engines that nothing else beats on both. The one we use now is amber.',
  badge: null,
  yAxis: '↑ accuracy against a typed edition',
  yTick: v => `${Math.round(v * 100)}%`,
  fmtY: pctOf,
  yRange: [0, 1],
  step: span => (span > 0.5 ? 0.2 : span > 0.2 ? 0.1 : span > 0.08 ? 0.05 : span > 0.03 ? 0.02 : 0.01),
  yColumn: 'accuracy', ringColumn: 'invented', ringTitle: "share of the engine's words absent from the reference",
  ringLegend: 'Dashed ring: share of words found nowhere in the reference (bigger ring, more invented text).',
  verb: 'read', unit: 'script',
  more: 'reads more accurately', less: 'reads less accurately', most: 'reads most accurately', mostAdj: 'most accurate', better: 'reads better', scoreWord: 'accuracy',
  judgesNote: () => '',
  extraLegend: 'Hollow dot: self-hosted, priced on inference time alone, so it reads low.',
  charts: ocrData.charts.map(c => ({ ...c, panels: c.panels.map(ocrPanel) })),
  noChart: ocrData.no_chart,
};

export const TRANSLATION: Measure = {
  key: 'translation', anchor: 'pareto-translation-',
  title: c => `${c.title} into English`,
  exportTitle: c => `${c.title} into English: translation cost against fidelity`,
  explain:
    'Each dot is a translation engine. Further right costs more per 1,000 pages; higher, the closer its English keeps ' +
    'to the meaning of a published human translation of the same page, scored from 1 to 5 by blind AI judges. ' +
    'The line joins the engines that nothing else beats on both. The one we use now is amber. ' +
    'The dashed ring grows with the share of pages where the English reverses a statement.',
  badge: 'Model-judged, not human-scored',
  yAxis: '↑ fidelity to a published translation (1–5)',
  yTick: v => v.toFixed(1),
  fmtY: score,
  yRange: [1, 5],
  step: span => (span > 0.8 ? 0.5 : span > 0.3 ? 0.2 : 0.1),
  yColumn: 'fidelity, 1–5', ringColumn: 'reversed per 100 pages', ringTitle: 'pages where either judge quoted a reversed statement, per 100 pages',
  ringLegend: 'Dashed ring: pages where the English reverses a statement, per 100 (bigger ring, more reversals).',
  verb: 'translated', unit: 'language',
  more: 'scores higher', less: 'scores lower', most: 'scores highest', mostAdj: 'highest-scoring', better: 'scores higher', scoreWord: 'fidelity',
  judgesNote: p => `Fidelity is the mean of ${p.judges === 1 ? 'one blind judge' : 'two blind judges'}, AI models reading our English beside the published one; it is not a human score and not accuracy against the page.`,
  extraLegend: '',
  charts: xData.charts.map(c => ({ ...c, panels: c.panels.map(translationPanel) })),
  noChart: xData.no_chart,
};

/** Kept for the OCR grid's callers. */
export const charts = OCR.charts;
export const EXPLAIN = OCR.explain;

const usd = (x: number) => `$${x < 0.1 ? x.toFixed(3) : x.toFixed(2)}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const listOf = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

const panelHeading = (p: Panel) => p.heading ?? (p.kind === 'most-pages' ? 'The engines read on the most pages' : 'The most engines read on the same pages');

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
  !!a.y_ci95 && !!b.y_ci95 && a.y_ci95[0] <= b.y_ci95[1] && b.y_ci95[0] <= a.y_ci95[1];

/** "Claude …, scored on 7 of these pages: 4.93, against 4.21 for … there." */
function subsetText(p: Point, m: Measure) {
  const s = p.subset!;
  return `on ${s.n_pages} of these pages${s.separate_read ? ' (graded in a separate read)' : ''} it scores ${m.fmtY(p.y)}, against ${m.fmtY(s.production_y)} for ${s.production_label} on the same pages`;
}

/** One or two sentences on what the figure means for this script or language, composed from the data. */
export function meaning(p: Panel, m: Measure = OCR): string {
  const pts = p.placed;
  if (!pts.length) return '';
  const best = pts.reduce((a, b) => (b.y! > a.y! ? b : a));
  const cheap = pts.reduce((a, b) => (b.cost!.usd_per_1k < a.cost!.usd_per_1k ? b : a));
  const prod = pts.find(x => x.production);
  // An engine with no measured cost is off the plot, but if it scores better, the sentence must say so.
  // One read on only some of the pages is compared with the production engine on those same pages.
  const beats = (x: Point) => x.y != null && (x.subset ? x.y > x.subset.production_y : x.y > best.y!);
  const better = p.no_cost.filter(beats).sort((a, b) => b.y! - a.y!);
  const offPlot = !better.length ? '' : better[0].subset
    ? ` ${better[0].label}, not plotted because its cost is not metered, ${m.better}: ${subsetText(better[0], m)}.`
    : ` ${better[0].label}, not plotted because its cost is not measured, ${m.better} still, at ${m.fmtY(better[0].y)}` +
      (better.length > 1 ? `, as ${better.length === 2 ? 'does one other' : `do ${better.length - 1} others`} without a measured cost.` : '.');
  if (!p.frontier) {
    return `Only ${plural(pts.length, 'engine')} with a measured cost ${m.verb} these pages, too few to draw a frontier` +
      (pts.length > 1 ? `; of ${pts.length === 2 ? 'the two' : 'those'}, ${best.label} ${m.more}${pts.some(x => x !== best && overlaps(x, best)) ? ', though the intervals overlap' : ''}.` : '.') + offPlot;
  }
  const out = [best === cheap
    ? `${best.label} is both the cheapest engine here and the ${m.mostAdj}.`
    : `${cheap.label} is the cheapest engine here; ${best.label} ${m.most}.`];
  if (prod) {
    if (prod === best) out.push(`The one we use now, ${prod.label}, is that ${m.mostAdj} engine.`);
    else if (prod.on_frontier) {
      out.push(`The one we use now, ${prod.label}, is on the frontier` +
        (overlaps(prod, best) ? `, and its interval overlaps ${best.label}’s.` : `, but ${m.less} than ${best.label}.`));
    } else {
      const beaters = pts.filter(b => b !== prod && b.cost!.usd_per_1k <= prod.cost!.usd_per_1k && b.y! >= prod.y!);
      const settled = beaters.some(b => !overlaps(b, prod));
      out.push(`The one we use now, ${prod.label}, is beaten on both cost and ${m.scoreWord} by ${listOf(beaters.map(b => b.label))}` +
        (settled ? '.' : ', though the intervals overlap, so that is not yet settled.'));
    }
  }
  return out.join(' ') + offPlot;
}

// ── geometry ─────────────────────────────────────────────────────────────────
// Font sizes are in viewBox units. The grid figure is 300 wide and shows at ≈ 400 px on /quality at
// 1280, so 11 units ≈ 14.7 px; at 390 px it shows at ≈ 310 px, so 11 units ≈ 11.4 px.
const X_TICKS = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30];

/** The plot itself, drawn into a W×H box: header lines (sample, badge, caution), axes, frontier, points. */
function PlotBody({ panel, m, W, H, f }: { panel: Panel; m: Measure; W: number; H: number; f: number }) {
  const pts = panel.placed;
  const warn = caution(panel);
  const heads = [m.badge, warn].filter(Boolean) as string[];
  // The y-axis title sits horizontally above the plot: rotated, it outgrows a short axis.
  const M = { l: f * 3.6, r: f * 1.2, t: f * (3.7 + heads.length * 1.3), b: f * 3.4 };
  const costs = pts.map(p => p.cost!.usd_per_1k);
  const x0 = Math.log10(Math.min(...costs) / 1.8), x1 = Math.log10(Math.max(...costs) * 1.8);
  const lows = pts.map(p => p.y_ci95?.[0] ?? p.y ?? m.yRange[1]);
  const highs = pts.map(p => p.y_ci95?.[1] ?? p.y ?? m.yRange[1]);
  // y range in whole steps that leave a margin; the measure picks a step that gives 3–6 ticks
  const step = m.step(Math.max(...highs) - Math.min(...lows));
  const y0 = Math.max(m.yRange[0], Math.floor((Math.min(...lows) - step / 4) / step) * step);
  const y1 = Math.min(m.yRange[1], Math.ceil((Math.max(...highs) + step / 4) / step) * step);
  const sx = (c: number) => M.l + ((Math.log10(c) - x0) / (x1 - x0)) * (W - M.l - M.r);
  const sy = (a: number) => H - M.b - ((a - y0) / (y1 - y0 || 1)) * (H - M.t - M.b);
  const yTicks: number[] = [];
  for (let v = y0; v <= y1 + 1e-9; v += step) yTicks.push(Math.round(v * 1000) / 1000);
  const xTicks = X_TICKS.filter(t => Math.log10(t) >= x0 && Math.log10(t) <= x1);
  const frontier = panel.frontier ? pts.filter(p => p.on_frontier) : [];
  const r = f * 0.62;

  return (
    <g fontFamily={FONT}>
      <text x={0} y={f} fontSize={f} fill={MUTED}>{sample(panel)}</text>
      {heads.map((h, i) => (
        <text key={h} x={0} y={f * (2.3 + i * 1.3)} fontSize={f} fontWeight={700} fill={h === warn ? PRODUCTION : INK}>{h}</text>
      ))}

      {/* grid + axes: recessive */}
      {yTicks.map(v => (
        <g key={`y${v}`}>
          <line x1={M.l} x2={W - M.r} y1={sy(v)} y2={sy(v)} stroke="#e7e5e4" strokeWidth={1} />
          <text x={M.l - f * 0.5} y={sy(v)} dy="0.32em" textAnchor="end" fontSize={f} fill={MUTED}>{m.yTick(v)}</text>
        </g>
      ))}
      {xTicks.map(t => (
        <g key={`x${t}`}>
          <line x1={sx(t)} x2={sx(t)} y1={M.t} y2={H - M.b} stroke="#f5f5f4" strokeWidth={1} />
          <text x={sx(t)} y={H - M.b + f * 1.3} textAnchor="middle" fontSize={f} fill={MUTED}>${t}</text>
        </g>
      ))}
      <text x={(M.l + W - M.r) / 2} y={H - f * 0.4} textAnchor="middle" fontSize={f} fill={INK}>cost per 1,000 pages →</text>
      <text x={0} y={M.t - f * 0.9} fontSize={f} fill={INK}>{m.yAxis}</text>

      {/* frontier */}
      {frontier.length >= 2 && (
        <polyline points={frontier.map(p => `${sx(p.cost!.usd_per_1k)},${sy(p.y!)}`).join(' ')} fill="none" stroke={FRONTIER} strokeWidth={f * 0.2} strokeLinejoin="round" />
      )}

      {pts.map((p, i) => {
        const cx = sx(p.cost!.usd_per_1k), cy = sy(p.y!);
        const ring = p.ring != null ? r + f * 0.2 + p.ring * f * 3 : null;
        const compute = p.cost!.basis === 'compute';
        const tip = `${p.label}${p.production ? ' (in production)' : ''}: ${m.scoreWord} ${m.fmtY(p.y)}${p.y_ci95 ? ` [${m.fmtY(p.y_ci95[0])}–${m.fmtY(p.y_ci95[1])}]` : ''}, ${usd(p.cost!.usd_per_1k)} per 1,000 pages (${p.cost!.basis})${p.ring_text ? `, ${m.ringColumn}: ${p.ring_text}` : ''}${p.on_frontier ? ', on the frontier' : ''}`;
        return (
          <g key={p.engine}>
            <title>{tip}</title>
            {p.y_ci95 && (
              <line x1={cx} x2={cx} y1={sy(p.y_ci95[0])} y2={sy(p.y_ci95[1])} stroke="#a8a29e" strokeWidth={f * 0.2} strokeLinecap="round" />
            )}
            {ring && <circle cx={cx} cy={cy} r={ring} fill="none" stroke="#a8a29e" strokeWidth={1} strokeDasharray="2 2" />}
            <circle cx={cx} cy={cy} r={r} fill={compute ? '#fff' : p.production ? PRODUCTION : INK} stroke={p.production ? PRODUCTION : INK} strokeWidth={compute ? 1.2 : 1.5} />
            <text x={cx} y={cy} dy="0.35em" textAnchor="middle" fontSize={f * 0.72} fontWeight={600} fill={compute ? INK : '#fff'}>{i + 1}</text>
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

const svgId = (m: Measure, chart: Chart, panel: Panel) => `${m.anchor}svg-${chart.id}-${panel.kind}`;
const anchorOf = (m: Measure, chart: Chart, panel?: Panel) =>
  `${m.anchor}${chart.id}${panel && chart.panels.indexOf(panel) > 0 ? `-${panel.kind}` : ''}`;

/** The key line for one engine, in the export and nowhere else. */
function keyLine(p: Point, i: number, nPlaced: number, m: Measure) {
  const n = i < nPlaced ? `${i + 1}  ` : '–  ';
  const tags = [p.production ? 'in use now' : '', p.on_frontier ? 'on the frontier' : ''].filter(Boolean).join(', ');
  if (p.subset) return `${n}${p.label}: not plotted; ${subsetText(p, m)}${p.note ? `. ${p.note[0].toUpperCase()}${p.note.slice(1)}.` : '.'}`;
  return `${n}${p.label}${tags ? ` (${tags})` : ''}: ${m.scoreWord} ${m.fmtY(p.y)}${p.y_ci95 ? ` [${m.fmtY(p.y_ci95[0], m.key === 'ocr' ? 0 : 2)}–${m.fmtY(p.y_ci95[1], m.key === 'ocr' ? 0 : 2)}]` : ''}; ${p.cost ? `${usd(p.cost.usd_per_1k)} per 1,000 pages${p.cost.basis === 'compute' ? ' (inference time only)' : ''}` : 'cost not measured'}${p.ring_text ? `; ${m.ringColumn}: ${p.ring_text}` : ''}`;
}

/** A self-contained figure for a slide: title, explanation, plot, key, notes. Hidden on the page. */
function ExportSvg({ chart, panel, m }: { chart: Chart; panel: Panel; m: Measure }) {
  const W = 960, f = 16, pad = 32, PH = 480, chars = 100;
  const lines: { t: string; size: number; weight?: number; fill: string; gap?: number }[] = [];
  const head = [
    { t: m.exportTitle(chart), size: f * 1.5, weight: 700, fill: '#1c1917' },
    ...(chart.panels.length > 1 ? [{ t: panelHeading(panel), size: f, fill: MUTED }] : []),
    ...wrap(m.explain, chars).map(t => ({ t, size: f, fill: INK })),
    ...wrap(meaning(panel, m), Math.round(chars * 0.9)).map(t => ({ t, size: f, weight: 600, fill: '#1c1917' })),
  ];
  let y = pad;
  const headEls = head.map((l, i) => { y += l.size * 1.35; return <text key={i} x={pad} y={y} fontSize={l.size} fontWeight={l.weight} fill={l.fill}>{l.t}</text>; });
  const plotY = y + f;
  y = plotY + PH + f * 0.5;
  for (const [i, p] of [...panel.placed, ...panel.no_cost].entries()) {
    wrap(keyLine(p, i, panel.placed.length, m), chars).forEach((t, j) => lines.push({ t: j ? `     ${t}` : t, size: f * 0.9, fill: INK }));
  }
  const nKey = lines.length;
  const notes = [
    `Bar: 95% interval. ${m.ringLegend}${m.extraLegend ? ` ${m.extraLegend}` : ''}`,
    `${sample(panel)}, ${m.verb} by every engine shown.${panel.n_books < panel.n_pages ? ' Pages of one book are not independent, so the intervals are too narrow.' : ''}${caution(panel) ? ` ${caution(panel)}.` : ''}`,
    ...(m.judgesNote(panel) ? [m.judgesNote(panel)] : []),
    ...(panel.notes || []).map(n => `${n}.`),
    `Reference: ${panel.references.map(r => `${r.reference} (${r.pages})`).join('; ')}. Scored ${panel.date}.`,
    ...(chart.pending?.length ? [pendingText(chart)] : []),
    `Not yet tested on this ${m.unit}: ${chart.not_tested.join(', ')}.`,
    `Source Library, sourcelibrary.org/quality/pareto#${anchorOf(m, chart, panel)}`,
  ];
  for (const n of notes) for (const t of wrap(n, Math.round(chars * 1.12))) lines.push({ t, size: f * 0.8, fill: MUTED });
  if (lines[nKey]) lines[nKey].gap = f * 0.6;
  const bodyEls = lines.map((l, i) => { y += l.size * 1.4 + (l.gap ?? 0); return <text key={i} x={pad} y={y} fontSize={l.size} fill={l.fill}>{l.t}</text>; });
  const H = Math.ceil(y + pad);
  return (
    <svg id={svgId(m, chart, panel)} xmlns="http://www.w3.org/2000/svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fontFamily={FONT}>
      <rect width={W} height={H} fill="#fff" />
      {headEls}
      <g transform={`translate(${pad} ${plotY})`}><PlotBody panel={panel} m={m} W={W - 2 * pad} H={PH} f={f} /></g>
      {bodyEls}
    </svg>
  );
}

function Tag({ color, children }: { color: string; children: ReactNode }) {
  return <span className="ml-1 text-[0.7rem] uppercase tracking-wider whitespace-nowrap" style={{ color }}>{children}</span>;
}

function PanelView({ chart, panel, m, present }: { chart: Chart; panel: Panel; m: Measure; present?: boolean }) {
  const refs = panel.references;
  const ciDigits = m.key === 'ocr' ? 0 : 2;
  // The figure scales to its column, so text and marks grow with it. Presenting, the column is
  // ≈ 680 px at 1280: a 560-unit viewBox keeps 11 units ≈ 13 px there. On a phone that box would
  // shrink text to ≈ 7 px, so below md the presenting view falls back to the 300-unit grid geometry.
  const label = `${m.title(chart)}: ${m.scoreWord} against cost per 1,000 pages for ${panel.placed.length} engines. ${sample(panel)}.${m.badge ? ` ${m.badge}.` : ''}${caution(panel) ? ` ${caution(panel)}.` : ''}`;
  const svg = ([W, H, f]: number[], className: string) => (
    <svg viewBox={`0 0 ${W} ${H}`} className={`w-full h-auto ${className}`} role="img" aria-label={label}>
      <PlotBody panel={panel} m={m} W={W} H={H} f={f} />
    </svg>
  );
  const plot = present
    ? <>{svg([300, 250, 11], 'md:hidden')}{svg([560, 360, 11], 'hidden md:block')}</>
    : svg([300, 250, 11], '');
  const table = (
    <div className="overflow-x-auto"><table className="w-full tabular-nums text-sm">
      <thead>
        <tr className="text-left text-stone-600 border-b border-stone-200">
          <th className="font-normal py-1 pr-1 w-5">#</th>
          <th className="font-normal py-1 pr-2">engine</th>
          <th className="font-normal py-1 pr-2 text-right">{m.yColumn} <span className="whitespace-nowrap">[95% interval]</span></th>
          <th className="font-normal py-1 pr-2 text-right">per 1,000 pages</th>
          <th className="font-normal py-1 text-right" title={m.ringTitle}>{m.ringColumn}</th>
        </tr>
      </thead>
      <tbody>
        {panel.placed.map((p, i) => (
          <tr key={p.engine} className="border-b border-stone-100 align-top">
            <td className="py-1 pr-1 text-stone-600">{i + 1}</td>
            <td className="py-1 pr-2 text-stone-800">
              {p.label}
              {p.production && <Tag color={PRODUCTION}>in use</Tag>}
              {p.on_frontier && <Tag color={FRONTIER}>frontier</Tag>}
            </td>
            <td className="py-1 pr-2 text-right text-stone-800">
              {m.fmtY(p.y)}
              {p.y_ci95 && <span className="text-stone-600 whitespace-nowrap"> [{m.fmtY(p.y_ci95[0], ciDigits)}–{m.fmtY(p.y_ci95[1], ciDigits)}]</span>}
            </td>
            <td className="py-1 pr-2 text-right whitespace-nowrap">
              {p.cost ? (
                <a href={`${GH}${p.cost.source}`} title={p.cost.detail} className="text-stone-800 hover:text-amber-800">
                  {usd(p.cost.usd_per_1k)}{p.cost.basis === 'compute' && <sup className="text-stone-600">c</sup>}
                </a>
              ) : <span className="text-stone-600">not measured</span>}
            </td>
            <td className="py-1 text-right text-stone-700">{p.ring_text ?? '–'}</td>
          </tr>
        ))}
        {panel.no_cost.map(p => (
          <tr key={p.engine} className="border-b border-stone-100 align-top">
            <td className="py-1 pr-1" />
            {p.subset ? (
              <td colSpan={4} className="py-1 text-stone-700">
                <span className="text-stone-800">{p.label}</span>, not plotted: {subsetText(p, m)}.{p.note && <span className="text-stone-600"> {p.note[0].toUpperCase() + p.note.slice(1)}.</span>}
              </td>
            ) : (<>
              <td className="py-1 pr-2 text-stone-800">{p.label}</td>
              <td className="py-1 pr-2 text-right text-stone-800">
                {m.fmtY(p.y)}
                {p.y_ci95 && <span className="text-stone-600 whitespace-nowrap"> [{m.fmtY(p.y_ci95[0], ciDigits)}–{m.fmtY(p.y_ci95[1], ciDigits)}]</span>}
              </td>
              <td className="py-1 pr-2 text-right whitespace-nowrap"><span className="text-stone-600">not measured</span></td>
              <td className="py-1 text-right text-stone-700">{p.ring_text ?? '–'}</td>
            </>)}
          </tr>
        ))}
        {chart.panels.indexOf(panel) === 0 && (chart.pending || []).map(label => (
          <tr key={`pending-${label}`} className="border-b border-stone-100 align-top">
            <td className="py-1 pr-1" />
            <td className="py-1 pr-2 text-stone-600">{label}</td>
            <td colSpan={3} className="py-1 text-right text-stone-600">{PENDING}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
  const notes = (
    <p className="text-stone-600 mt-2 leading-snug text-sm">
      {panel.n_books === panel.n_pages
        ? <>{panel.n_books} books, one page each, {m.verb} by every engine above.</>
        : <>{panel.n_pages} pages from {plural(panel.n_books, 'book')}, {m.verb} by every engine above; pages of one book are not independent, so the intervals are too narrow.</>}{' '}
      {m.judgesNote(panel) && <>{m.judgesNote(panel)} </>}
      {(panel.notes || []).map(n => <span key={n}>{n}. </span>)}
      Reference: {refs.map((r, i) => (
        <span key={r.stratum}>{i > 0 && '; '}{r.reference} ({r.pages})</span>
      ))}. Scored {panel.date}.
    </p>
  );
  const heading = chart.panels.length > 1 && (
    <div className={`uppercase tracking-wider text-stone-600 mb-1 ${present ? 'text-sm' : 'text-xs'}`}>{panelHeading(panel)}</div>
  );
  const says = <p className={`text-stone-900 leading-snug ${present ? 'text-lg' : 'text-sm font-medium mb-2'}`}>{meaning(panel, m)}</p>;
  const download = (
    <div className={`text-stone-600 mt-2 ${present ? 'text-base' : 'text-sm'}`}>
      <ParetoDownload svgId={svgId(m, chart, panel)} name={anchorOf(m, chart, panel)} />
    </div>
  );
  const hidden = <div hidden aria-hidden="true"><ExportSvg chart={chart} panel={panel} m={m} /></div>;

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

function Explain({ m, present }: { m: Measure; present?: boolean }) {
  return <p className={`text-stone-700 leading-snug ${present ? 'text-lg max-w-4xl' : 'text-sm mb-3'}`}>{m.explain}</p>;
}

function Caption({ chart, m, present }: { chart: Chart; m: Measure; present?: boolean }) {
  return (
    <figcaption className={`text-stone-600 mt-3 pt-3 border-t border-stone-100 leading-snug space-y-1 ${present ? 'text-base' : 'text-sm'}`}>
      {chart.not_on_shared_pages.length > 0 && (
        <p>{m.key === 'ocr' ? 'Also run here, on too few of the same pages to compare' : 'Also run, not compared here'}: {chart.not_on_shared_pages.map(e => `${e.label} (${plural(e.pages, 'page')}${e.why ? `: ${e.why}` : ''})`).join('; ')}.</p>
      )}
      {chart.pending?.length ? <p>{pendingText(chart)}</p> : null}
      <p>Not yet tested on this {m.unit}: {chart.not_tested.join(', ')}.</p>
    </figcaption>
  );
}

/** The anchor link shown beside a figure's title. */
function Anchor({ chart, m, base }: { chart: Chart; m: Measure; base: string }) {
  return (
    <a href={`${base}#${anchorOf(m, chart)}`} className="ml-2 font-sans text-sm text-stone-400 hover:text-amber-800 no-underline" aria-label={`Link to the ${m.title(chart)} chart`}>#</a>
  );
}

/** One script or language per screen, for presenting (/quality/pareto). Each panel takes its own screen.
 *  The first one is top-aligned: centred in a full screen, a short first chart left a blank band under the
 *  section heading that read as a chart failing to load (#6011). */
export function ParetoPresentation({ m = OCR }: { m?: Measure }) {
  return (
    <div>
      {m.charts.map(chart => chart.panels.map((panel, i) => (
        <figure key={`${chart.id}-${panel.kind}`} id={anchorOf(m, chart, panel)}
          className="min-h-screen flex flex-col justify-center first:justify-start py-8 border-b border-stone-200 scroll-mt-0">
          <div className="font-serif text-3xl md:text-4xl text-stone-900">
            {m.title(chart)}<Anchor chart={chart} m={m} base="/quality/pareto" />
          </div>
          <div className="text-base text-stone-600 mb-2">In use now: {chart.production_label}</div>
          <Explain m={m} present />
          <div className="mt-4"><PanelView chart={chart} panel={panel} m={m} present /></div>
          {i === chart.panels.length - 1 && <Caption chart={chart} m={m} present />}
        </figure>
      )))}
      <NoChart m={m} />
    </div>
  );
}

function NoChart({ m }: { m: Measure }) {
  return (
    <div className="mt-6 text-base text-stone-700 max-w-3xl">
      <p className="font-semibold text-stone-900 mb-1">No chart yet</p>
      <ul className="list-disc pl-5 space-y-1">
        {m.noChart.map(n => (
          <li key={n.title}>
            <span className="text-stone-900">{n.title}</span>: {n.why}.
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ParetoCharts({ m = OCR }: { m?: Measure }) {
  return (
    <div>
      <div className="grid gap-6 md:grid-cols-2">
        {m.charts.map(chart => (
          <figure key={chart.id} id={anchorOf(m, chart)} className="rounded-sm border border-stone-200 bg-white px-4 py-5 min-w-0 scroll-mt-24">
            <div className="font-serif text-xl text-stone-900">{m.title(chart)}<Anchor chart={chart} m={m} base="" /></div>
            <div className="text-sm text-stone-600 mb-2">In use now: {chart.production_label}</div>
            <Explain m={m} />
            {chart.panels.map(p => <PanelView key={p.kind} chart={chart} panel={p} m={m} />)}
            <Caption chart={chart} m={m} />
          </figure>
        ))}
      </div>
      <NoChart m={m} />
    </div>
  );
}
