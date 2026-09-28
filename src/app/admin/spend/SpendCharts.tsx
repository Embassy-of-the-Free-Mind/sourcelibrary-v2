'use client';

/**
 * Interactive charts for /admin/spend (#5225). Receives ONLY the series it
 * draws — monthly vendor totals, daily Google Cloud rows and the SKU table.
 * People and hours never reach this component.
 */
import { useMemo, useState } from 'react';
import type { DailyRow, MonthlyRow, SkuRow } from '@/lib/spend-report';

const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const fmt0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthName = (m: string) =>
  new Date(m + '-15T00:00:00').toLocaleString('en-US', { month: 'short', year: '2-digit' }).replace(' ', ' ’');
const monthLong = (m: string) => new Date(m + '-15T00:00:00').toLocaleString('en-US', { month: 'long', year: 'numeric' });
const dayName = (d: string) => new Date(d + 'T00:00:00').toLocaleString('en-US', { month: 'short', day: 'numeric' });
const dayLong = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleString('en-US', { weekday: 'short', month: 'long', day: 'numeric' });

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

interface Col { label: string; long: string; values: number[]; note?: string }

function Legend({ names }: { names: string[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
      {names.map((n, i) => (
        <span key={n} className="inline-flex items-center gap-1.5">
          <i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} />
          {n}
        </span>
      ))}
    </div>
  );
}

function Stacked({ cols, names, maxLabels = 14, label }: { cols: Col[]; names: string[]; maxLabels?: number; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000, H = 300, padL = 56, padR = 8, padT = 10, padB = 26;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = Math.max(1, ...cols.map(c => c.values.reduce((a, b) => a + Math.max(0, b), 0)));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const y = (v: number) => padT + ih - (v / top) * ih;
  const n = Math.max(1, cols.length), slot = iw / n, gap = Math.min(6, slot * 0.25), bw = Math.max(2, slot - gap);
  const labelEvery = Math.ceil(n / maxLabels);
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  const h = hover != null ? cols[hover] : null;
  const hx = hover != null ? ((padL + hover * slot + bw / 2) / W) * 100 : 0;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="w-full h-auto block">
        {ticks.map(v => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#c3c2b7' : '#e1e0d9'} strokeWidth={1} />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#898781">
              {fmt0.format(v).replace(/,000$/, 'K')}
            </text>
          </g>
        ))}
        {cols.map((c, ci) => {
          const x = padL + ci * slot + gap / 2;
          let acc = 0;
          return (
            <g key={c.label + ci}>
              {c.values.map((v, si) => {
                if (v <= 0) return null;
                const y1 = y(acc + v), y0 = y(acc);
                acc += v;
                const hh = Math.max(0, y0 - y1 - 1.5);
                return hh > 0 ? <rect key={si} x={x} y={y1 + 0.75} width={bw} height={hh} fill={SERIES[si % SERIES.length]} /> : null;
              })}
              {(ci % labelEvery === 0 || n <= 16) && (
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="#898781">{c.label}</text>
              )}
              <rect
                x={padL + ci * slot} y={padT} width={slot} height={ih} fill="transparent" tabIndex={0}
                onPointerEnter={() => setHover(ci)} onFocus={() => setHover(ci)}
                onPointerLeave={() => setHover(null)} onBlur={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded border border-stone-200 bg-white px-3 py-2 text-xs shadow-md min-w-[180px]"
          style={{ left: `clamp(0%, calc(${hx}% - 90px), calc(100% - 200px))` }}
        >
          <b className="block text-stone-900 mb-1">{h.long}</b>
          {h.values.map((v, si) => v ? (
            <div key={si} className="flex justify-between gap-4 text-stone-700">
              <span className="inline-flex items-center gap-1.5">
                <i className="inline-block w-2 h-2 rounded-sm" style={{ background: SERIES[si % SERIES.length] }} />
                {names[si]}
              </span>
              <strong>{fmt2.format(v)}</strong>
            </div>
          ) : null)}
          <div className="flex justify-between gap-4 mt-1 pt-1 border-t border-stone-200 text-stone-900">
            <span>Total</span><strong>{fmt2.format(h.values.reduce((a, b) => a + b, 0))}</strong>
          </div>
          {h.note && <div className="text-stone-500 mt-1">{h.note}</div>}
        </div>
      )}
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded border border-stone-300 overflow-hidden text-xs">
      {options.map(o => (
        <button
          key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}
          className={`px-2.5 py-1 ${value === o.v ? 'bg-stone-800 text-white' : 'bg-white text-stone-700 hover:bg-stone-100'}`}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

export function MonthlyChart({ months, vendors }: { months: MonthlyRow[]; vendors: string[] }) {
  const cur = months[months.length - 1]?.month;
  const cols: Col[] = months.map(m => ({
    label: monthName(m.month), long: monthLong(m.month),
    values: vendors.map(v => m.vendors[v]?.v ?? 0),
    note: m.month === cur ? 'Partial month' : undefined,
  }));
  return (
    <div className="grid gap-2">
      <Legend names={vendors} />
      <Stacked cols={cols} names={vendors} label="Stacked monthly spend by vendor" />
    </div>
  );
}

export function DailyChart({ daily, drivers, projects }: { daily: DailyRow[]; drivers: string[]; projects: string[] }) {
  const [view, setView] = useState<'byDriver' | 'byProject'>('byDriver');
  const [range, setRange] = useState<'all' | '30' | '7'>('all');
  const names = view === 'byDriver' ? drivers : projects;
  const rows = range === 'all' ? daily : daily.slice(-Number(range));
  const cols: Col[] = rows.map(d => ({ label: dayName(d.day), long: dayLong(d.day), values: d[view] }));
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Seg value={range} onChange={setRange} label="Date range"
          options={[{ v: 'all', l: 'All' }, { v: '30', l: 'Last 30 days' }, { v: '7', l: 'Last 7 days' }]} />
        <Seg value={view} onChange={setView} label="Breakdown"
          options={[{ v: 'byDriver', l: 'By cost driver' }, { v: 'byProject', l: 'By project' }]} />
      </div>
      <Legend names={names} />
      <Stacked cols={cols} names={names} label="Stacked daily Google Cloud spend" />
    </div>
  );
}

export function SkuTable({ skus }: { skus: SkuRow[] }) {
  const months = useMemo(() => [...new Set(skus.map(s => s.month))].sort(), [skus]);
  const [month, setMonth] = useState(months[months.length - 1] ?? '');
  const rows = skus.filter(s => s.month === month);
  const total = rows.reduce((a, r) => a + r.cost, 0) || 1;
  const rest = rows.slice(25).reduce((a, r) => a + r.cost, 0);
  const td = 'px-2 py-1 border-b border-stone-100 whitespace-nowrap tabular-nums';
  return (
    <div className="grid gap-2">
      <Seg value={month} onChange={setMonth} label="Month" options={months.map(m => ({ v: m, l: monthName(m) }))} />
      <div className="overflow-x-auto">
        <table className="text-sm min-w-full">
          <thead><tr className="text-left text-xs text-stone-500">
            {['SKU', 'Project', 'Service', 'Cost', 'Share'].map(h => <th key={h} className="px-2 py-1 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.slice(0, 25).map((r, i) => (
              <tr key={i}>
                <td className={`${td} !whitespace-normal`}>{r.sku.trim()}</td>
                <td className={td}>{r.project}</td><td className={td}>{r.service}</td>
                <td className={`${td} text-right`}>{fmt2.format(r.cost)}</td>
                <td className={`${td} text-right`}>{(r.cost / total * 100).toFixed(1)}%</td>
              </tr>
            ))}
            {rows.length > 25 && (
              <tr><td className={td}>{rows.length - 25} smaller SKUs</td><td className={td} /><td className={td} />
                <td className={`${td} text-right`}>{fmt2.format(rest)}</td>
                <td className={`${td} text-right`}>{(rest / total * 100).toFixed(1)}%</td></tr>
            )}
            <tr className="font-semibold"><td className={td}>Total {month && monthName(month)}</td><td className={td} /><td className={td} />
              <td className={`${td} text-right`}>{fmt2.format(rows.reduce((a, r) => a + r.cost, 0))}</td>
              <td className={`${td} text-right`}>100%</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
