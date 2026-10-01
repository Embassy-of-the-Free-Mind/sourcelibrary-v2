'use client';

/**
 * SVG charts for the /admin dashboard (#3943): a multi-series line chart with a
 * crosshair tooltip, vertical bars (plain or stacked), and horizontal bar lists.
 * Receives only the series it draws. Same eight-slot palette as SpendCharts.
 *
 * PRIOR ART: src/app/admin/spend/SpendCharts.tsx — its Stacked/Legend are
 * module-private and columns-only; this file adds lines, hover and horizontal
 * bars without touching the spend page.
 */
import { useMemo, useState, type ReactNode } from 'react';

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
/** Blue ordinal ramp, light to dark, for ordered categories (ladder rungs, pages at each state). */
export const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];

export const fmtK = (n: number | null | undefined) =>
  n == null ? '—' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : Math.abs(n) >= 1000 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(Math.round(n));
export const fmtFull = (n: number | null | undefined) => n == null ? '—' : Math.round(n).toLocaleString('en-US');
export const fmtUsd = (n: number | null | undefined) => n == null ? '—' : n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'K' : '$' + Math.round(n);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayLabel = (d: string) => `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}`;
export const monthLabel = (m: string) => `${MONTHS[+m.slice(5, 7) - 1]} ’${m.slice(2, 4)}`;

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

export function Legend({ names, colors }: { names: string[]; colors?: string[] }) {
  if (names.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
      {names.map((n, i) => (
        <span key={n} className="inline-flex items-center gap-1.5">
          <i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: (colors ?? SERIES)[i % (colors ?? SERIES).length] }} />{n}
        </span>
      ))}
    </div>
  );
}

const W = 720, H = 260, PAD = { l: 44, r: 8, t: 10, b: 24 };

export interface LineSeries { name: string; data: (number | null)[]; color?: string; fill?: boolean }

/** Multi-series line chart on one y axis. `labels` are x positions (one per index); hover shows every series at that index. */
export function LineChart({ labels, series, format = fmtK, height = H, log = false, ariaLabel }: {
  labels: string[]; series: LineSeries[]; format?: (n: number | null) => string; height?: number; log?: boolean; ariaLabel: string;
}) {
  const [hi, setHi] = useState<number | null>(null);
  const n = labels.length;
  const iw = W - PAD.l - PAD.r, ih = height - PAD.t - PAD.b;
  const all = series.flatMap(s => s.data.filter((v): v is number => v != null));
  const max = niceMax(Math.max(1, ...all));
  const minLog = Math.max(1, Math.min(...all.filter(v => v > 0)));
  const y = (v: number) => {
    if (log) { const lo = Math.log10(minLog), hiV = Math.log10(max); return PAD.t + ih - (ih * (Math.log10(Math.max(v, minLog)) - lo)) / Math.max(1e-9, hiV - lo); }
    return PAD.t + ih - (ih * v) / max;
  };
  const x = (i: number) => PAD.l + (n <= 1 ? iw / 2 : (iw * i) / (n - 1));
  const ticks = log ? [minLog, Math.sqrt(minLog * max), max] : [0, max / 4, max / 2, (3 * max) / 4, max];
  const xTicks = useMemo(() => { const step = Math.max(1, Math.ceil(n / 7)); return labels.map((l, i) => (i % step === 0 ? i : -1)).filter(i => i >= 0); }, [labels, n]);
  const paths = series.map(s => {
    let d = '', open = false;
    s.data.forEach((v, i) => { if (v == null || (log && v <= 0)) { open = false; return; } d += `${open ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; open = true; });
    return d;
  });
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - PAD.l) / iw) * (n - 1));
    setHi(Math.max(0, Math.min(n - 1, i)));
  };
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={ariaLabel} className="w-full h-auto block" onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#e7e5e4" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(t) + 3.5} fontSize={10} textAnchor="end" fill="#78716c">{format(t)}</text>
          </g>
        ))}
        {xTicks.map(i => <text key={i} x={x(i)} y={height - 8} fontSize={10} textAnchor="middle" fill="#78716c">{labels[i]}</text>)}
        {series.map((s, si) => s.fill && (
          <path key={'f' + si} d={paths[si] ? `${paths[si]}L${x(s.data.length - 1).toFixed(1)} ${y(0)} L${x(0)} ${y(0)} Z` : ''} fill={s.color ?? SERIES[si]} opacity={0.1} />
        ))}
        {series.map((s, si) => <path key={si} d={paths[si]} fill="none" stroke={s.color ?? SERIES[si]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
        {hi != null && (
          <g>
            <line x1={x(hi)} x2={x(hi)} y1={PAD.t} y2={PAD.t + ih} stroke="#a8a29e" strokeWidth={1} />
            {series.map((s, si) => s.data[hi] != null && <circle key={si} cx={x(hi)} cy={y(s.data[hi] as number)} r={4} fill={s.color ?? SERIES[si]} stroke="#fff" strokeWidth={2} />)}
          </g>
        )}
      </svg>
      {hi != null && (
        <div className="pointer-events-none absolute top-1 rounded border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-800 shadow-sm" style={{ left: `${Math.min(80, Math.max(2, (x(hi) / W) * 100))}%`, transform: x(hi) > W * 0.7 ? 'translateX(-105%)' : 'none' }}>
          <div className="font-medium">{labels[hi]}</div>
          {series.map((s, si) => <div key={si} className="flex items-center gap-1.5"><i className="inline-block w-2 h-2 rounded-sm" style={{ background: s.color ?? SERIES[si] }} />{s.name}: {s.data[hi] == null ? '—' : fmtFull(s.data[hi])}</div>)}
        </div>
      )}
    </div>
  );
}

export interface BarSeries { name: string; data: number[]; color?: string }

/** Vertical bars; several series stack. Hover shows the column's values. */
export function Bars({ labels, series, format = fmtK, height = H, ariaLabel, valueFormat }: {
  labels: string[]; series: BarSeries[]; format?: (n: number | null) => string; height?: number; ariaLabel: string; valueFormat?: (n: number) => string;
}) {
  const [hi, setHi] = useState<number | null>(null);
  const n = labels.length;
  const iw = W - PAD.l - PAD.r, ih = height - PAD.t - PAD.b;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.data[i] || 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const slot = iw / Math.max(1, n), bw = Math.min(24, slot * 0.7);
  const vf = valueFormat ?? fmtFull;
  const xTicks = useMemo(() => { const step = Math.max(1, Math.ceil(n / 8)); return labels.map((l, i) => (i % step === 0 ? i : -1)).filter(i => i >= 0); }, [labels, n]);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={ariaLabel} className="w-full h-auto block" onMouseLeave={() => setHi(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map(f => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih - ih * f} y2={PAD.t + ih - ih * f} stroke="#e7e5e4" strokeWidth={1} />
            <text x={PAD.l - 6} y={PAD.t + ih - ih * f + 3.5} fontSize={10} textAnchor="end" fill="#78716c">{format(max * f)}</text>
          </g>
        ))}
        {labels.map((l, i) => {
          let acc = 0;
          const cx = PAD.l + slot * i + slot / 2;
          return (
            <g key={i} onMouseEnter={() => setHi(i)}>
              <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={ih} fill="transparent" />
              {series.map((s, si) => {
                const v = s.data[i] || 0; if (!v) return null;
                const h = (ih * v) / max; acc += v;
                const top = PAD.t + ih - (ih * acc) / max;
                return <rect key={si} x={cx - bw / 2} y={top + (si > 0 ? 1 : 0)} width={bw} height={Math.max(0, h - (si > 0 ? 1 : 0))} fill={s.color ?? SERIES[si]} rx={si === series.length - 1 ? 3 : 0} />;
              })}
              {xTicks.includes(i) && <text x={cx} y={height - 8} fontSize={10} textAnchor="middle" fill="#78716c">{l}</text>}
            </g>
          );
        })}
      </svg>
      {hi != null && (
        <div className="pointer-events-none absolute top-1 rounded border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-800 shadow-sm" style={{ left: `${Math.min(80, Math.max(2, ((PAD.l + slot * hi + slot / 2) / W) * 100))}%`, transform: hi > n * 0.7 ? 'translateX(-105%)' : 'none' }}>
          <div className="font-medium">{labels[hi]}</div>
          {series.map((s, si) => <div key={si} className="flex items-center gap-1.5"><i className="inline-block w-2 h-2 rounded-sm" style={{ background: s.color ?? SERIES[si] }} />{s.name}: {vf(s.data[hi] || 0)}</div>)}
          {series.length > 1 && <div className="text-stone-500">Total {vf(totals[hi])}</div>}
        </div>
      )}
    </div>
  );
}

/** Horizontal bar list: one row per item, segments stack left to right; the number at the end is the row total. */
export function HBars({ rows, colors = SERIES, labelWidth = 150, sub, title }: {
  rows: { label: string; values: number[]; sub?: string; title?: string }[]; colors?: string[]; labelWidth?: number; sub?: boolean; title?: (r: { label: string; values: number[] }) => string;
}) {
  const max = Math.max(1, ...rows.map(r => r.values.reduce((a, b) => a + b, 0)));
  return (
    <div className="grid gap-1.5 text-sm">
      {rows.map(r => {
        const tot = r.values.reduce((a, b) => a + b, 0);
        return (
          <div key={r.label} className="grid items-center gap-2.5" style={{ gridTemplateColumns: `minmax(90px, ${labelWidth}px) 1fr` }} title={r.title ?? title?.(r) ?? `${r.label}: ${fmtFull(tot)}`}>
            <div className="min-w-0 truncate text-stone-800">{r.label}{sub && r.sub && <span className="block text-[11px] text-stone-500">{r.sub}</span>}</div>
            <div className="flex items-center gap-0.5 h-[18px] min-w-0">
              {r.values.map((v, i) => v > 0 && <div key={i} className="h-full" style={{ width: `${(82 * v) / max}%`, background: colors[i % colors.length], borderRadius: i === r.values.length - 1 || r.values.slice(i + 1).every(x => !x) ? '0 4px 4px 0' : 0 }} />)}
              <span className="pl-1.5 font-mono text-xs text-stone-600 whitespace-nowrap">{fmtFull(tot)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Panel({ title, children, note, right }: { title: string; children: ReactNode; note?: ReactNode; right?: ReactNode }) {
  return (
    <div className="rounded border border-stone-200 bg-white p-4 grid gap-2.5 content-start min-w-0">
      <div className="flex items-baseline justify-between gap-3 flex-wrap"><h3 className="text-base font-semibold text-stone-900">{title}</h3>{right}</div>
      {children}
      {note && <p className="text-xs text-stone-500 leading-snug max-w-3xl">{note}</p>}
    </div>
  );
}

/** Linear/log switch for the cumulative pipeline chart. Owns its state so the page stays a server component. */
export function PipelineCumulative({ labels, series }: { labels: string[]; series: LineSeries[] }) {
  const [log, setLog] = useState(false);
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Legend names={series.map(s => s.name)} colors={series.map((s, i) => s.color ?? SERIES[i])} />
        <div className="inline-flex rounded border border-stone-300 overflow-hidden text-xs" role="group" aria-label="Scale">
          {([false, true] as const).map(v => (
            <button key={String(v)} type="button" aria-pressed={log === v} onClick={() => setLog(v)} className={`px-2.5 py-1 ${log === v ? 'bg-stone-900 text-white' : 'bg-white text-stone-700 hover:bg-stone-50'}`}>{v ? 'Log' : 'Linear'}</button>
          ))}
        </div>
      </div>
      <LineChart labels={labels} series={series} log={log} ariaLabel="Cumulative pages by stage" />
    </div>
  );
}
