'use client';

/**
 * Charts for the live read-surface page (#6740). Inline SVG in the static page's style and tokens (SurfaceCharts.tsx):
 * blue for the optimum, amber for live, one teal ramp dark (low) to light (high), grey for everything else.
 */
import { useId } from 'react';
import { TEAL, LIVE, INK, MUTED, FAINT, GRID, RAMP, isoSegments, niceSteps } from '../SurfaceCharts';
import type { LiveSetting } from './shape';
import type { Point } from './rsm';

export const fmtPct = (v: number, d = 2) => `${(100 * v).toFixed(d)}%`;
const BG = '#0d1117';

export function Tip({ lines }: { lines: string[] | null }) {
  return (
    <div className="min-h-[3.25rem] text-sm mt-1" aria-live="polite">
      {lines ? <div className="rounded border border-[#21262d] bg-[#161b22] px-2 py-1 inline-block">{lines.map((l, i) => <div key={i} className={i ? 'text-[#8b949e]' : 'text-[#f0f6fc] font-semibold'}>{l}</div>)}</div>
        : <span className="text-[#8b949e]">Point at a mark for its values.</span>}
    </div>
  );
}

// ── the design: pages a call × long edge, one panel per thinking level ──
const DW = 200, DH = 170, DP = { l: 44, r: 8, t: 20, b: 34 };
export const EDGE_RANGE: [number, number] = [700, 2700];   // the design's span; the surface widens it to the pixels sent
const ex = (lo: number, hi: number, v: number) => (Math.log2(v) - Math.log2(lo)) / (Math.log2(hi) - Math.log2(lo));

export interface DesignPoint { s: LiveSetting; edge: number; served: boolean; runs: number }

export function DesignView({ points, maxPpc, onTip }: { points: DesignPoint[]; maxPpc: number; onTip: (t: string[] | null) => void }) {
  const ER: [number, number] = [Math.min(EDGE_RANGE[0], ...points.map((d) => d.edge * 0.95)), Math.max(EDGE_RANGE[1], ...points.map((d) => d.edge * 1.05))];
  const X = (p: number) => DP.l + ((p - 0.5) / (maxPpc + 0.5 - 0.5)) * (DW - DP.l - DP.r);
  const Y = (e: number) => DP.t + (1 - ex(ER[0], ER[1], e)) * (DH - DP.t - DP.b);
  const ticksE = [768, 1024, 1400, 2400, 4000].filter((e) => e >= ER[0] && e <= ER[1]);
  const ticksP = [1, 4, 8, 12].filter((p) => p <= maxPpc);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      {(['low', 'medium', 'high'] as const).map((th) => (
        <svg key={th} viewBox={`0 0 ${DW} ${DH}`} className="w-full h-auto" role="img" aria-label={`Design settings at thinking ${th}`}>
          <text x={DP.l} y={13} fontSize={11} fill={INK} fontWeight={600}>thinking {th}</text>
          <rect x={DP.l} y={DP.t} width={DW - DP.l - DP.r} height={DH - DP.t - DP.b} fill="none" stroke={FAINT} />
          {ticksE.map((e) => <g key={e}><line x1={DP.l} x2={DW - DP.r} y1={Y(e)} y2={Y(e)} stroke={GRID} /><text x={DP.l - 4} y={Y(e) + 3} fontSize={9} textAnchor="end" fill={MUTED}>{e.toLocaleString('en')}</text></g>)}
          {ticksP.map((p) => <text key={p} x={X(p)} y={DH - DP.b + 12} fontSize={9} textAnchor="middle" fill={MUTED}>{p}</text>)}
          <text x={(DW + DP.l) / 2} y={DH - 6} fontSize={9} textAnchor="middle" fill={MUTED}>pages a call</text>
          <text transform={`translate(10 ${(DH - DP.b + DP.t) / 2}) rotate(-90)`} fontSize={9} textAnchor="middle" fill={MUTED}>long edge, px</text>
          {points.filter((d) => d.s.thinking === th).map((d, i) => {
            const cx = X(d.s.pages_a_call) + (d.s.prompt_line !== 'live' ? 5 : 0), cy = Y(d.edge);
            const col = d.s.live ? LIVE : INK;
            const fill = d.s.status === 'done' ? col : BG;
            const op = d.s.status === 'aborted' ? 0.3 : 1;
            const cls = d.s.status === 'running' ? 'animate-pulse' : undefined;
            const tip = () => onTip([`${d.s.id}${d.s.live ? ' (live)' : ''}: ${d.s.pages_a_call} a call · ${d.served ? `as served (~${Math.round(d.edge).toLocaleString('en')} px)` : `${d.edge.toLocaleString('en')} px`} · ${d.s.thinking} · prompt ${d.s.prompt_line}`,
              `${d.s.status} · stage ${d.s.stage}${d.runs ? ` · ${d.runs} page rows` : ''}`]);
            return d.s.prompt_line !== 'live'
              ? <rect key={i} className={cls} x={cx - 4} y={cy - 4} width={8} height={8} fill={fill} stroke={col} strokeWidth={1.5} opacity={op} onPointerEnter={tip} onPointerLeave={() => onTip(null)} />
              : <circle key={i} className={cls} cx={cx} cy={cy} r={4.5} fill={fill} stroke={col} strokeWidth={1.5} opacity={op} onPointerEnter={tip} onPointerLeave={() => onTip(null)} />;
          })}
        </svg>
      ))}
    </div>
  );
}

// ── the fitted surface over pages a call × long edge at one thinking level ──
const CS = 300, CP = { l: 52, r: 12, t: 12, b: 40 };
export interface ContourProps {
  z: number[][]; feasible: boolean[][]; inRegion: boolean[][]; n: number; ppcRange: [number, number]; edgeRange: [number, number]; range: [number, number];
  fmt: (v: number) => string; points: { ppc: number; edge: number; label: string[]; live: boolean }[];
  live: Point | null; opt: Point | null; cloud: Point[]; onTip: (t: string[] | null) => void; probe: (ppc: number, edge: number) => string[];
}
export function Contour({ z, feasible, inRegion, n, ppcRange, edgeRange, range, fmt, points, live, opt, cloud, onTip, probe }: ContourProps) {
  const clip = useId();
  const axis = Array.from({ length: n }, (_, i) => i / (n - 1));
  const X = (u: number) => CP.l + u * CS, Y = (v: number) => CP.t + (1 - v) * CS;
  const up = (p: number) => (p - ppcRange[0]) / (ppcRange[1] - ppcRange[0] || 1);
  const ve = (e: number) => ex(edgeRange[0], edgeRange[1], e);
  const band = (v: number) => RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.floor(((v - range[0]) / (range[1] - range[0] || 1)) * RAMP.length)))];
  const cw = CS / (n - 1);
  const levels = niceSteps(range[0], range[1], 7);
  const ppcTicks = [1, 2, 4, 6, 8, 10, 12].filter((p) => p >= ppcRange[0] && p <= ppcRange[1]);
  return (
    <svg viewBox={`0 0 ${CS + CP.l + CP.r} ${CS + CP.t + CP.b}`} className="w-full h-auto" style={{ maxWidth: 520 }} role="img" aria-label="Predicted response over pages a call and long edge"
      onPointerMove={(e) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const sx = ((e.clientX - r.left) / r.width) * (CS + CP.l + CP.r), sy = ((e.clientY - r.top) / r.height) * (CS + CP.t + CP.b);
        const u = (sx - CP.l) / CS, v = 1 - (sy - CP.t) / CS;
        if (u < 0 || u > 1 || v < 0 || v > 1) return onTip(null);
        onTip(probe(ppcRange[0] + u * (ppcRange[1] - ppcRange[0]), Math.pow(2, Math.log2(edgeRange[0]) + v * (Math.log2(edgeRange[1]) - Math.log2(edgeRange[0])))));
      }} onPointerLeave={() => onTip(null)}>
      <defs>
        <clipPath id={clip}><rect x={CP.l} y={CP.t} width={CS} height={CS} /></clipPath>
        <pattern id={`${clip}-h`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke={BG} strokeWidth="3" /></pattern>
      </defs>
      <g clipPath={`url(#${clip})`}>
        {z.map((row, r) => row.map((v, c) => <rect key={`${r}-${c}`} x={X(axis[c]) - cw / 2} y={Y(axis[r]) - cw / 2} width={cw + 0.6} height={cw + 0.6} fill={band(v)} opacity={inRegion[r][c] ? 1 : 0.45} />))}
        {feasible.map((row, r) => row.map((f, c) => (f ? null : <rect key={`f${r}-${c}`} x={X(axis[c]) - cw / 2} y={Y(axis[r]) - cw / 2} width={cw + 0.6} height={cw + 0.6} fill={`url(#${clip}-h)`} opacity={0.75} />)))}
        {levels.map((lv) => isoSegments(z, axis, lv).map(([a, b, c, d], i) => <line key={`${lv}-${i}`} x1={X(a)} y1={Y(b)} x2={X(c)} y2={Y(d)} stroke={INK} strokeOpacity={0.35} />))}
        {cloud.map((p, i) => <circle key={`b${i}`} cx={X(up(p.ppc))} cy={Y(ve(p.edge))} r={2} fill={TEAL} fillOpacity={0.35} />)}
      </g>
      <rect x={CP.l} y={CP.t} width={CS} height={CS} fill="none" stroke={FAINT} />
      {[768, 1024, 1400, 2400, 4000, 6000].filter((e) => e >= edgeRange[0] && e <= edgeRange[1]).map((e) => <text key={e} x={CP.l - 5} y={Y(ve(e)) + 4} fontSize={11} textAnchor="end" fill={MUTED}>{e.toLocaleString('en')}</text>)}
      {ppcTicks.map((p) => <text key={p} x={X(up(p))} y={CP.t + CS + 15} fontSize={11} textAnchor="middle" fill={MUTED}>{p}</text>)}
      <text x={CP.l + CS / 2} y={CP.t + CS + 32} fontSize={11} textAnchor="middle" fill={MUTED}>pages a call</text>
      <text transform={`translate(12 ${CP.t + CS / 2}) rotate(-90)`} fontSize={11} textAnchor="middle" fill={MUTED}>long edge, px (log)</text>
      {levels.map((lv) => { const s = isoSegments(z, axis, lv)[0]; return s ? <text key={`l${lv}`} x={X(s[0]) + 2} y={Y(s[1]) - 2} fontSize={9} fill={INK} fillOpacity={0.7} pointerEvents="none">{fmt(lv)}</text> : null; })}
      {points.map((p, i) => <circle key={i} cx={X(up(p.ppc))} cy={Y(ve(p.edge))} r={4} fill={BG} stroke={p.live ? LIVE : INK} strokeWidth={2} pointerEvents="none" />)}
      {live && <rect x={X(up(live.ppc)) - 6} y={Y(ve(live.edge)) - 6} width={12} height={12} fill={LIVE} stroke={BG} strokeWidth={2} transform={`rotate(45 ${X(up(live.ppc))} ${Y(ve(live.edge))})`} pointerEvents="none" />}
      {opt && <circle cx={X(up(opt.ppc))} cy={Y(ve(opt.edge))} r={9} fill="none" stroke={TEAL} strokeWidth={3} pointerEvents="none" />}
    </svg>
  );
}

export function RampLegend({ range, fmt, label }: { range: [number, number]; fmt: (v: number) => string; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#8b949e] mt-1">
      <span className="inline-flex items-center gap-1">{fmt(range[0])}{RAMP.map((c) => <span key={c} className="inline-block w-3 h-3" style={{ background: c }} />)}{fmt(range[1])} {label}</span>
      <span className="inline-flex items-center gap-1"><svg width="14" height="14"><rect x="3" y="3" width="8" height="8" fill={LIVE} transform="rotate(45 7 7)" /></svg>live</span>
      <span className="inline-flex items-center gap-1"><svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="none" stroke={TEAL} strokeWidth="3" /></svg>optimum</span>
      <span className="inline-flex items-center gap-1"><svg width="10" height="10"><circle cx="5" cy="5" r="2.5" fill={TEAL} fillOpacity="0.5" /></svg>optimum in each bootstrap resample</span>
      <span className="inline-flex items-center gap-1"><svg width="16" height="12"><rect width="16" height="12" fill={RAMP[4]} /><line x1="0" y1="12" x2="12" y2="0" stroke={BG} strokeWidth="3" /></svg>predicted CER outside the margin</span>
      <span>faded: outside the runs (extrapolated)</span>
    </div>
  );
}

// ── generic scatter (cost against CER, residuals, half-normal, history) ──
export interface ScatterPt { x: number; y: number; tip: string[]; tone?: 'live' | 'opt' | 'ink' | 'faint'; r?: number }
export function Scatter({ pts, xLabel, yLabel, fx, fy, line, hline, diag, w = 460, h = 260, zeroX = false, onTip }: {
  pts: ScatterPt[]; xLabel: string; yLabel: string; fx: (v: number) => string; fy: (v: number) => string;
  line?: { x: number; y: number }[]; hline?: number; diag?: boolean; w?: number; h?: number; zeroX?: boolean; onTip?: (t: string[] | null) => void;
}) {
  const M = { l: 56, r: 12, t: 10, b: 40 };
  const xs = [...pts.map((p) => p.x), ...(line ?? []).map((p) => p.x)].filter(Number.isFinite), ys = [...pts.map((p) => p.y), ...(line ?? []).map((p) => p.y), ...(hline !== undefined ? [hline] : [])].filter(Number.isFinite);
  if (!xs.length) return <p className="text-sm text-[#8b949e]">Nothing to draw yet.</p>;
  let x0 = zeroX ? 0 : Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (x1 === x0) { x0 -= 1; x1 += 1; } if (y1 === y0) { y0 -= 1; y1 += 1; }
  const px = (x1 - x0) * 0.06, py = (y1 - y0) * 0.08; x0 = zeroX ? 0 : x0 - px; x1 += px; y0 -= py; y1 += py;
  const X = (v: number) => M.l + ((v - x0) / (x1 - x0)) * (w - M.l - M.r), Y = (v: number) => M.t + (1 - (v - y0) / (y1 - y0)) * (h - M.t - M.b);
  const col = (t?: string) => (t === 'live' ? LIVE : t === 'opt' ? TEAL : t === 'faint' ? FAINT : INK);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" style={{ maxWidth: w }} role="img" aria-label={`${yLabel} against ${xLabel}`}>
      {niceSteps(y0, y1, 5).map((t) => <g key={t}><line x1={M.l} x2={w - M.r} y1={Y(t)} y2={Y(t)} stroke={GRID} /><text x={M.l - 5} y={Y(t) + 4} fontSize={10} textAnchor="end" fill={MUTED}>{fy(t)}</text></g>)}
      {niceSteps(x0, x1, 5).map((t) => <text key={t} x={X(t)} y={h - M.b + 14} fontSize={10} textAnchor="middle" fill={MUTED}>{fx(t)}</text>)}
      {hline !== undefined && <line x1={M.l} x2={w - M.r} y1={Y(hline)} y2={Y(hline)} stroke={LIVE} strokeDasharray="5 3" strokeWidth={1.5} />}
      {diag && <line x1={X(Math.max(x0, y0))} y1={Y(Math.max(x0, y0))} x2={X(Math.min(x1, y1))} y2={Y(Math.min(x1, y1))} stroke={FAINT} strokeDasharray="3 3" />}
      {line && line.length > 1 && <polyline points={line.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')} fill="none" stroke={FAINT} strokeWidth={2} />}
      {pts.map((p, i) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={p.r ?? 4.5} fill={p.tone === 'faint' ? 'none' : col(p.tone)} fillOpacity={p.tone === 'ink' || !p.tone ? 0.85 : 1} stroke={p.tone === 'faint' ? FAINT : BG} strokeWidth={1}
        onPointerEnter={() => onTip?.(p.tip)} onPointerLeave={() => onTip?.(null)}><title>{p.tip.join('\n')}</title></circle>)}
      <text x={(w + M.l) / 2} y={h - 5} fontSize={10} textAnchor="middle" fill={MUTED}>{xLabel}</text>
      <text transform={`translate(11 ${(h - M.b + M.t) / 2}) rotate(-90)`} fontSize={10} textAnchor="middle" fill={MUTED}>{yLabel}</text>
    </svg>
  );
}
