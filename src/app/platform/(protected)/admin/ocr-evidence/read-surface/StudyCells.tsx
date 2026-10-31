'use client';
/**
 * Amendment 6 charts for /platform/admin/ocr-evidence/read-surface (#6740): the screen's 3 x 3 cells of pages a call x
 * thinking, per language, from src/data/ocr-read-surface-6740-a6.json (scripts/eval/read-surface-6740/analysis6.py).
 * Each tile: quota cost per 1,000 accepted pages (colour, one blue ramp, light = cheap), the CER difference from live
 * with its 95 % book-bootstrap interval, hatched where the upper bound passes the 1 pp margin. Live is the amber
 * outline, the optimum the blue one. Admin dark tokens as SurfaceCharts.tsx.
 */
import { useState } from 'react';

export type Cell = { name: string; x1: number; x3: number; live: boolean; delta_cer_pp: number; delta_lo: number; delta_hi: number; cer_pp: number;
  usd_per_1k_pages: number; usd_per_1k_accepted: number; cpa_lo: number; cpa_hi: number; yield: number; saving_vs_live: number; calls_pp: number; secs_pp: number; non_inferior: boolean };
export type Study = { books: number; cells: Cell[]; optimum: string | null; verdict: string; frontier: string[] };

const INK = '#e6edf3', MUTED = '#8b949e', BLUE = '#58a6ff', AMBER = '#d29922';
const RAMP = ['#cae8ff', '#a5d6ff', '#79c0ff', '#58a6ff', '#388bfd', '#1f6feb', '#1158c7', '#0d419d', '#0c2d6b'];
const PPC = ['1', '4', '8'], THINK = ['low', 'medium', 'high'];

export function CellMap({ S, label }: { S: Study; label: string }) {
  const [tip, setTip] = useState<Cell | null>(null);
  const lo = Math.log(Math.min(...S.cells.map((c) => c.usd_per_1k_accepted))), hi = Math.log(Math.max(...S.cells.map((c) => c.usd_per_1k_accepted)));
  const col = (v: number) => RAMP[Math.min(RAMP.length - 1, Math.max(0, Math.round(((Math.log(v) - lo) / Math.max(1e-9, hi - lo)) * (RAMP.length - 1))))];
  const T = 92, P = { l: 64, t: 10 };
  return (
    <div>
      <svg viewBox={`0 0 ${P.l + 3 * T + 10} ${P.t + 3 * T + 44}`} className="w-full h-auto" style={{ maxWidth: 380 }} role="img" aria-label={`${label}: cost per accepted page and CER difference by cell`}>
        <defs><pattern id={`h-${label}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#0d1117" strokeWidth="1.5" /></pattern></defs>
        {S.cells.map((c) => {
          const x = P.l + (c.x1 + 1) * T, y = P.t + (1 - c.x3) * T, isOpt = c.name === S.optimum && !c.live;
          return (
            <g key={c.name} onMouseEnter={() => setTip(c)} onMouseLeave={() => setTip(null)} onFocus={() => setTip(c)} tabIndex={0}>
              <rect x={x + 2} y={y + 2} width={T - 4} height={T - 4} rx={4} fill={col(c.usd_per_1k_accepted)} />
              {!c.non_inferior && <rect x={x + 2} y={y + 2} width={T - 4} height={T - 4} rx={4} fill={`url(#h-${label})`} opacity={0.55} />}
              {(c.live || isOpt) && <rect x={x + 3} y={y + 3} width={T - 6} height={T - 6} rx={4} fill="none" stroke={c.live ? AMBER : BLUE} strokeWidth={3} />}
              <text x={x + T / 2} y={y + T / 2 - 6} textAnchor="middle" fontSize={13} fill="#0d1117" fontWeight={600}>${c.usd_per_1k_accepted.toFixed(c.usd_per_1k_accepted < 20 ? 1 : 0)}</text>
              <text x={x + T / 2} y={y + T / 2 + 12} textAnchor="middle" fontSize={11} fill="#0d1117">{c.live ? 'live' : `${c.delta_cer_pp >= 0 ? '+' : ''}${c.delta_cer_pp.toFixed(2)} pp`}</text>
            </g>
          );
        })}
        {PPC.map((p, i) => <text key={p} x={P.l + i * T + T / 2} y={P.t + 3 * T + 16} textAnchor="middle" fontSize={12} fill={MUTED}>{p}</text>)}
        <text x={P.l + 1.5 * T} y={P.t + 3 * T + 34} textAnchor="middle" fontSize={12} fill={MUTED}>pages a call</text>
        {THINK.map((t, i) => <text key={t} x={P.l - 6} y={P.t + (2 - i) * T + T / 2 + 4} textAnchor="end" fontSize={12} fill={MUTED}>{t}</text>)}
      </svg>
      <div className="min-h-[3.5rem] text-sm" aria-live="polite">
        {tip ? <div className="rounded border border-[#21262d] bg-[#161b22] px-2 py-1 inline-block">
          <div className="text-[#f0f6fc] font-semibold">{tip.name}{tip.live ? ' (live)' : ''}</div>
          <div className="text-[#8b949e]">CER {tip.cer_pp.toFixed(2)}% (accuracy); vs live {tip.delta_cer_pp >= 0 ? '+' : ''}{tip.delta_cer_pp.toFixed(2)} pp [{tip.delta_lo.toFixed(2)}, {tip.delta_hi.toFixed(2)}]</div>
          <div className="text-[#8b949e]">${tip.usd_per_1k_accepted.toFixed(2)} a 1,000 accepted pages [{tip.cpa_lo.toFixed(2)}, {tip.cpa_hi.toFixed(2)}] (quota cost, list-price equivalent); yield {(100 * tip.yield).toFixed(0)}%</div>
          <div className="text-[#8b949e]">{tip.calls_pp.toFixed(2)} agy calls a page; {tip.secs_pp.toFixed(0)} s a page at the box&apos;s load</div>
        </div> : <span className="text-[#8b949e]">Point at a cell for its CER, cost and intervals. Hatched: not shown non-inferior on CER (upper 95% bound above +1 pp).</span>}
      </div>
    </div>
  );
}

export function CellTable({ S }: { S: Study }) {
  return (
    <div className="overflow-x-auto">
      <table className="mt-2 text-sm w-full">
        <thead><tr className="text-left text-[#8b949e] border-b border-[#30363d]">
          <th className="py-1 pr-3 font-normal">cell</th><th className="pr-3 font-normal">CER vs live, pp (accuracy)</th><th className="pr-3 font-normal">$ a 1,000 pages</th>
          <th className="pr-3 font-normal">yield</th><th className="pr-3 font-normal">$ a 1,000 accepted pages</th><th className="pr-3 font-normal">vs live</th><th className="font-normal">non-inferior</th>
        </tr></thead>
        <tbody>{S.cells.map((c) => (
          <tr key={c.name} className="border-b border-[#21262d]" style={{ color: c.name === S.optimum ? BLUE : c.live ? AMBER : INK }}>
            <td className="py-1 pr-3">{c.name}{c.live ? ' (live)' : ''}</td>
            <td className="pr-3">{c.live ? '—' : `${c.delta_cer_pp >= 0 ? '+' : ''}${c.delta_cer_pp.toFixed(2)} [${c.delta_lo.toFixed(2)}, ${c.delta_hi.toFixed(2)}]`}</td>
            <td className="pr-3">{c.usd_per_1k_pages.toFixed(2)}</td><td className="pr-3">{(100 * c.yield).toFixed(0)}%</td>
            <td className="pr-3">{c.usd_per_1k_accepted.toFixed(2)} [{c.cpa_lo.toFixed(2)}, {c.cpa_hi.toFixed(2)}]</td>
            <td className="pr-3">{c.live ? '—' : `${c.saving_vs_live >= 0 ? '−' : '+'}${Math.abs(100 * c.saving_vs_live).toFixed(0)}%`}</td>
            <td>{c.non_inferior ? 'yes' : 'no'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
