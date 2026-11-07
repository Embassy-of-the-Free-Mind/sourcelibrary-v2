/**
 * Diagrams for "How we choose the cheapest way to read a page" (#6740). Server-rendered SVG; a point's <title> is its
 * hover text. The numbers come from the article's RUNS table (scripts/eval/experiments/
 * 2026-10-30-read-surface-box-behnken-6740.md). Colours: stone for marks, amber-700 for the live setting, teal-600
 * for the setting the test chose (the site's ParetoCharts convention).
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

export interface RunPoint { lang: 'German' | 'Latin'; label: string; calls: number; cer: number; live?: boolean; pick?: boolean }

/** One panel per language: agy calls a page across, CER up, one dot per run. */
export function RunsChart({ runs }: { runs: RunPoint[] }) {
  const W = 330, H = 240, M = { l: 46, r: 10, t: 24, b: 40 };
  return (
    <figure className="my-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(['German', 'Latin'] as const).map((lang) => {
          const rs = runs.filter((r) => r.lang === lang);
          const x1 = 1.2, y1 = Math.max(0.045, ...rs.map((r) => r.cer)) * 1.1;
          const X = (v: number) => M.l + (v / x1) * (W - M.l - M.r);
          const Y = (v: number) => M.t + (1 - v / y1) * (H - M.t - M.b);
          const yt = [0, 0.01, 0.02, 0.03, 0.04].filter((t) => t <= y1);
          return (
            <svg key={lang} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${lang}: agy calls a page against character error rate, one dot per run`}>
              <text x={M.l} y={14} fontSize={13} fontWeight={600} fill={INK}>{lang}</text>
              {yt.map((t) => <g key={t}><line x1={M.l} x2={W - M.r} y1={Y(t)} y2={Y(t)} stroke={GRID} /><text x={M.l - 6} y={Y(t) + 4} fontSize={11} textAnchor="end" fill={MUTED}>{(t * 100).toFixed(0)}%</text></g>)}
              {[0, 0.25, 0.5, 0.75, 1].map((t) => <text key={t} x={X(t)} y={H - M.b + 16} fontSize={11} textAnchor="middle" fill={MUTED}>{t}</text>)}
              <text x={(W + M.l) / 2} y={H - 6} fontSize={11} textAnchor="middle" fill={MUTED}>agy calls a page</text>
              <text transform={`translate(12 ${(H - M.b + M.t) / 2}) rotate(-90)`} fontSize={11} textAnchor="middle" fill={MUTED}>character error rate</text>
              {rs.map((r) => (
                <g key={r.label}>
                  <circle cx={X(r.calls)} cy={Y(r.cer)} r={r.live || r.pick ? 7 : 5} fill={r.live ? LIVE : r.pick ? PICK : INK} stroke="#fff" strokeWidth={2}>
                    <title>{`${r.label}: ${r.calls.toFixed(2)} agy calls a page, CER ${(100 * r.cer).toFixed(2)}% (accuracy, against the typed edition)`}</title>
                  </circle>
                  {(r.live || r.pick) && <text x={X(r.calls) + 9} y={Y(r.cer) - 8} fontSize={11} fill={INK}>{r.live ? 'live' : 'chosen'}</text>}
                </g>
              ))}
            </svg>
          );
        })}
      </div>
      <figcaption className="text-sm text-muted mt-2 font-sans">
        Each dot is one run: the same target page of every book read at one combination of settings. Amber: the live
        setting (two runs). Teal: the setting the test chose for Latin. Hover a dot for its settings and numbers.
        Character error rate is measured against the human-typed edition of each page (German n = 35 books, Latin n = 34).
      </figcaption>
    </figure>
  );
}
