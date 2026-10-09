import type { ReactNode } from 'react';
import pareto from '@/data/ocr-pareto.json';
import xlate from '@/data/translation-pareto.json';
import ParetoDownload from './ParetoDownload';
import ParetoTips from './ParetoTips';

// Cost against quality, one figure per script (OCR) or per language (translation) (#5983, rebuilt in #6386).
// Server-rendered SVG; the only client code is the download button and the tooltip layer (ParetoTips).
// Every number, verdict and grade comes from src/data/ocr-pareto.json (scripts/eval/build-ocr-pareto.mjs) or
// src/data/translation-pareto.json (scripts/eval/build-translation-pareto.mjs): the renderer composes no claim.
//
// One figure per script or language: its PRIMARY panel, with the verdict sentence, the fitness grade and the
// sample above it, the plot, and a table sorted by score that keys the numbered dots. Every other run sits
// under a closed "Other runs" disclosure, drawn by the same component, smaller.
// Axes are fixed per section (accuracy from 0 to 100%, fidelity from 1 to 5), so charts compare at a glance.
// Colour follows the engine's role, never its rank: amber for the engine in use, teal for the frontier line,
// stone for everything else. Colours are hex rather than var(--…) because the download serialises the SVG
// outside the page's CSS; each one is a Tailwind token the page already uses (named beside it).

const FRONTIER = '#0b9488'; // teal-600
const PRODUCTION = '#b45309'; // amber-700
const INK = '#44403c'; // stone-700
const MUTED = '#57534e'; // stone-600
const FAINT = '#a8a29e'; // stone-400
const GRID = '#e7e5e4'; // stone-200
const SURFACE = '#ffffff'; // the card
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
};
type Grade = { level: 'decide' | 'directional' | 'not_fit'; why: string };
type Panel = {
  kind: string; role: string; heading: string | null; n_pages: number; n_works: number; reference: string;
  grade: Grade; frontier: boolean; noise: { band: number } | null; date: string | null; verdict: string;
  notes: string[]; points: Point[]; extraHeads: { head: string; title: string }[];
};
export type Chart = { id: string; title: string; production_label: string; caption: string | null; mentions: string[]; panels: Panel[] };
type NoChartRow = { title: string; why: string; source: string };

/** Everything that differs between the OCR and the translation figures. No figures in here either. */
export type Measure = {
  key: 'ocr' | 'translation';
  anchor: string;
  title: (c: Chart) => string;
  exportTitle: (c: Chart) => string;
  yAxis: string;
  yTick: (v: number) => string;
  fmtY: (v: number | null | undefined) => string;
  fmtDiff: (d: number) => string;
  /** the unit a difference is in, after the number */
  diffUnit: string;
  yRange: [number, number];
  step: number;
  yColumn: string;
  verb: string;
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
  words_not_in_ref: number | null; cost: RawCost; no_price?: string; on_frontier?: boolean; vs_in_use?: Vs; verdict?: Verdict;
};
type RawPanel<P> = {
  kind: string; role?: string; heading: string | null; n_pages: number; n_works: number; reference: string; grade: Grade;
  frontier: boolean; noise: { band: number } | null; date: string | null; verdict: string; notes?: string[]; placed: P[]; no_cost: P[];
};
type RawChart<P> = { id: string; title: string; production_label: string; caption?: string | null; mentions?: string[]; panels: RawPanel<P>[] };

const base = <P,>(p: RawPanel<P>, i: number) => ({
  kind: p.kind, role: p.role ?? (i === 0 ? 'primary' : 'secondary'), heading: p.heading, n_pages: p.n_pages, n_works: p.n_works,
  reference: p.reference, grade: p.grade, frontier: p.frontier, noise: p.noise, date: p.date, verdict: p.verdict, notes: p.notes ?? [],
});
const common = (x: { engine: string; label: string; production: boolean; cost: RawCost; no_price?: string; on_frontier?: boolean; vs_in_use?: Vs; verdict?: Verdict }) => ({
  engine: x.engine, label: x.label, production: x.production, cost: x.cost as Cost | null, no_price: x.no_price ?? null,
  on_frontier: !!x.on_frontier, vs: x.vs_in_use ?? null, verdict: x.verdict ?? null,
});
export function ocrPanel(p: RawPanel<OcrPoint>, i = 0): Panel {
  const all = [...p.placed, ...p.no_cost];
  const words = all.some(x => x.words_not_in_ref != null);
  return {
    ...base(p, i),
    extraHeads: [
      { head: 'over half wrong', title: 'share of pages with a character error rate above one half, failed reads included' },
      ...(words ? [{ head: 'words not in ref.', title: "median share of the engine's words found nowhere in the reference; a misspelling counts too" }] : []),
    ],
    points: all.map(x => ({ ...common(x), y: x.accuracy, y_ci95: x.accuracy_ci95, extra: [pctOf(x.fail_share, 0), ...(words ? [pctOf(x.words_not_in_ref, 0)] : [])] }))
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
    points: [...p.placed, ...p.no_cost].map(x => ({ ...common(x), y: x.fidelity, y_ci95: x.fidelity_ci95, extra: [x.reversals.per_100.toFixed(1)] }))
      .sort((a, b) => b.y - a.y || a.engine.localeCompare(b.engine)),
  };
}
const adapt = <P,>(c: RawChart<P>, f: (p: RawPanel<P>, i: number) => Panel): Chart => ({
  id: c.id, title: c.title, production_label: c.production_label, caption: c.caption ?? null, mentions: c.mentions ?? [], panels: c.panels.map(f),
});

type Data<P> = { charts: RawChart<P>[]; no_chart: NoChartRow[]; grade_rules: Record<Grade['level'], string> };
const ocrData = pareto as unknown as Data<OcrPoint>;
const xData = xlate as unknown as Data<XPoint>;

export const OCR: Measure = {
  key: 'ocr', anchor: 'pareto-',
  title: c => c.title,
  exportTitle: c => `${c.title}: what it costs to read, against how well it reads`,
  yAxis: '↑ accuracy against a typed text (median page)',
  yTick: v => `${Math.round(v * 100)}%`,
  fmtY: v => pctOf(v),
  fmtDiff: d => signed(Math.abs(d * 100).toFixed(1), d), diffUnit: 'points',
  yRange: [0, 1], step: 0.2,
  yColumn: 'accuracy', verb: 'read',
  charts: ocrData.charts.map(c => adapt(c, ocrPanel)),
  noChart: ocrData.no_chart,
  gradeRules: ocrData.grade_rules,
};

export const TRANSLATION: Measure = {
  key: 'translation', anchor: 'pareto-translation-',
  title: c => `${c.title} into English`,
  exportTitle: c => `${c.title} into English: translation cost against fidelity`,
  yAxis: '↑ fidelity to a published translation (1 to 5, model-judged)',
  yTick: v => v.toFixed(0),
  fmtY: v => (v == null ? '–' : v.toFixed(2)),
  fmtDiff: d => signed(Math.abs(d).toFixed(2), d), diffUnit: 'on the 1 to 5 scale',
  yRange: [1, 5], step: 1,
  yColumn: 'fidelity', verb: 'translated',
  charts: xData.charts.map(c => adapt(c, translationPanel)),
  noChart: xData.no_chart,
  gradeRules: xData.grade_rules,
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const GRADE_LABEL: Record<Grade['level'], string> = { decide: 'Decide', directional: 'Directional', not_fit: 'Not fit to rank' };
const GRADE_COLOR: Record<Grade['level'], string> = { decide: FRONTIER, directional: PRODUCTION, not_fit: MUTED };

/** "44 works · 44 pages · Wikisource transcriptions": always beside the verdict. */
const sample = (p: Panel) => `${plural(p.n_works, 'work')} · ${plural(p.n_pages, 'page')} · ${p.reference}`;
const ciText = (m: Measure, ci: number[] | null) => (ci ? `${m.fmtDiff(ci[0])} to ${m.fmtDiff(ci[1])}` : 'no interval');

// ── geometry ─────────────────────────────────────────────────────────────────
// Font sizes are in viewBox units, and each plot is drawn at close to 1:1, so f is the type size in CSS pixels.
const X_TICKS = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100];

type Box = { x0: number; y0: number; x1: number; y1: number };
const collide = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const inside = (a: Box, b: Box) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;
/** Width of a label, by character count: the server cannot measure text, so this errs wide. */
const textW = (s: string, fs: number, bold: boolean) => s.length * fs * (bold ? 0.62 : 0.58);

type Label = { text: string; x: number; y: number; anchor: 'start' | 'middle' | 'end'; leader: number[] | null; named: boolean };

/** Greedy label placement. The dots that must be named (the engine in use, then the frontier and any engine
 *  that beats it) go first and may sit further out on a leader line; every other dot gets its table number
 *  where it fits next to the dot, else nothing (the tooltip and the table still name it). A label never
 *  covers a dot, another label, or the plot's edge. */
function placeLabels(dots: { x: number; y: number; name: string; num: string; must: boolean }[], r: number, fs: number, area: Box): (Label | null)[] {
  const taken: Box[] = dots.map(d => ({ x0: d.x - r - 2, y0: d.y - r - 2, x1: d.x + r + 2, y1: d.y + r + 2 }));
  const out: (Label | null)[] = dots.map(() => null);
  const tryAt = (d: { x: number; y: number }, text: string, named: boolean, far: number): Label | null => {
    const w = textW(text, fs, named), g = r + fs * (far || 0.35), asc = fs * 0.75, desc = fs * 0.25;
    const spots: [Label['anchor'], number, number][] = [
      ['start', d.x + g, d.y + fs * 0.35], ['end', d.x - g, d.y + fs * 0.35], ['middle', d.x, d.y - g - desc], ['middle', d.x, d.y + g + asc],
      ['start', d.x + g * 0.6, d.y - g - desc], ['end', d.x - g * 0.6, d.y - g - desc], ['start', d.x + g * 0.6, d.y + g + asc], ['end', d.x - g * 0.6, d.y + g + asc],
    ];
    for (const [anchor, x, b] of spots) {
      const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
      const box = { x0: x0 - 3, y0: b - asc - 2, x1: x0 + w + 3, y1: b + desc + 2 };
      if (!inside(box, area) || taken.some(t => collide(t, box))) continue;
      taken.push(box);
      const lx = Math.min(Math.max(d.x, box.x0), box.x1), ly = Math.min(Math.max(d.y, box.y0), box.y1);
      const len = Math.hypot(lx - d.x, ly - d.y) || 1;
      return { text, x, y: b, anchor, named, leader: far ? [d.x + ((lx - d.x) * (r + 1)) / len, d.y + ((ly - d.y) * (r + 1)) / len, lx, ly] : null };
    }
    return null;
  };
  const order = dots.map((_, i) => i).sort((a, b) => Number(dots[b].must) - Number(dots[a].must) || a - b);
  for (const i of order) {
    const d = dots[i];
    out[i] = (d.must ? tryAt(d, d.name, true, 0) ?? tryAt(d, d.name, true, 1.8) ?? tryAt(d, d.name, true, 3.2) ?? tryAt(d, d.name, true, 4.8) : null)
      ?? tryAt(d, d.num, false, 0);
  }
  return out;
}

/** The plot: axes, the frontier, whiskers, dots, labels and the "no price" strip; with `tips`, a tooltip per dot. */
function PlotBody({ panel, m, W, H, f, tips }: { panel: Panel; m: Measure; W: number; H: number; f: number; tips?: boolean }) {
  const pts = panel.points;
  const priced = pts.filter(p => p.cost), unpriced = pts.filter(p => !p.cost);
  const M = { l: f * 3.2, r: f * 0.6, t: f * 1.8, b: f * 3.2 };
  const pad = f * 0.9;
  const strip = unpriced.length ? Math.max(f * 5, (W - M.l - M.r) * 0.14) : 0;
  const plotR = W - M.r - strip;
  const costs = priced.map(p => p.cost!.usd_per_1k);
  const x0 = costs.length ? Math.log10(Math.min(...costs) / 1.8) : -1, x1 = costs.length ? Math.log10(Math.max(...costs) * 1.8) : 1;
  const sx = (c: number) => M.l + pad + ((Math.log10(c) - x0) / (x1 - x0 || 1)) * (plotR - M.l - pad * 2);
  const [y0, y1] = m.yRange;
  const sy = (a: number) => H - M.b - pad - ((Math.min(Math.max(a, y0), y1) - y0) / (y1 - y0)) * (H - M.t - M.b - pad * 1.5);
  const yTicks: number[] = [];
  for (let v = y0; v <= y1 + 1e-9; v += m.step) yTicks.push(Math.round(v * 1000) / 1000);
  const xTicks = X_TICKS.filter(t => Math.log10(t) >= x0 && Math.log10(t) <= x1);
  const r = Math.max(4, f * 0.32);
  const fs = f * 0.85;
  // the strip: a column at the right edge; dots near in height step sideways so each stays countable
  const stripX = plotR + strip / 2;
  const at = pts.map(p => ({ x: p.cost ? sx(p.cost.usd_per_1k) : stripX, y: sy(p.y) }));
  const byY = unpriced.map(p => pts.indexOf(p)).sort((a, b) => at[a].y - at[b].y);
  byY.forEach((idx, k) => { const prev = byY[k - 1]; if (prev != null && Math.abs(at[prev].y - at[idx].y) < r * 2.4 && at[prev].x === stripX) at[idx].x = stripX + r * 2.6 * (k % 2 ? 1 : -1); });
  const frontier = panel.frontier ? priced.filter(p => p.on_frontier).sort((a, b) => a.cost!.usd_per_1k - b.cost!.usd_per_1k) : [];
  // the engine the verdict sentence names: the one that beats the engine in use by the most
  const lead = pts.filter(p => p.verdict === 'better').sort((a, b) => b.vs!.diff - a.vs!.diff)[0];
  const labels = placeLabels(
    pts.map((p, i) => ({ ...at[i], name: p.label, num: String(i + 1), must: p.production || p === lead || (frontier.length >= 2 && p.on_frontier) })),
    r, fs, { x0: M.l + 2, y0: M.t - f * 0.4, x1: W, y1: H - M.b },
  );

  return (
    <g fontFamily={FONT}>
      <text x={0} y={f * 0.9} fontSize={f * 0.9} fill={INK}>{m.yAxis}</text>
      {yTicks.map(v => (
        <g key={`y${v}`}>
          <line x1={M.l} x2={W - M.r} y1={sy(v)} y2={sy(v)} stroke={GRID} strokeWidth={1} />
          <text x={M.l - f * 0.4} y={sy(v)} dy="0.32em" textAnchor="end" fontSize={fs} fill={MUTED}>{m.yTick(v)}</text>
        </g>
      ))}
      <line x1={M.l} x2={plotR} y1={H - M.b} y2={H - M.b} stroke={FAINT} strokeWidth={1} />
      {xTicks.map(t => (
        <g key={`x${t}`}>
          <line x1={sx(t)} x2={sx(t)} y1={H - M.b} y2={H - M.b + f * 0.3} stroke={FAINT} strokeWidth={1} />
          <text x={sx(t)} y={H - M.b + f * 1.25} textAnchor="middle" fontSize={fs} fill={MUTED}>${t}</text>
        </g>
      ))}
      <text x={(M.l + plotR) / 2} y={H - f * 0.4} textAnchor="middle" fontSize={f * 0.9} fill={INK}>cost per 1,000 pages, log scale →</text>
      {strip > 0 && (
        <g>
          <line x1={plotR} x2={plotR} y1={M.t} y2={H - M.b} stroke={FAINT} strokeWidth={1} strokeDasharray="3 3" />
          <text x={stripX} y={H - M.b + f * 1.25} textAnchor="middle" fontSize={fs} fill={MUTED}>no price</text>
        </g>
      )}

      {frontier.length >= 2 && (
        <polyline points={frontier.map(p => `${at[pts.indexOf(p)].x},${at[pts.indexOf(p)].y}`).join(' ')} fill="none" stroke={FRONTIER} strokeWidth={Math.max(1.5, f * 0.14)} strokeLinejoin="round" />
      )}

      {pts.map((p, i) => p.y_ci95 && (
        <g key={`ci-${p.engine}`} stroke={FAINT} strokeWidth={1}>
          <line x1={at[i].x} x2={at[i].x} y1={sy(p.y_ci95[0])} y2={sy(p.y_ci95[1])} />
          <line x1={at[i].x - 2} x2={at[i].x + 2} y1={sy(p.y_ci95[0])} y2={sy(p.y_ci95[0])} />
          <line x1={at[i].x - 2} x2={at[i].x + 2} y1={sy(p.y_ci95[1])} y2={sy(p.y_ci95[1])} />
        </g>
      ))}

      {/* dots on a ring of the card colour so a cluster stays countable; the one in use last, on top */}
      {pts.map((p, i) => [p, i] as const).sort(([a], [b]) => Number(a.production) - Number(b.production)).map(([p, i]) => {
        const hollow = p.cost?.basis === 'quota';
        const c = p.production ? PRODUCTION : INK;
        return (
          <g key={p.engine}>
            {!tips && <title>{tipLines(p, m).join('; ')}</title>}
            <circle cx={at[i].x} cy={at[i].y} r={r + 2} fill={SURFACE} />
            <circle cx={at[i].x} cy={at[i].y} r={hollow ? r - 0.75 : r} fill={hollow ? SURFACE : c} stroke={c} strokeWidth={hollow ? 1.5 : 0} />
          </g>
        );
      })}

      {labels.map((l, i) => l && (
        <g key={`l-${pts[i].engine}`}>
          {l.leader && <line x1={l.leader[0]} y1={l.leader[1]} x2={l.leader[2]} y2={l.leader[3]} stroke={FAINT} strokeWidth={1} />}
          <text x={l.x} y={l.y} textAnchor={l.anchor} fontSize={fs} fontWeight={l.named ? 600 : 400}
            fill={pts[i].production ? PRODUCTION : l.named ? INK : MUTED}
            stroke={SURFACE} strokeWidth={3} strokeLinejoin="round" paintOrder="stroke">{l.text}</text>
        </g>
      ))}

      {tips && (
        <ParetoTips tips={pts.map((p, i) => ({ ...at[i], lines: tipLines(p, m) }))} W={W} H={H} f={f} hit={Math.max(12, f * 1.1)}
          ink={INK} muted={MUTED} surface={SURFACE} border={FAINT} />
      )}
    </g>
  );
}

const costText = (p: Point) => (p.cost ? `${usd(p.cost.usd_per_1k)} per 1,000 pages${p.cost.basis === 'quota' ? ' (nothing billed: subscription quota)' : ''}` : `no price: ${p.no_price}`);

/** A dot's tooltip: who it is, its score with interval, the paired difference, its cost. */
function tipLines(p: Point, m: Measure): string[] {
  return [
    `${p.label}${p.production ? ' (in use now)' : ''}`,
    `${m.yColumn} ${m.fmtY(p.y)}${p.y_ci95 ? ` (95% interval ${m.fmtY(p.y_ci95[0])} to ${m.fmtY(p.y_ci95[1])})` : ''}`,
    ...(p.vs ? [`against the engine in use: ${m.fmtDiff(p.vs.diff)} (${ciText(m, p.vs.ci95)})`] : []),
    costText(p),
  ];
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

/** A self-contained figure for a slide: title, verdict, grade and sample, plot, key. Hidden on the page. */
function ExportSvg({ chart, panel, m }: { chart: Chart; panel: Panel; m: Measure }) {
  const W = 960, f = 16, pad = 32, PH = 460, chars = 100;
  const head = [
    { t: m.exportTitle(chart), size: f * 1.5, weight: 700, fill: '#1c1917' },
    ...(panel.heading ? [{ t: panel.heading, size: f, weight: 400, fill: MUTED }] : []),
    { t: `${GRADE_LABEL[panel.grade.level]}: ${panel.grade.why}. ${sample(panel)}.`, size: f * 0.9, weight: 400, fill: MUTED },
    ...wrap(panel.verdict, Math.round(chars * 0.9)).map(t => ({ t, size: f, weight: 600, fill: '#1c1917' })),
  ];
  let y = pad;
  const headEls = head.map((l, i) => { y += l.size * 1.35; return <text key={i} x={pad} y={y} fontSize={l.size} fontWeight={l.weight} fill={l.fill}>{l.t}</text>; });
  const plotY = y + f;
  y = plotY + PH + f * 0.5;
  const lines: string[] = [];
  panel.points.forEach((p, i) => lines.push(...wrap(`${i + 1}  ${p.label}${p.production ? ' (in use now)' : ''}: ${m.yColumn} ${m.fmtY(p.y)}; ${p.vs ? `against the engine in use ${m.fmtDiff(p.vs.diff)} (${ciText(m, p.vs.ci95)}); ` : ''}${costText(p)}`, chars)));
  lines.push(`Source Library, sourcelibrary.org/quality/pareto#${anchorOf(m, chart, panel)}. Scored ${panel.date ?? ''}.`);
  const bodyEls = lines.map((t, i) => { y += f * 0.85 * 1.4; return <text key={i} x={pad} y={y} fontSize={f * 0.85} fill={i === lines.length - 1 ? MUTED : INK}>{t}</text>; });
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

function GradeBadge({ g }: { g: Grade }) {
  return (
    <span className="whitespace-nowrap">
      <span className="uppercase tracking-wider text-[0.75rem] font-semibold" style={{ color: GRADE_COLOR[g.level] }}>{GRADE_LABEL[g.level]}</span>
      <span className="text-stone-600">: {g.why}</span>
    </span>
  );
}

/** The one-line key under each plot: only the marks this plot uses. */
function Key({ panel }: { panel: Panel }) {
  const quota = panel.points.some(p => p.cost?.basis === 'quota');
  const frontier = panel.frontier && panel.points.filter(p => p.on_frontier).length >= 2;
  const item = 'inline-flex items-center gap-1 whitespace-nowrap';
  return (
    <p className="text-sm text-stone-600 mt-1 flex flex-wrap gap-x-4 gap-y-1">
      <span className={item}><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill={PRODUCTION} /></svg>in use now</span>
      {frontier && <span className={item}><svg width="16" height="10" aria-hidden="true"><line x1="1" x2="15" y1="5" y2="5" stroke={FRONTIER} strokeWidth="2" /></svg>frontier</span>}
      {quota && <span className={item}><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3.5" fill="none" stroke={INK} strokeWidth="1.5" /></svg>nothing billed, subscription quota</span>}
      <span className={item}><svg width="8" height="12" aria-hidden="true"><g stroke={FAINT} strokeWidth="1"><line x1="4" x2="4" y1="1" y2="11" /><line x1="2" x2="6" y1="1" y2="1" /><line x1="2" x2="6" y1="11" y2="11" /></g></svg>95% interval</span>
    </p>
  );
}

function VsCell({ p, m }: { p: Point; m: Measure }) {
  if (p.production) return <span className="text-stone-600">in use</span>;
  if (!p.vs) return <span className="text-stone-600">{'–'}</span>;
  const strong = p.verdict === 'better' || p.verdict === 'worse';
  return (
    <span className={strong ? 'text-stone-900 font-semibold' : 'text-stone-700'}>
      {m.fmtDiff(p.vs.diff)}
      {p.vs.ci95 && <span className="text-stone-600 font-normal whitespace-nowrap"> ({m.fmtDiff(p.vs.ci95[0])} to {m.fmtDiff(p.vs.ci95[1])})</span>}
    </span>
  );
}

function Table({ panel, m }: { panel: Panel; m: Measure }) {
  return (
    <div className="overflow-x-auto"><table className="w-full tabular-nums text-sm">
      <thead>
        <tr className="text-left text-stone-600 border-b border-stone-200 align-bottom">
          <th className="font-normal py-1 pr-1 w-5">#</th>
          <th className="font-normal py-1 pr-2">engine</th>
          <th className="font-normal py-1 pr-2 text-right">{m.yColumn}</th>
          {panel.extraHeads.map(h => <th key={h.head} className="font-normal py-1 pr-2 text-right" title={h.title}>{h.head}</th>)}
          <th className="font-normal py-1 pr-2 text-right" title="mean difference per page from the engine in use, on the same pages, with its 95% interval">vs in use</th>
          <th className="font-normal py-1 text-right">per 1,000 pages</th>
        </tr>
      </thead>
      <tbody>
        {panel.points.map((p, i) => (
          <tr key={p.engine} className="border-b border-stone-100 align-top">
            <td className="py-1 pr-1 text-stone-600">{i + 1}</td>
            <td className="py-1 pr-2" style={{ color: p.production ? PRODUCTION : undefined }}>{p.label}</td>
            <td className="py-1 pr-2 text-right text-stone-800">{m.fmtY(p.y)}</td>
            {p.extra.map((c, k) => <td key={k} className="py-1 pr-2 text-right text-stone-700">{c ?? '–'}</td>)}
            <td className="py-1 pr-2 text-right"><VsCell p={p} m={m} /></td>
            <td className="py-1 text-right whitespace-nowrap">
              {p.cost ? (
                <a href={`${GH}${p.cost.source}`} title={p.cost.detail} className="text-stone-800 hover:text-amber-800">
                  {usd(p.cost.usd_per_1k)}{p.cost.basis === 'quota' && <sup className="text-stone-600">q</sup>}
                </a>
              ) : <span className="text-stone-600" title={p.no_price ?? undefined}>no price</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

function PanelView({ chart, panel, m, small }: { chart: Chart; panel: Panel; m: Measure; small?: boolean }) {
  // Drawn twice at close to 1:1, so the type holds its size: a phone's column and a wider one.
  const sizes: [string, number, number, number][] = small
    ? [['sm:hidden', 320, 260, 12], ['hidden sm:block', 520, 300, 13]]
    : [['sm:hidden', 340, 320, 12], ['hidden sm:block', 640, 380, 14]];
  const label = `${m.title(chart)}: ${m.yColumn} against cost per 1,000 pages for ${panel.points.length} engines. ${sample(panel)}. ${panel.verdict}`;
  return (
    <div id={chart.panels.indexOf(panel) > 0 ? anchorOf(m, chart, panel) : undefined} className="scroll-mt-24">
      {panel.heading && <div className="font-serif text-lg text-stone-900">{panel.heading}</div>}
      <p className="text-sm mt-1"><GradeBadge g={panel.grade} /></p>
      <p className="text-sm text-stone-600">{sample(panel)}{panel.noise ? `. A repeat run of the engine in use moved ${m.fmtDiff(panel.noise.band).slice(1)} ${m.diffUnit}` : ''}.</p>
      <p className={`text-stone-900 leading-snug mt-2 ${small ? 'text-base' : 'text-lg'}`}>{panel.verdict}</p>
      <div className={`grid gap-6 mt-3 items-start ${small ? '' : 'lg:grid-cols-2'}`}>
        <div className="min-w-0">
          {sizes.map(([cls, W, H, f]) => (
            <svg key={cls} viewBox={`0 0 ${W} ${H}`} className={`w-full h-auto ${cls}`} style={small ? { maxWidth: W } : undefined} role="img" aria-label={label}>
              <PlotBody panel={panel} m={m} W={W} H={H} f={f} tips />
            </svg>
          ))}
          <Key panel={panel} />
          <div className="text-sm text-stone-600 mt-1"><ParetoDownload svgId={svgId(m, chart, panel)} name={anchorOf(m, chart, panel)} /></div>
        </div>
        <div className="min-w-0">
          <Table panel={panel} m={m} />
          {panel.notes.length > 0 && <p className="text-sm text-stone-600 mt-2">{panel.notes.join(' ')}</p>}
        </div>
      </div>
      <div hidden aria-hidden="true"><ExportSvg chart={chart} panel={panel} m={m} /></div>
    </div>
  );
}

/** The anchor link shown beside a figure's title. */
function Anchor({ chart, m, base }: { chart: Chart; m: Measure; base: string }) {
  return (
    <a href={`${base}#${anchorOf(m, chart)}`} className="ml-2 font-sans text-sm text-stone-400 hover:text-amber-800 no-underline" aria-label={`Link to the ${m.title(chart)} chart`}>#</a>
  );
}

/** One script or language: its primary panel, then every other run under a closed disclosure. */
function Figure({ chart, m, base }: { chart: Chart; m: Measure; base: string }) {
  const [primary, ...rest] = chart.panels;
  return (
    <figure id={anchorOf(m, chart)} className="py-10 border-b border-stone-200 scroll-mt-16 min-w-0">
      <div className="font-serif text-2xl md:text-3xl text-stone-900">{m.title(chart)}<Anchor chart={chart} m={m} base={base} /></div>
      <PanelView chart={chart} panel={primary} m={m} />
      {chart.caption && <figcaption className="text-sm text-stone-600 mt-3 max-w-3xl">{chart.caption}</figcaption>}
      {(rest.length > 0 || chart.mentions.length > 0) && (
        <details className="mt-5 group">
          <summary className="cursor-pointer text-stone-700 hover:text-amber-800">
            Other runs ({rest.length}), not comparable with this chart
          </summary>
          <div className="mt-3 space-y-10 pl-4 border-l border-stone-200">
            {chart.mentions.map(t => <p key={t} className="text-sm text-stone-600">{t}</p>)}
            {rest.map(p => <PanelView key={p.kind} chart={chart} panel={p} m={m} small />)}
          </div>
        </details>
      )}
    </figure>
  );
}

function NoChart({ m }: { m: Measure }) {
  if (!m.noChart.length) return null;
  return (
    <div className="mt-8 text-base text-stone-700 max-w-3xl">
      <p className="font-semibold text-stone-900 mb-1">No chart yet</p>
      <ul className="list-disc pl-5 space-y-1">
        {m.noChart.map(n => <li key={n.title}><span className="text-stone-900">{n.title}</span>: {n.why}.</li>)}
      </ul>
    </div>
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

/** The presenting page (/quality/pareto): every script or language, one figure each. */
export function ParetoPresentation({ m = OCR }: { m?: Measure }) {
  return (
    <div>
      {m.charts.map(chart => <Figure key={chart.id} chart={chart} m={m} base="/quality/pareto" />)}
      <NoChart m={m} />
    </div>
  );
}

/** The grid on /quality: each chart's primary panel, with a link to its other runs. */
export default function ParetoCharts({ m = OCR }: { m?: Measure }): ReactNode {
  // The summary on /quality: one line per script or language, its grade and its verdict, linking to the chart.
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
