/**
 * Diagrams for "How we choose the cheapest way to read a page" (#6740). Server-rendered SVG; a point's <title> is its
 * hover text. Numbers come from src/data/ocr-read-surface-6740-a6.json (scripts/eval/experiments/
 * 2026-10-30-read-surface-box-behnken-6740.md, Amendment 6). Colours: stone for marks, amber-700 for the setting in use,
 * teal-600 for the setting the test chose (the site's ParetoCharts convention).
 */
const INK = '#44403c';
const MUTED = '#57534e';
const FAINT = '#a8a29e';
const GRID = '#e7e5e4';
const LIVE = '#b45309';
const PICK = '#0d9488';

/** The three settings as a cube: a full factorial reads all 27 points; Box-Behnken reads the 12 edge midpoints and the centre. */
export function DesignCube() {
  // Oblique projection of the cube [-1, 1]^3.
  const P = (x: number, y: number, z: number) => [170 + x * 95 + z * 48, 150 - y * 95 + z * 38] as const;
  const corners: [number, number, number][] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push([x, y, z]);
  const edges = corners.flatMap((a, i) => corners.slice(i + 1).filter((b) => a.filter((v, k) => v !== b[k]).length === 1).map((b) => [a, b] as const));
  const all: [number, number, number][] = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) all.push([x, y, z]);
  const isBB = (p: number[]) => p.filter((v) => v === 0).length === 1 || p.every((v) => v === 0);
  return (
    <figure className="my-8">
      <svg viewBox="0 0 360 290" className="w-full h-auto max-w-md mx-auto" role="img"
        aria-label="A cube whose three axes are pages a call, image size and thinking. Of its 27 grid points, the Box-Behnken design reads the 12 at the middle of each edge and the centre.">
        {edges.map(([a, b], i) => { const [x1, y1] = P(...a), [x2, y2] = P(...b); return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={FAINT} strokeWidth={1.5} />; })}
        {all.map((p) => { const [x, y] = P(...p); const bb = isBB(p); return (
          <circle key={p.join()} cx={x} cy={y} r={bb ? 6 : 3.5} fill={bb ? INK : '#fff'} stroke={bb ? '#fff' : FAINT} strokeWidth={bb ? 2 : 1.5}>
            <title>{bb ? (p.every((v) => v === 0) ? 'the centre, read three times' : 'an edge midpoint: one run') : 'not read in a Box-Behnken design'}</title>
          </circle>); })}
        {(() => { const [x, y] = P(1.25, -1, -1); return <text x={x} y={y + 18} fontSize={12} fill={MUTED} textAnchor="middle">pages a call: 1, 4, 8</text>; })()}
        {(() => { const [x, y] = P(-1, 0, -1); return <text x={x - 10} y={y} fontSize={12} fill={MUTED} textAnchor="end">image size</text>; })()}
        {(() => { const [x, y] = P(1, -1, 0.2); return <text x={x + 12} y={y + 10} fontSize={12} fill={MUTED}>thinking</text>; })()}
      </svg>
      <figcaption className="text-sm text-muted text-center mt-2 font-sans">
        Filled: the 13 settings a Box-Behnken design reads (the centre three times). Hollow: the other 14 of the 27.
      </figcaption>
    </figure>
  );
}

export interface CostPoint { name: string; relCost: number; cerPct: number; live?: boolean; pick?: boolean }
export interface CostPanel { lang: string; books: number; points: CostPoint[] }

/** Dots labelled on the chart besides the setting in use and the chosen one; the rest carry hover titles. */
const LABELLED = ['8 a call, low', '4 a call, medium', '1 a call, high'];
const short = (name: string) => name.replace(' a call, ', '/');

/** One panel per language: cost relative to the setting in use across (log scale), error rate up, one dot per setting. */
export function CostChart({ panels, caption }: { panels: CostPanel[]; caption: React.ReactNode }) {
  const W = 330, H = 250, M = { l: 54, r: 14, t: 26, b: 42 };
  const ticks = [0.5, 1, 2, 5, 10];
  const lx0 = Math.log(0.35), lx1 = Math.log(18);
  const X = (v: number) => M.l + ((Math.log(v) - lx0) / (lx1 - lx0)) * (W - M.l - M.r);
  return (
    <figure className="my-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {panels.map(({ lang, books, points }) => {
          const yMax = Math.ceil(Math.max(...points.map((p) => p.cerPct)) * 1.25 * 2) / 2;
          const step = yMax <= 1 ? 0.2 : 1;
          const yt: number[] = [];
          for (let t = 0; t <= yMax + 1e-9; t += step) yt.push(Math.round(t * 10) / 10);
          const Y = (v: number) => M.t + (1 - v / yMax) * (H - M.t - M.b);
          return (
            <svg key={lang} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
              aria-label={`${lang}, ${books} books: error rate against cost relative to the setting in use, for nine settings.`}>
              <text x={M.l} y={15} fontSize={13} fontWeight={600} fill={INK}>{`${lang} (${books} books)`}</text>
              {yt.map((t) => <g key={t}><line x1={M.l} x2={W - M.r} y1={Y(t)} y2={Y(t)} stroke={GRID} /><text x={M.l - 6} y={Y(t) + 4} fontSize={11} textAnchor="end" fill={MUTED}>{`${t}%`}</text></g>)}
              {ticks.map((t) => <text key={t} x={X(t)} y={H - M.b + 16} fontSize={11} textAnchor="middle" fill={MUTED}>{`${t}×`}</text>)}
              <line x1={X(1)} x2={X(1)} y1={M.t} y2={H - M.b} stroke={GRID} strokeDasharray="3 3" />
              <text x={(W + M.l) / 2} y={H - 6} fontSize={11} textAnchor="middle" fill={MUTED}>cost a page, × the setting in use (log scale)</text>
              <text transform={`translate(13 ${(H - M.b + M.t) / 2}) rotate(-90)`} fontSize={11} textAnchor="middle" fill={MUTED}>error rate</text>
              {points.map((p) => {
                const hi = p.live || p.pick;
                const labelled = hi || LABELLED.includes(p.name);
                return (
                  <g key={p.name}>
                    <circle cx={X(p.relCost)} cy={Y(p.cerPct)} r={hi ? 7 : 5} fill={p.live ? LIVE : p.pick ? PICK : INK} stroke="#fff" strokeWidth={2}>
                      <title>{`${p.name}${p.live ? ' (in use)' : ''}: ${p.relCost.toFixed(2)} times the cost of the setting in use, error rate ${p.cerPct.toFixed(2)}%`}</title>
                    </circle>
                    {labelled && <text x={X(p.relCost)} y={Y(p.cerPct) + (p.live ? 20 : -11)} fontSize={10} textAnchor="middle" fill={hi ? INK : MUTED}>
                      {p.live ? `${short(p.name)} (in use)` : short(p.name)}
                    </text>}
                  </g>
                );
              })}
            </svg>
          );
        })}
      </div>
      <figcaption className="text-sm text-muted mt-2 font-sans">{caption}</figcaption>
    </figure>
  );
}
