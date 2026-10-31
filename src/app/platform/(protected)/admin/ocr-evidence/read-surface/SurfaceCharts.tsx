'use client';

/**
 * Charts for /platform/admin/ocr-evidence/read-surface (#6740). They draw the fitted surfaces that
 * scripts/eval/read-surface-6740/fit.mjs wrote; nothing is computed here but contour lines and scales.
 * Colours are the platform admin's dark tokens (layout.tsx, ocr-evidence/page.tsx): blue #58a6ff for the optimum, amber
 * #d29922 for the live setting, grey for everything else; the surfaces are one teal ramp, dark (low) to light (high), as
 * a sequential ramp reads on a dark surface.
 */
import { useId, useState } from 'react';

export const TEAL = '#58a6ff';     // admin blue: the optimum
export const LIVE = '#d29922';     // admin amber: the live setting
export const INK = '#e6edf3';      // admin text
export const MUTED = '#8b949e';    // admin dim text
export const FAINT = '#6e7681';    // admin faint
export const GRID = '#21262d';     // admin row border
// Sequential teal ramp for a dark surface (teal-950 … teal-300), dark = low.
export const RAMP = ['#042f2e', '#0b3b38', '#134e4a', '#115e59', '#0f766e', '#0d9488', '#14b8a6', '#2dd4bf', '#5eead4'];

export interface Setting { measured?: { delta: number; delta_lo: number; delta_hi: number; calls: number }; pool?: string | null; x: number[]; ppc: number; edge: number; think: string; cer: number; cer_sd?: number; prior_cer?: number; prior_cer_sd?: number; prior_calls?: number; prior_calls_sd?: number; delta: number; delta_lo: number; delta_hi: number; calls: number; calls_lo: number; calls_hi: number; secs: number; run: string | null; wrong: number | null; non_inferior: boolean }
export interface Run { id: string; x: (number | null)[]; ppc: number; edge: number | null; think: string; live: boolean; cer: number; calls: number; secs: number; wrong: number; imputed: number }
export interface Slice { x3: number; think: string; cer: number[][]; calls: number[][]; cer_sd?: number[][] }
export interface LangSurface {
  books: number; axis: number[]; runs: Run[]; settings: Setting[]; slices: Slice[]; prior_slices?: Slice[];
  prior?: { a0: { cer: { a0: number | null }; calls: { a0: number | null } }; cer: { label: string; y: number }[]; calls: { label: string; y: number }[] };
  live: { cer: number; calls: number | null; wrong: number };
  optimum: { verdict: string; setting?: Setting; saving?: number | null };
  noise: { band: number; centre_range: number | null; from?: string };
}
export interface Route { lang: string; route: string; k: number; n: number; calls: number; wrong: number; source: string; live?: boolean }

const pct = (v: number, d = 2) => `${(100 * v).toFixed(d)}%`;
const EDGE = ['1,024', '1,600', '2,400'];
const PPC = ['1', '4', '8'];

// ── marching squares: segments of the isoline `level` over a grid z[row][col] on coded [-1, 1]² ──
export function isoSegments(z: number[][], axis: number[], level: number) {
  const segs: [number, number, number, number][] = [];
  const n = axis.length;
  const lerp = (a: number, b: number, za: number, zb: number) => a + ((level - za) / (zb - za)) * (b - a);
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const x0 = axis[c], x1 = axis[c + 1], y0 = axis[r], y1 = axis[r + 1];
    const v = [z[r][c], z[r][c + 1], z[r + 1][c + 1], z[r + 1][c]];
    const pts: [number, number][] = [];
    const e = [[x0, y0, x1, y0, v[0], v[1]], [x1, y0, x1, y1, v[1], v[2]], [x1, y1, x0, y1, v[2], v[3]], [x0, y1, x0, y0, v[3], v[0]]] as const;
    for (const [ax, ay, bx, by, za, zb] of e) if ((za - level) * (zb - level) < 0) pts.push([lerp(ax, bx, za, zb), lerp(ay, by, za, zb)]);
    if (pts.length >= 2) segs.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]]);
    if (pts.length === 4) segs.push([pts[2][0], pts[2][1], pts[3][0], pts[3][1]]);
  }
  return segs;
}
export function niceSteps(lo: number, hi: number, k = 6) {
  const raw = (hi - lo) / k, mag = 10 ** Math.floor(Math.log10(raw || 1e-9));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v < hi; v += step) out.push(Number(v.toPrecision(6)));
  return out;
}

const S = 210, P = { l: 52, r: 10, t: 22, b: 40 };
const sx = (a: number) => P.l + ((a + 1) / 2) * S;
const sy = (b: number) => P.t + S - ((b + 1) / 2) * S;

/** One slice: x1 (pages a call) across, x2 (long edge) up, at one thinking level. Filled bands + isolines. */
function SlicePlot({ L, slice, which, range, onHover, prior = false }: { L: LangSurface; slice: Slice; which: 'cer' | 'calls'; range: [number, number]; onHover: (t: string[] | null) => void; prior?: boolean }) {
  const z = slice[which];
  const n = L.axis.length;
  const levels = niceSteps(range[0], range[1]);
  const band = (v: number) => RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.floor(((v - range[0]) / (range[1] - range[0] || 1)) * RAMP.length)))];
  const cw = S / (n - 1);
  const clip = useId();
  const pts = prior ? [] : L.runs.filter((r) => !r.live && r.x[2] === slice.x3);
  const found = L.optimum.verdict.startsWith('optimum found') ? L.optimum.setting : undefined;   // a near-miss is not marked
  const opt = !prior && found && found.x[2] === slice.x3 ? found : null;
  const bound = which === 'cer' ? L.live.cer + 0.01 : null;   // the non-inferiority line: live CER + the 1 pp margin
  return (
    <svg viewBox={`0 0 ${S + P.l + P.r} ${S + P.t + P.b}`} className="w-full h-auto" role="img"
      aria-label={`${which === 'cer' ? 'Predicted CER' : 'Predicted agy calls a page'} at thinking ${slice.think}`}>
      <text x={P.l} y={14} fontSize={12} fill={INK} fontWeight={600}>thinking {slice.think}</text>
      {z.map((row, r) => row.map((v, c) => {
        const x = sx(L.axis[c]) - cw / 2, y = sy(L.axis[r]) - cw / 2;
        return <rect key={`${r}-${c}`} x={Math.max(P.l, x)} y={Math.max(P.t, y)} width={cw + 0.5} height={cw + 0.5} fill={band(v)}
          clipPath={`url(#${clip})`} />;
      }))}
      {levels.map((lv) => isoSegments(z, L.axis, lv).map(([a, b, c, d], i) => (
        <line key={`${lv}-${i}`} x1={sx(a)} y1={sy(b)} x2={sx(c)} y2={sy(d)} stroke={INK} strokeOpacity={0.35} strokeWidth={1} />
      )))}
      {bound !== null && isoSegments(z, L.axis, bound).map(([a, b, c, d], i) => (
        <line key={`nb-${i}`} x1={sx(a)} y1={sy(b)} x2={sx(c)} y2={sy(d)} stroke={LIVE} strokeWidth={2} strokeDasharray="5 3" />
      ))}
      <rect x={P.l} y={P.t} width={S} height={S} fill="none" stroke={FAINT} />
      {[-1, 0, 1].map((a, i) => <text key={`xa${a}`} x={sx(a)} y={P.t + S + 14} fontSize={11} textAnchor="middle" fill={MUTED}>{PPC[i]}</text>)}
      <text x={P.l + S / 2} y={P.t + S + 32} fontSize={11} textAnchor="middle" fill={MUTED}>pages a call</text>
      {[-1, 0, 1].map((b, i) => <text key={`ya${b}`} x={P.l - 6} y={sy(b) + 4} fontSize={11} textAnchor="end" fill={MUTED}>{EDGE[i]}</text>)}
      <text transform={`translate(12 ${P.t + S / 2}) rotate(-90)`} fontSize={11} textAnchor="middle" fill={MUTED}>long edge, px</text>
      {/* hover cells: the fitted value at each grid level */}
      {[-1, 0, 1].flatMap((a) => [-1, 0, 1].map((b) => {
        const s = L.settings.find((q) => q.x[0] === a && q.x[1] === b && q.x[2] === slice.x3)!;
        return <rect key={`h${a}${b}`} x={sx(a) - 14} y={sy(b) - 14} width={28} height={28} fill="transparent"
          onPointerEnter={() => onHover(prior ? [`${s.ppc} a call · ${s.edge} px · ${s.think}: before this design`,
            `prior CER ${pct(s.prior_cer ?? NaN)} ± ${(100 * (s.prior_cer_sd ?? NaN)).toFixed(2)} pp (accuracy, posterior sd)`,
            `prior ${(s.prior_calls ?? NaN).toFixed(2)} ± ${(s.prior_calls_sd ?? NaN).toFixed(2)} agy calls a page`] : [`${s.ppc} a call · ${s.edge} px · ${s.think}${s.run ? ` (run ${s.run})` : ' (not run: predicted)'}`,
            `predicted CER ${pct(s.cer)} (accuracy); vs live ${s.delta >= 0 ? '+' : ''}${(100 * s.delta).toFixed(2)} pp [${(100 * s.delta_lo).toFixed(2)}, ${(100 * s.delta_hi).toFixed(2)}]`,
            `predicted ${s.calls.toFixed(2)} agy calls a page (cost) [${s.calls_lo.toFixed(2)}, ${s.calls_hi.toFixed(2)}]`,
            s.non_inferior ? 'non-inferior to live (upper bound ≤ 1 pp)' : 'not shown non-inferior']) } onPointerLeave={() => onHover(null)} />;
      }))}
      {pts.map((r) => {
        const centre = r.x[0] === 0 && r.x[1] === 0 && r.x[2] === 0;
        return <g key={r.id} pointerEvents="none">
          <circle cx={sx(r.x[0] as number)} cy={sy(r.x[1] as number)} r={5} fill="#0d1117" stroke={INK} strokeWidth={2} />
          {centre && L.runs.filter((q) => q.id.startsWith('C')).length > 1 && <text x={sx(0) + 8} y={sy(0) - 7} fontSize={10} fill={INK}>×{L.runs.filter((q) => q.id.startsWith('C')).length}</text>}
        </g>;
      })}
      {prior && slice.x3 === -1 && <g pointerEvents="none">
        <circle cx={sx(-1)} cy={sy(1)} r={5} fill={FAINT} stroke={INK} strokeWidth={1.5} />
        <text x={sx(-1) + 8} y={sy(1) + 14} fontSize={10} fill={INK}>earlier reads</text>
      </g>}
      {slice.x3 === -1 && <g pointerEvents="none">
        <rect x={sx(0) - 5} y={P.t - 5} width={10} height={10} fill={LIVE} stroke="#0d1117" strokeWidth={2} transform={`rotate(45 ${sx(0)} ${P.t})`} />
        <text x={sx(0) + 9} y={P.t + 4} fontSize={10} fill={INK}>live</text>
      </g>}
      {opt && <g pointerEvents="none">
        <circle cx={sx(opt.x[0])} cy={sy(opt.x[1])} r={9} fill="none" stroke={TEAL} strokeWidth={3} />
        <text x={sx(opt.x[0]) + (opt.x[0] > 0 ? -12 : 12)} y={sy(opt.x[1]) + 16} fontSize={10} fontWeight={600} textAnchor={opt.x[0] > 0 ? 'end' : 'start'} fill={INK}>optimum</text>
      </g>}
      <defs><clipPath id={clip}><rect x={P.l} y={P.t} width={S} height={S} /></clipPath></defs>
    </svg>
  );
}

function Legend({ range, which }: { range: [number, number]; which: 'cer' | 'calls' }) {
  const fmt = (v: number) => (which === 'cer' ? pct(v, 1) : v.toFixed(2));
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#8b949e] mt-1">
      <span className="inline-flex items-center gap-1">
        {fmt(range[0])}
        {RAMP.map((c) => <span key={c} className="inline-block w-4 h-3" style={{ background: c }} />)}
        {fmt(range[1])} {which === 'cer' ? 'predicted CER (accuracy)' : 'predicted agy calls a page'}
      </span>
      <span className="inline-flex items-center gap-1"><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="#0d1117" stroke={INK} strokeWidth="2" /></svg>design run</span>
      <span className="inline-flex items-center gap-1"><svg width="14" height="14"><rect x="3" y="3" width="8" height="8" fill={LIVE} transform="rotate(45 7 7)" /></svg>live (4 a call, image as served, low)</span>
      <span className="inline-flex items-center gap-1"><svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="none" stroke={TEAL} strokeWidth="3" /></svg>optimum</span>
      {which === 'cer' && <span className="inline-flex items-center gap-1"><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke={LIVE} strokeWidth="2" strokeDasharray="5 3" /></svg>live CER + 1 pp (the margin)</span>}
    </div>
  );
}

export function SurfacePanels({ L, which, prior = false }: { L: LangSurface; which: 'cer' | 'calls'; prior?: boolean }) {
  const [tip, setTip] = useState<string[] | null>(null);
  const slices = prior ? L.prior_slices ?? [] : L.slices;
  // One colour scale for prior and posterior: the posterior's range, so the two read against each other.
  const all = L.slices.flatMap((s) => s[which].flat());
  const range: [number, number] = [Math.max(0, Math.min(...all)), Math.max(...all)];
  return (
    <div className="relative">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {slices.map((s) => <SlicePlot key={s.x3} L={L} slice={s} which={which} range={range} onHover={setTip} prior={prior} />)}
      </div>
      <Legend range={range} which={which} />
      <div className="min-h-[4.5rem] mt-1 text-sm" aria-live="polite">
        {tip ? <div className="rounded border border-[#21262d] bg-[#161b22] px-2 py-1 inline-block">{tip.map((l, i) => <div key={i} className={i ? 'text-[#8b949e]' : 'text-[#f0f6fc] font-semibold'}>{l}</div>)}</div>
          : <span className="text-[#8b949e]">Point at a grid level for its fitted values and intervals.</span>}
      </div>
    </div>
  );
}

const PW = 560, PH = 300, PP = { l: 56, r: 16, t: 16, b: 44 };

/** Cost against accuracy for every grid setting of the design, with the live point and the noise band. */
export function DesignPareto({ L }: { L: LangSurface }) {
  const [tip, setTip] = useState<string[] | null>(null);
  // A setting that was run is drawn where it was measured; the others where the surface predicts them (CER ≥ 0).
  const at = (s: Setting) => (s.measured ? { calls: s.measured.calls, cer: L.live.cer + s.measured.delta } : { calls: s.calls, cer: Math.max(0, s.cer) });
  const xs = [...L.settings.map((s) => at(s).calls), L.live.calls ?? 0];
  const ys = [...L.settings.map((s) => at(s).cer), L.live.cer];
  const x0 = 0, x1 = Math.max(...xs) * 1.08, y0 = Math.max(0, Math.min(...ys) - 0.005), y1 = Math.max(...ys) + 0.005;
  const X = (v: number) => PP.l + ((v - x0) / (x1 - x0)) * (PW - PP.l - PP.r);
  const Y = (v: number) => PP.t + (1 - (v - y0) / (y1 - y0)) * (PH - PP.t - PP.b);
  // Frontier: settings no other setting beats on both calls and CER.
  const front = L.settings.filter((s) => !L.settings.some((o) => o !== s && at(o).calls <= at(s).calls && at(o).cer <= at(s).cer && (at(o).calls < at(s).calls || at(o).cer < at(s).cer))).sort((a, b) => at(a).calls - at(b).calls);
  const band = L.noise.band;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${PW} ${PH}`} className="w-full h-auto" style={{ maxWidth: PW }} role="img" aria-label="Predicted agy calls a page against predicted CER for every setting">
        {niceSteps(y0, y1, 5).map((t) => <g key={t}><line x1={PP.l} x2={PW - PP.r} y1={Y(t)} y2={Y(t)} stroke={GRID} /><text x={PP.l - 6} y={Y(t) + 4} fontSize={11} textAnchor="end" fill={MUTED}>{pct(t, 1)}</text></g>)}
        {niceSteps(x0, x1, 6).map((t) => <text key={t} x={X(t)} y={PH - PP.b + 16} fontSize={11} textAnchor="middle" fill={MUTED}>{t.toFixed(2)}</text>)}
        <rect x={PP.l} y={Y(Math.min(y1, L.live.cer + band))} width={PW - PP.l - PP.r} height={Math.max(0, Y(Math.max(y0, L.live.cer - band)) - Y(Math.min(y1, L.live.cer + band)))} fill={LIVE} fillOpacity={0.08} />
        <line x1={PP.l} x2={PW - PP.r} y1={Y(L.live.cer + 0.01)} y2={Y(L.live.cer + 0.01)} stroke={LIVE} strokeDasharray="5 3" strokeWidth={1.5} />
        <text x={PW - PP.r} y={Y(L.live.cer + 0.01) - 4} fontSize={10} textAnchor="end" fill={INK}>live + 1 pp margin</text>
        <polyline points={front.map((s) => `${X(at(s).calls)},${Y(at(s).cer)}`).join(' ')} fill="none" stroke={FAINT} strokeWidth={2} />
        {L.settings.map((s) => {
          const isOpt = L.optimum.verdict.startsWith('optimum found') && L.optimum.setting && s.x.join() === L.optimum.setting.x.join();
          return <circle key={s.x.join()} cx={X(at(s).calls)} cy={Y(at(s).cer)} r={isOpt ? 7 : 5}
            fill={s.run ? (isOpt ? TEAL : INK) : '#0d1117'} stroke={isOpt ? TEAL : INK} strokeWidth={2}
            onPointerEnter={() => setTip([`${s.ppc} a call · ${s.edge} px · ${s.think}${s.run ? ` (run ${s.run}, ${s.pool === 'default' ? 'default pool' : 'James pool'})` : ' (predicted, not run)'}`,
              s.measured ? `measured: CER ${pct(at(s).cer)} (accuracy), ${(100 * s.measured.delta).toFixed(2)} pp vs live [${(100 * s.measured.delta_lo).toFixed(2)}, ${(100 * s.measured.delta_hi).toFixed(2)}] · ${s.measured.calls.toFixed(2)} agy calls a page` : `predicted: CER ${pct(at(s).cer)} (accuracy) · ${s.calls.toFixed(2)} agy calls a page`,
              s.non_inferior ? 'non-inferior to live' : 'not shown non-inferior'])}
            onPointerLeave={() => setTip(null)} />;
        })}
        {L.live.calls != null && <rect x={X(L.live.calls) - 6} y={Y(L.live.cer) - 6} width={12} height={12} fill={LIVE} stroke="#0d1117" strokeWidth={2} transform={`rotate(45 ${X(L.live.calls)} ${Y(L.live.cer)})`}
          onPointerEnter={() => setTip(['live: 4 a call, image as served, low', `CER ${pct(L.live.cer)} (accuracy, measured, mean of 2 runs) · ${L.live.calls!.toFixed(2)} agy calls a page`])} onPointerLeave={() => setTip(null)} />}
        <text x={(PW + PP.l) / 2} y={PH - 6} fontSize={11} textAnchor="middle" fill={MUTED}>agy calls a page (production-equivalent)</text>
        <text transform={`translate(13 ${(PH - PP.b + PP.t) / 2}) rotate(-90)`} fontSize={11} textAnchor="middle" fill={MUTED}>CER (accuracy), lower is better</text>
      </svg>
      <p className="text-sm text-[#8b949e] mt-1 flex flex-wrap gap-x-4">
        <span>● run (where measured) · ○ predicted only · <span style={{ color: TEAL }}>●</span> optimum · <span style={{ color: LIVE }}>◆</span> live (mean of the two pools) · shaded: live ± noise floor ({(100 * band).toFixed(2)} pp, {L.noise.from ?? 'A-vs-A'}) · grey line: the frontier</span>
      </p>
      <div className="min-h-[3.5rem] text-sm" aria-live="polite">{tip && <div className="rounded border border-[#21262d] bg-[#161b22] px-2 py-1 inline-block">{tip.map((l, i) => <div key={i} className={i ? 'text-[#8b949e]' : 'text-[#f0f6fc] font-semibold'}>{l}</div>)}</div>}</div>
    </div>
  );
}

/** The routes #7701 tested, judged blind by Opus against the image: agy calls a page against the accepted share. */
export function RoutePareto({ routes, lang }: { routes: Route[]; lang: string }) {
  const [tip, setTip] = useState<string[] | null>(null);
  const rs = routes.filter((r) => r.lang === lang);
  const W = 420, H = 240, M = { l: 48, r: 12, t: 12, b: 40 };
  const x1 = Math.max(2.2, ...rs.map((r) => r.calls)) * 1.05;
  const X = (v: number) => M.l + (v / x1) * (W - M.l - M.r);
  const Y = (v: number) => M.t + (1 - v) * (H - M.t - M.b);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ maxWidth: W }} role="img" aria-label={`#7701 routes, ${lang}: calls a page against accepted share`}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => <g key={t}><line x1={M.l} x2={W - M.r} y1={Y(t)} y2={Y(t)} stroke={GRID} /><text x={M.l - 6} y={Y(t) + 4} fontSize={11} textAnchor="end" fill={MUTED}>{Math.round(t * 100)}%</text></g>)}
        {niceSteps(0, x1, 5).map((t) => <text key={t} x={X(t)} y={H - M.b + 16} fontSize={11} textAnchor="middle" fill={MUTED}>{t.toFixed(1)}</text>)}
        {rs.map((r) => <circle key={r.route} cx={X(r.calls)} cy={Y(r.k / r.n)} r={6} fill={r.live ? LIVE : r.wrong ? '#0d1117' : INK} stroke={r.live ? '#0d1117' : INK} strokeWidth={2}
          onPointerEnter={() => setTip([r.route, `accepted ${r.k}/${r.n} written pages (judged) · wrong text ${r.wrong} · ${r.calls.toFixed(2)} agy calls a page`, r.source])} onPointerLeave={() => setTip(null)} />)}
        <text x={(W + M.l) / 2} y={H - 6} fontSize={11} textAnchor="middle" fill={MUTED}>agy calls a page</text>
        <text transform={`translate(12 ${(H - M.b + M.t) / 2}) rotate(-90)`} fontSize={11} textAnchor="middle" fill={MUTED}>accepted (judged)</text>
      </svg>
      <div className="min-h-[3.5rem] text-sm" aria-live="polite">{tip && <div className="rounded border border-[#21262d] bg-[#161b22] px-2 py-1 inline-block">{tip.map((l, i) => <div key={i} className={i ? 'text-[#8b949e]' : 'text-[#f0f6fc] font-semibold'}>{l}</div>)}</div>}</div>
    </div>
  );
}
