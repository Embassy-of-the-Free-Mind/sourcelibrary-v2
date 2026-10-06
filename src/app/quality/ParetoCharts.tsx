import pareto from '@/data/ocr-pareto.json';

// Cost against accuracy, one figure per script (#5983). Server-rendered SVG, no client JS: exact
// values ride on <title> tooltips and on the table under each plot, which is the table view.
// Engines are told apart by NUMBER (keyed in the table), not by colour, so identity never depends
// on hue and labels cannot collide at 390 px. Colours are the house pair from
// /research/canon-gap/diagrams.tsx (validated there): teal for the frontier, amber for production.
// Every number comes from src/data/ocr-pareto.json (scripts/eval/build-ocr-pareto.mjs).

const FRONTIER = '#0b9488';
const PRODUCTION = '#b45309';
const GH = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/';

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
type Chart = { id: string; title: string; production_label: string; panels: Panel[]; not_on_shared_pages: { label: string; pages: number }[]; not_tested: string[] };

const data = pareto as unknown as { charts: Chart[]; no_chart: { title: string; why: string; source: string }[]; cost_sources: { metered: string } };

const pct = (x: number | null | undefined, d = 1) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`);
const usd = (x: number) => `$${x < 0.1 ? x.toFixed(3) : x.toFixed(2)}`;

// ── geometry ─────────────────────────────────────────────────────────────────
const W = 360, H = 230, M = { l: 44, r: 14, t: 12, b: 34 };
const X_TICKS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20];

function Plot({ panel, title }: { panel: Panel; title: string }) {
  const pts = panel.placed;
  const costs = pts.map(p => p.cost!.usd_per_1k);
  const x0 = Math.log10(Math.min(...costs) / 1.6), x1 = Math.log10(Math.max(...costs) * 1.6);
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

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${title}: accuracy against cost per 1,000 pages for ${pts.length} engines`}>
      {/* grid + axes: recessive */}
      {yTicks.map(v => (
        <g key={`y${v}`}>
          <line x1={M.l} x2={W - M.r} y1={sy(v)} y2={sy(v)} stroke="#e7e5e4" strokeWidth={1} />
          <text x={M.l - 6} y={sy(v)} dy="0.32em" textAnchor="end" fontSize={10} fill="#78716c">{Math.round(v * 100)}%</text>
        </g>
      ))}
      {xTicks.map(t => (
        <g key={`x${t}`}>
          <line x1={sx(t)} x2={sx(t)} y1={M.t} y2={H - M.b} stroke="#f5f5f4" strokeWidth={1} />
          <text x={sx(t)} y={H - M.b + 14} textAnchor="middle" fontSize={10} fill="#78716c">${t}</text>
        </g>
      ))}
      <text x={(M.l + W - M.r) / 2} y={H - 4} textAnchor="middle" fontSize={10} fill="#57534e">cost per 1,000 pages (log scale)</text>
      <text x={10} y={(M.t + H - M.b) / 2} textAnchor="middle" fontSize={10} fill="#57534e" transform={`rotate(-90 10 ${(M.t + H - M.b) / 2})`}>accuracy (1 − CER)</text>

      {/* frontier */}
      {frontier.length >= 2 && (
        <polyline points={frontier.map(p => `${sx(p.cost!.usd_per_1k)},${sy(p.accuracy!)}`).join(' ')} fill="none" stroke={FRONTIER} strokeWidth={2} strokeLinejoin="round" />
      )}

      {pts.map((p, i) => {
        const cx = sx(p.cost!.usd_per_1k), cy = sy(p.accuracy!);
        const ring = p.invented?.median != null ? 7 + p.invented.median * 30 : null;
        const compute = p.cost!.basis === 'compute';
        const tip = `${p.label}${p.production ? ' (in production)' : ''}: accuracy ${pct(p.accuracy)}${p.accuracy_ci95 ? ` [${pct(p.accuracy_ci95[0])}–${pct(p.accuracy_ci95[1])}]` : ''}, ${usd(p.cost!.usd_per_1k)} per 1,000 pages (${p.cost!.basis})${p.invented?.median != null ? `, invented text ${pct(p.invented.median)}` : ''}${p.on_frontier ? ', on the frontier' : ''}`;
        return (
          <g key={p.engine}>
            <title>{tip}</title>
            {p.accuracy_ci95 && (
              <line x1={cx} x2={cx} y1={sy(p.accuracy_ci95[0])} y2={sy(p.accuracy_ci95[1])} stroke="#a8a29e" strokeWidth={2} strokeLinecap="round" />
            )}
            {ring && <circle cx={cx} cy={cy} r={ring} fill="none" stroke="#a8a29e" strokeWidth={1} strokeDasharray="2 2" />}
            <circle cx={cx} cy={cy} r={7} fill={compute ? '#fff' : p.production ? PRODUCTION : '#44403c'} stroke={p.production ? PRODUCTION : '#44403c'} strokeWidth={compute ? 1.5 : 2} />
            <text x={cx} y={cy} dy="0.35em" textAnchor="middle" fontSize={8.5} fontWeight={700} fill={compute ? '#44403c' : '#fff'}>{i + 1}</text>
            {/* a hit target bigger than the mark */}
            <circle cx={cx} cy={cy} r={12} fill="transparent" />
          </g>
        );
      })}
    </svg>
  );
}

function PanelView({ chart, panel }: { chart: Chart; panel: Panel }) {
  const refs = panel.references;
  return (
    <div className="mt-4 first:mt-0">
      {chart.panels.length > 1 && (
        <div className="text-xs uppercase tracking-wider text-stone-500 mb-1">
          {panel.kind === 'most-pages' ? 'The engines read on the most pages' : 'The most engines read on the same pages'}
        </div>
      )}
      <Plot panel={panel} title={chart.title} />
      {panel.frontier_note && <p className="text-xs text-stone-500 mt-1">{panel.frontier_note[0].toUpperCase() + panel.frontier_note.slice(1)}.</p>}
      <table className="w-full text-xs mt-2 tabular-nums">
        <thead>
          <tr className="text-left text-stone-500 border-b border-stone-200">
            <th className="font-normal py-1 pr-1 w-5">#</th>
            <th className="font-normal py-1 pr-2">engine</th>
            <th className="font-normal py-1 pr-2 text-right">accuracy [95% CI]</th>
            <th className="font-normal py-1 pr-2 text-right">per 1,000 pp</th>
            <th className="font-normal py-1 text-right" title="share of the engine's words absent from the reference">invented</th>
          </tr>
        </thead>
        <tbody>
          {[...panel.placed, ...panel.no_cost].map((p, i) => (
            <tr key={p.engine} className="border-b border-stone-100 align-top">
              <td className="py-1 pr-1 text-stone-500">{i < panel.placed.length ? i + 1 : ''}</td>
              <td className="py-1 pr-2 text-stone-800">
                {p.label}
                {p.production && <span className="ml-1 text-[0.65rem] uppercase tracking-wider" style={{ color: PRODUCTION }}>production</span>}
                {p.on_frontier && <span className="ml-1 text-[0.65rem] uppercase tracking-wider" style={{ color: FRONTIER }}>frontier</span>}
              </td>
              <td className="py-1 pr-2 text-right text-stone-800 whitespace-nowrap">
                {pct(p.accuracy)}
                {p.accuracy_ci95 && <span className="text-stone-500"> [{pct(p.accuracy_ci95[0], 0)}–{pct(p.accuracy_ci95[1], 0)}]</span>}
              </td>
              <td className="py-1 pr-2 text-right whitespace-nowrap">
                {p.cost ? (
                  <a href={`${GH}${p.cost.source}`} title={p.cost.detail} className="text-stone-800 hover:text-amber-800">
                    {usd(p.cost.usd_per_1k)}{p.cost.basis === 'compute' && <sup className="text-stone-500">c</sup>}
                  </a>
                ) : <span className="text-stone-500">not measured</span>}
              </td>
              <td className="py-1 text-right text-stone-600">{pct(p.invented?.median, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-stone-500 mt-2 leading-snug">
        {panel.n_books === panel.n_pages
          ? <>{panel.n_books} books, one page each, read by every engine above.</>
          : <>{panel.n_pages} pages from {panel.n_books} {panel.n_books === 1 ? 'book' : 'books'}, read by every engine above; pages of one book are not independent, so the intervals are too narrow.</>}{' '}
        Reference: {refs.map((r, i) => (
          <span key={r.stratum}>{i > 0 && '; '}{r.reference} ({r.pages})</span>
        ))}. Scored {panel.date}.
      </p>
    </div>
  );
}

export default function ParetoCharts() {
  return (
    <div>
      <div className="grid gap-6 md:grid-cols-2">
        {data.charts.map(chart => (
          <figure key={chart.id} id={`pareto-${chart.id}`} className="rounded-sm border border-stone-200 bg-white px-4 py-5 min-w-0 scroll-mt-24">
            <div className="font-serif text-lg text-stone-900">{chart.title}</div>
            <div className="text-xs text-stone-500 mb-3">In production: {chart.production_label}</div>
            {chart.panels.map(p => <PanelView key={p.kind} chart={chart} panel={p} />)}
            <figcaption className="text-xs text-stone-500 mt-3 pt-3 border-t border-stone-100 leading-snug space-y-1">
              {chart.not_on_shared_pages.length > 0 && (
                <p>Also run here, on too few of the same pages to compare: {chart.not_on_shared_pages.map(e => `${e.label} (${e.pages})`).join(', ')}.</p>
              )}
              <p>Not yet tested on this script: {chart.not_tested.join(', ')}.</p>
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="mt-6 text-sm text-stone-700 max-w-3xl">
        <p className="font-semibold text-stone-900 mb-1">No chart yet</p>
        <ul className="list-disc pl-5 space-y-1">
          {data.no_chart.map(n => (
            <li key={n.title}>
              <span className="text-stone-900">{n.title}</span>: {n.why}.
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
